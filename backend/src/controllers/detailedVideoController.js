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

const tempDir = path.resolve(__dirname, "../../tmp");
const MAX_VIDEO_SECONDS = 300; // 5-minute cap

/**
 * Generate detailed video for cron job (no HTTP response)
 */
const generateDetailedVideoForCron = async (topic, language = "en-IN") => {
  let jobTempDir = null;
  let outputPath = null;
  try {
    const normalized = normalizeTopic(topic);
    const topicHash = hashTopic(`detailed::${normalized}::${language}`);
    console.log(`[detailed-cron] start topicHash=${topicHash} language=${language}`);

    // Check cache
    const cached = await Video.findOne({ topicHash, status: "completed" });
    if (cached && cached.youtubeUrl) {
      console.log(`[detailed-cron] cache hit, returning existing: ${cached.youtubeUrl}`);
      return {
        videoId: cached._id.toString(),
        youtubeUrl: cached.youtubeUrl,
        youtubeVideoId: cached.youtubeVideoId,
        title: cached.title,
        topic: cached.topic,
        cached: true
      };
    }

    const rawScript = await generateScript(topic, language);
    const baseSections = trimSectionsToWordLimit(rawScript.sections, 300);
    const title = rawScript.title || topic;
    const greeting = {
      heading: "Welcome",
      script: `Hi there! I'm excited to learn with you. Let’s explore ${topic} together.`,
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

    const sceneDataArray = await generateScenesCode(finalSections, finalDurations, normalized);
    const outputFileName = `detailed_${topicHash}_${Date.now()}.mp4`;
    outputPath = path.join(jobTempDir, outputFileName);

    await renderDetailedVideo({
      sceneDataArray,
      audioFiles: finalAudioFiles,
      sectionScripts: finalSections.map((s) => s.script),
      outputPath,
      tempDir: jobTempDir,
    });

    // Upload to YouTube
    const youtubeResult = await uploadToYouTube(outputPath, {
      title: title || topic,
      description: `Detailed animated video about: ${topic}\n\nLanguage: ${language}`,
      tags: finalSections.flatMap(s => s.keywords || []).slice(0, 10),
      categoryId: "27",
      privacyStatus: "unlisted"
    });

    // Save to DB
    const record = await Video.findOneAndUpdate(
      { topicHash },
      {
        topicHash,
        title,
        topic: normalized,
        youtubeVideoId: youtubeResult.videoId,
        youtubeUrl: youtubeResult.videoUrl,
        youtubeUploadedAt: new Date(),
        status: "completed",
        language,
        mode: "detailed",
        sections: finalSections,
        generatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    console.log(`[detailed-cron] completed: ${youtubeResult.videoUrl}`);

    return {
      videoId: record._id.toString(),
      youtubeUrl: youtubeResult.videoUrl,
      youtubeVideoId: youtubeResult.videoId,
      title,
      topic: normalized,
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
