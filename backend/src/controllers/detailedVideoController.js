/**
 * detailedVideoController.js
 *
 * Detailed video generation for scheduled jobs.
 * Generates content-specific animated videos using Remotion + Sarvam TTS.
 */

"use strict";

const path = require("path");
const fs = require("fs/promises");
const Video = require("../models/Video");
const { hashTopic } = require("../utils/hash");
const { normalizeTopic, trimSectionsToWordLimit } = require("../utils/text");
const { ensureDir, deleteFile } = require("../utils/file");
const { generateScript } = require("../services/geminiService");
const { generateSpeech } = require("../services/ttsService");
const { getAudioDuration } = require("../services/ffmpegService");
const { generateScenesCode } = require("../services/detailedAgentService");
const { renderDetailedVideo } = require("../services/remotionService");
const { uploadToYouTube } = require("../services/youtubeService");
const { uploadToS3 } = require("../services/s3Service");

const tempDir = path.resolve(__dirname, "../../tmp");
const MAX_VIDEO_SECONDS = 300; // 5-minute cap

const getResolvedTopic = (topic, curriculumData) => {
  return normalizeTopic(
    topic ||
    curriculumData?.subtopicName ||
    curriculumData?.topicName ||
    curriculumData?.chapterName ||
    ""
  );
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

/**
 * Generate detailed video for cron job (no HTTP response)
 */
const generateDetailedVideoForCron = async (topic, language = "en-IN", uploadTarget = "s3", options = {}) => {
  let jobTempDir = null;
  let outputPath = null;
  try {
    const curriculumData = options.curriculumData;
    const normalized = getResolvedTopic(topic, curriculumData);
    if (!normalized) {
      throw new Error("Topic is required for generation");
    }
    const curriculumFingerprint = getCurriculumFingerprint(curriculumData);
    const topicHash = hashTopic(`detailed::${normalized}::${language}::${curriculumFingerprint || "none"}`);
    console.log(`[detailed-cron] start topicHash=${topicHash} language=${language}`);

    // Check cache
    const cached = await Video.findOne({ topicHash, status: "completed", uploadTarget });
    const cachedUrl = cached ? (cached.s3Url || cached.youtubeUrl) : null;
    if (cached && cachedUrl) {
      console.log(`[detailed-cron] cache hit, returning existing: ${cachedUrl}`);
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

    const rawScript = await generateScript(normalized, language, {
      mode: "detailed",
      uploadTarget,
      curriculumData,
    });
    const baseSections = trimSectionsToWordLimit(rawScript.sections, 300);
    const title = rawScript.title || normalized;
    const greeting = {
      heading: "Welcome",
      script: `Hi there! I'm excited to learn with you. Let’s explore ${normalized} together.`,
      keywords: ["greeting", "welcome"]
    };
    const sections = [greeting, ...baseSections];

    jobTempDir = path.join(tempDir, `detailed_${topicHash}_${Date.now()}`);
    await ensureDir(jobTempDir);

    // TTS per section
    const audioFiles = [];
    const audioDurations = [];
    for (let i = 0; i < sections.length; i++) {
      const sectionAudioPath = path.join(jobTempDir, `section${i}.mp3`);
      try {
        await generateSpeech(sections[i].script, sectionAudioPath, jobTempDir, language);
        let dur = await getAudioDuration(sectionAudioPath);
        if (!dur || dur < 0.5) dur = 3;
        dur = Math.min(dur, 60);
        audioFiles.push(sectionAudioPath);
        audioDurations.push(dur);
      } catch (err) {
        audioFiles.push(null);
        audioDurations.push(5);
      }
    }

    let totalDuration = audioDurations.reduce((a, b) => a + b, 0);
    let activeSections = sections.length;
    while (totalDuration > MAX_VIDEO_SECONDS && activeSections > 1) {
      activeSections--;
      totalDuration = audioDurations.slice(0, activeSections).reduce((a, b) => a + b, 0);
    }

    const finalSections = sections.slice(0, activeSections);
    const finalAudioFiles = audioFiles.slice(0, activeSections);
    const finalDurations = audioDurations.slice(0, activeSections);

    const sceneDataArray = await generateScenesCode(finalSections, finalDurations, normalized, {
      language,
      mode: "detailed",
      curriculumData,
    });
    const outputFileName = `detailed_${topicHash}_${Date.now()}.mp4`;
    outputPath = path.join(jobTempDir, outputFileName);

    await renderDetailedVideo({
      sceneDataArray,
      audioFiles: finalAudioFiles,
      sectionScripts: finalSections.map((s) => s.script),
      outputPath,
      tempDir: jobTempDir,
    });

    let videoUrl;
    let youtubeResult = null;
    let s3Result = null;
    if (uploadTarget === "youtube") {
      youtubeResult = await uploadToYouTube(outputPath, {
        title: title || normalized,
        description: `Detailed animated video about: ${normalized}\n\nLanguage: ${language}`,
        tags: finalSections.flatMap(s => s.keywords || []).slice(0, 10),
        categoryId: "27",
        privacyStatus: "unlisted"
      });
      videoUrl = youtubeResult.videoUrl;
    } else {
      s3Result = await uploadToS3(outputPath, {
        title: title || normalized,
        topic: normalized,
        language
      });
      videoUrl = s3Result.videoUrl;
    }

    // Save to DB
    const record = await Video.findOneAndUpdate(
      { topicHash },
      {
        topicHash,
        title,
        topic: normalized,
        curriculumData,
        youtubeVideoId: youtubeResult ? youtubeResult.videoId : undefined,
        youtubeUrl: youtubeResult ? youtubeResult.videoUrl : undefined,
        youtubeUploadedAt: youtubeResult ? new Date() : undefined,
        s3Key: s3Result ? s3Result.key : undefined,
        s3Url: s3Result ? s3Result.videoUrl : undefined,
        s3UploadedAt: s3Result ? new Date() : undefined,
        uploadTarget,
        status: "completed",
        language,
        mode: "detailed",
        sections: finalSections,
        generatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    console.log(`[detailed-cron] completed: ${videoUrl}`);

    return {
      videoId: record._id.toString(),
      videoUrl,
      youtubeVideoId: youtubeResult ? youtubeResult.videoId : null,
      title,
      topic: normalized,
      uploadTarget,
      cached: false
    };
  } catch (error) {
    console.error("[detailed-cron] failed:", error.message);
    throw error;
  } finally {
    if (outputPath) await deleteFile(outputPath);
    if (jobTempDir) await fs.rm(jobTempDir, { recursive: true, force: true }).catch(() => {});
  }
};

module.exports = { generateDetailedVideoForCron };
