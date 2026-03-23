const path = require("path");
const fs = require("fs/promises");
const Video = require("../models/Video");
const { hashTopic } = require("../utils/hash");
const { normalizeTopic, trimSectionsToWordLimit } = require("../utils/text");
const { ensureDir, deleteFile } = require("../utils/file");
const { generateScript } = require("../services/geminiService");
const { orchestrate, tweakScript, buildSyncPlan } = require("../services/aiAgentService");
const { generatePerImageAudio, generateSectionAudio } = require("../services/ttsService");
const { renderSyncedVideo } = require("../services/ffmpegService");
const { uploadToYouTube } = require("../services/youtubeService");
const { uploadToS3 } = require("../services/s3Service");

const tempDir = path.resolve(__dirname, "../../tmp");

const getResolvedTopic = (topic, curriculumData) => {
  const curriculumTopic = [
    curriculumData?.curriculumName,
    curriculumData?.gradeName,
    curriculumData?.subjectName,
    curriculumData?.chapterName,
    curriculumData?.topicName,
    curriculumData?.subtopicName,
    curriculumData?.conceptName,
  ]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" > ");
  return normalizeTopic(topic || curriculumTopic || "");
};

const getCurriculumFingerprint = (curriculumData) => {
  if (!curriculumData) return "";
  return [
    curriculumData.curriculumId,
    curriculumData.gradeId,
    curriculumData.subjectId,
    curriculumData.chapterId,
    curriculumData.topicId,
    curriculumData.subtopicId,
    curriculumData.conceptId,
  ]
    .filter(Boolean)
    .join("::");
};

const listVideos = async (req, res) => {
  const videos = await Video.find({ status: "completed" }).sort({ createdAt: -1 }).limit(20);
  const items = videos.map((video) => ({
    id: video._id,
    title: video.title,
    topic: video.topic,
    createdAt: video.createdAt,
    mode: video.mode || "generic",
    uploadTarget: video.uploadTarget || "s3",
    videoUrl: video.s3Url || video.youtubeUrl || null,
    youtubeVideoId: video.youtubeVideoId || null
  }));
  return res.json({ items });
};

/**
 * Generate video for cron job (no HTTP response)
 */
const generateVideoForCron = async (topic, language = "en-IN", uploadTarget = "s3", options = {}) => {
  let jobTempDir = null;
  let audioPath = null;
  let videoPath = null;
  try {
    const curriculumData = options.curriculumData;
    const normalized = getResolvedTopic(topic, curriculumData);
    if (!normalized) {
      throw new Error("Topic is required for generation");
    }
    const curriculumFingerprint = getCurriculumFingerprint(curriculumData);
    const topicHash = hashTopic(`${normalized}::${language}::${curriculumFingerprint || "none"}`);
    console.log(`[video-cron] start topicHash=${topicHash} language=${language}`);

    // Check cache
    const cached = await Video.findOne({ topicHash, status: "completed", uploadTarget });
    const cachedUrl = cached ? (cached.s3Url || cached.youtubeUrl) : null;
    if (cached && cachedUrl) {
      console.log(`[video-cron] cache hit, returning existing: ${cachedUrl}`);
      return {
        videoId: cached._id.toString(),
        videoUrl: cachedUrl,
        youtubeVideoId: cached.youtubeVideoId,
        title: cached.title,
        topic: cached.topic,
        uploadTarget: cached.uploadTarget || uploadTarget,
        cached: true
      };
    }

    const record = await Video.create({
      topic: normalized,
      topicHash,
      curriculumData,
      status: "generating",
      language,
      uploadTarget,
      createdAt: new Date()
    });

    const aiResponse = await generateScript(normalized, language, {
      mode: "generic",
      uploadTarget,
      curriculumData,
    });
    const baseSections = trimSectionsToWordLimit(aiResponse.sections, 300);
    const greeting = `Hi there! I'm excited to learn with you. Let’s explore ${normalized} together.`;
    const sections = [
      { heading: "Welcome", script: greeting, keywords: ["greeting", "welcome"] },
      ...baseSections
    ];
    jobTempDir = path.join(tempDir, `generic_${topicHash}_${Date.now()}`);
    const topicImagesDir = path.join(jobTempDir, "images");
    await ensureDir(topicImagesDir);

    const { sectionImages, sectionKeywords } = await orchestrate(sections, topicImagesDir);
    const tweakedSections = await tweakScript(sections, sectionImages, sectionKeywords);

    await ensureDir(jobTempDir);

    audioPath = path.join(jobTempDir, `${topicHash}.mp3`);
    videoPath = path.join(jobTempDir, `${topicHash}.mp4`);

    let perImageAudios;
    try {
      const result = await generatePerImageAudio(tweakedSections, sectionImages, audioPath, tempDir, language);
      perImageAudios = result.perImageAudios;
    } catch (err) {
      const { sectionAudios } = await generateSectionAudio(tweakedSections, audioPath, tempDir, language);
      perImageAudios = [];
      const imageCountMap = {};
      for (const si of sectionImages) imageCountMap[si.sectionIndex] = si.imagePaths.length;
      for (const sa of sectionAudios) {
        const imgCount = imageCountMap[sa.sectionIndex] || 1;
        const perImgDur = sa.duration / imgCount;
        for (let imgIdx = 0; imgIdx < imgCount; imgIdx += 1) {
          perImageAudios.push({ sectionIndex: sa.sectionIndex, imageIndex: imgIdx, duration: perImgDur });
        }
      }
    }

    const syncPlan = buildSyncPlan(tweakedSections, sectionImages, perImageAudios);
    await renderSyncedVideo({ syncPlan, audioPath, outputPath: videoPath });

    let videoUrl;
    let youtubeResult = null;
    let s3Result = null;
    if (uploadTarget === "youtube") {
      youtubeResult = await uploadToYouTube(videoPath, {
        title: aiResponse.title || normalized,
        description: `Auto-generated video about: ${normalized}\n\nLanguage: ${language}`,
        tags: sections.flatMap(s => s.keywords).slice(0, 10),
        categoryId: "27",
        privacyStatus: "unlisted"
      });
      videoUrl = youtubeResult.videoUrl;
    } else {
      s3Result = await uploadToS3(videoPath, {
        title: aiResponse.title || normalized,
        topic: normalized,
        language
      });
      videoUrl = s3Result.videoUrl;
    }

    // Update record
    record.title = aiResponse.title;
    record.script = tweakedSections.map((s) => s.script).join(" ");
    record.sections = sections;
    record.curriculumData = curriculumData;
    record.youtubeVideoId = youtubeResult ? youtubeResult.videoId : undefined;
    record.youtubeUrl = youtubeResult ? youtubeResult.videoUrl : undefined;
    record.youtubeUploadedAt = youtubeResult ? new Date() : undefined;
    record.s3Key = s3Result ? s3Result.key : undefined;
    record.s3Url = s3Result ? s3Result.videoUrl : undefined;
    record.s3UploadedAt = s3Result ? new Date() : undefined;
    record.uploadTarget = uploadTarget;
    record.status = "completed";
    record.generatedAt = new Date();
    await record.save();

    console.log(`[video-cron] completed: ${videoUrl}`);

    return {
      videoId: record._id.toString(),
      videoUrl,
      youtubeVideoId: youtubeResult ? youtubeResult.videoId : null,
      title: record.title,
      topic: record.topic,
      uploadTarget,
      cached: false
    };
  } catch (error) {
    console.error("[video-cron] failed:", error.message);
    throw error;
  } finally {
    if (videoPath) await deleteFile(videoPath);
    if (audioPath) await deleteFile(audioPath);
    if (jobTempDir) await fs.rm(jobTempDir, { recursive: true, force: true }).catch(() => {});
  }
};

module.exports = { listVideos, generateVideoForCron };
