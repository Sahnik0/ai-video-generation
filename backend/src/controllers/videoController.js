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

const tempDir = path.resolve(__dirname, "../../tmp");

const listVideos = async (req, res) => {
  const videos = await Video.find({ status: "completed" }).sort({ createdAt: -1 }).limit(20);
  const items = videos.map((video) => ({
    id: video._id,
    title: video.title,
    topic: video.topic,
    createdAt: video.createdAt,
    mode: video.mode || "generic",
    videoUrl: video.youtubeUrl || null,
    youtubeVideoId: video.youtubeVideoId || null
  }));
  return res.json({ items });
};

/**
 * Generate video for cron job (no HTTP response)
 */
const generateVideoForCron = async (topic, language = "en-IN") => {
  let jobTempDir = null;
  let audioPath = null;
  let videoPath = null;
  try {
    const normalized = normalizeTopic(topic);
    const topicHash = hashTopic(`${normalized}::${language}`);
    console.log(`[video-cron] start topicHash=${topicHash} language=${language}`);

    // Check cache
    const cached = await Video.findOne({ topicHash, status: "completed" });
    if (cached && cached.youtubeUrl) {
      console.log(`[video-cron] cache hit, returning existing: ${cached.youtubeUrl}`);
      return {
        videoId: cached._id.toString(),
        youtubeUrl: cached.youtubeUrl,
        youtubeVideoId: cached.youtubeVideoId,
        title: cached.title,
        topic: cached.topic,
        cached: true
      };
    }

    const record = await Video.create({
      topic: normalized,
      topicHash,
      status: "generating",
      language,
      createdAt: new Date()
    });

    const aiResponse = await generateScript(topic, language);
    const baseSections = trimSectionsToWordLimit(aiResponse.sections, 300);
    const greeting = `Hi there! I'm excited to learn with you. Let’s explore ${topic} together.`;
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

    // Upload to YouTube
    const youtubeResult = await uploadToYouTube(videoPath, {
      title: aiResponse.title || topic,
      description: `Auto-generated video about: ${topic}\n\nLanguage: ${language}`,
      tags: sections.flatMap(s => s.keywords).slice(0, 10),
      categoryId: "27",
      privacyStatus: "unlisted"
    });

    // Update record
    record.title = aiResponse.title;
    record.script = tweakedSections.map((s) => s.script).join(" ");
    record.sections = sections;
    record.youtubeVideoId = youtubeResult.videoId;
    record.youtubeUrl = youtubeResult.videoUrl;
    record.youtubeUploadedAt = new Date();
    record.status = "completed";
    record.generatedAt = new Date();
    await record.save();

    console.log(`[video-cron] completed: ${youtubeResult.videoUrl}`);

    return {
      videoId: record._id.toString(),
      youtubeUrl: youtubeResult.videoUrl,
      youtubeVideoId: youtubeResult.videoId,
      title: record.title,
      topic: record.topic,
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
