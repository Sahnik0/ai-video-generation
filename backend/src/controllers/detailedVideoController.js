/**
 * detailedVideoController.js
 *
 * Handles /api/videos/generate-detailed
 * Generates content-specific animated videos using Remotion + Sarvam TTS.
 */

"use strict";

const path = require("path");
const fs = require("fs/promises");
const Video = require("../models/Video");
const { hashTopic } = require("../utils/hash");
const { normalizeTopic, trimSectionsToWordLimit } = require("../utils/text");
const { fileExists, ensureDir, deleteFile } = require("../utils/file");
const { generateScript } = require("../services/geminiService");
const { generateSpeech } = require("../services/ttsService");
const { getAudioDuration } = require("../services/ffmpegService");
const { generateScenesCode } = require("../services/detailedAgentService");
const { renderDetailedVideo, FPS } = require("../services/remotionService");
const { uploadToYouTube } = require("../services/youtubeService");

const storageRoot = path.resolve(__dirname, "../../storage");
const audioDir = path.join(storageRoot, "audio");
const videoDir = path.join(storageRoot, "videos");
const tempDir = path.resolve(__dirname, "../../tmp");

const VALID_LANGUAGES = [
  "en-IN", "hi-IN", "bn-IN", "te-IN", "ta-IN",
  "mr-IN", "gu-IN", "kn-IN", "ml-IN", "od-IN", "pa-IN",
];

const MAX_VIDEO_SECONDS = 300; // 5-minute cap

const buildVideoUrl = (req, filePath) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const fileName = path.basename(filePath);
  return `${baseUrl}/videos/${fileName}`;
};

const generateDetailedVideo = async (req, res) => {
  // Increase server-side timeout (kept alive by Express, not by proxy)
  req.setTimeout(1800000); // 30 minutes

  try {
    const topic = req.body.topic;
    if (!topic || typeof topic !== "string") {
      return res.status(400).json({ error: "Topic is required" });
    }

    const language = VALID_LANGUAGES.includes(req.body.language) ? req.body.language : "en-IN";
    const normalized = normalizeTopic(topic);

    // Cache key includes "detailed" prefix so it's separate from generic
    const topicHash = hashTopic(`detailed::${normalized}::${language}`);
    console.log(`[detailed] start topicHash=${topicHash} language=${language}`);

    // ── Cache check ──────────────────────────────────────────────────────────
    const cached = await Video.findOne({ topicHash, status: "completed" });
    if (cached && cached.youtubeUrl) {
      console.log(`[detailed] cache hit topicHash=${topicHash}`);
      return res.json({
        status: "cached",
        videoUrl: cached.youtubeUrl,
        youtubeVideoId: cached.youtubeVideoId,
        videoId: cached._id,
        title: cached.title,
        topic: cached.topic,
        mode: "detailed",
      });
    }

    // ── Script generation ────────────────────────────────────────────────────
    console.log("[detailed] step 1/5: generating script...");
    const rawScript = await generateScript(topic, language);
    const sections = trimSectionsToWordLimit(rawScript.sections, 300);
    const title = rawScript.title || topic;

    // ── Directories ──────────────────────────────────────────────────────────
    const jobTempDir = path.join(tempDir, `detailed_${topicHash}`);
    await ensureDir(jobTempDir);
    await ensureDir(audioDir);
    await ensureDir(videoDir);

    // ── TTS per section ──────────────────────────────────────────────────────
    console.log("[detailed] step 2/5: generating TTS audio for each section...");
    const audioFiles = [];
    const audioDurations = [];

    for (let i = 0; i < sections.length; i++) {
      const sectionAudioPath = path.join(jobTempDir, `section${i}.mp3`);
      console.log(`[detailed] TTS section ${i + 1}/${sections.length}`);

      try {
        await generateSpeech(sections[i].script, sectionAudioPath, jobTempDir, language);
        let dur = await getAudioDuration(sectionAudioPath);

        // Sanity cap: single section max 60s
        if (!dur || dur < 0.5) dur = 3;
        dur = Math.min(dur, 60);

        audioFiles.push(sectionAudioPath);
        audioDurations.push(dur);
        console.log(`[detailed] section ${i + 1} audio: ${dur.toFixed(1)}s`);
      } catch (err) {
        console.warn(`[detailed] TTS failed for section ${i + 1}: ${err.message}`);
        // Use a 5-second silent placeholder duration
        audioFiles.push(null);
        audioDurations.push(5);
      }
    }

    // Enforce total duration cap (cut sections if needed)
    let totalDuration = audioDurations.reduce((a, b) => a + b, 0);
    let activeSections = sections.length;
    while (totalDuration > MAX_VIDEO_SECONDS && activeSections > 1) {
      activeSections--;
      totalDuration = audioDurations.slice(0, activeSections).reduce((a, b) => a + b, 0);
    }
    const finalSections = sections.slice(0, activeSections);
    const finalAudioFiles = audioFiles.slice(0, activeSections);
    const finalDurations = audioDurations.slice(0, activeSections);

    console.log(`[detailed] ${activeSections} sections, total ~${totalDuration.toFixed(1)}s`);

    // ── AI scene code generation ─────────────────────────────────────────────
    console.log("[detailed] step 3/5: AI generating animation code...");
    const sceneDataArray = await generateScenesCode(finalSections, finalDurations, normalized);

    // ── Remotion render ──────────────────────────────────────────────────────
    console.log("[detailed] step 4/5: rendering with Remotion...");
    const outputFileName = `detailed_${topicHash}_${Date.now()}.mp4`;
    const outputPath = path.join(videoDir, outputFileName);

    await renderDetailedVideo({
      sceneDataArray,
      audioFiles: finalAudioFiles,
      sectionScripts: finalSections.map((s) => s.script),
      outputPath,
      tempDir: jobTempDir,
    });

    // ── Upload to YouTube ──────────────────────────────────────────────────────
    console.log("[detailed] uploading to YouTube...");
    const youtubeResult = await uploadToYouTube(outputPath, {
      title: title || topic,
      description: `Detailed animated video about: ${topic}\n\nLanguage: ${language}\n\nSections:\n${finalSections.map((s, i) => `${i + 1}. ${s.heading}`).join('\n')}`,
      tags: finalSections.flatMap(s => s.keywords || []).slice(0, 10),
      categoryId: "27",
      privacyStatus: "unlisted"
    });

    // ── Clean up local files ──────────────────────────────────────────────────
    console.log("[detailed] cleaning up local files...");
    await deleteFile(outputPath);
    await fs.rm(jobTempDir, { recursive: true, force: true }).catch(() => {});

    // ── Save to DB ───────────────────────────────────────────────────────────
    console.log("[detailed] step 5/5: saving to database...");
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

    return res.json({
      status: "ok",
      videoId: record._id,
      videoUrl: youtubeResult.videoUrl,
      youtubeVideoId: youtubeResult.videoId,
      title,
      topic: normalized,
      mode: "detailed",
    });

  } catch (err) {
    console.error("[detailed] error:", err.message, err.stack);
    return res.status(500).json({
      error: err.message || "Detailed video generation failed",
    });
  }
};

/**
 * Generate detailed video for cron job (no HTTP response)
 */
const generateDetailedVideoForCron = async (topic, language = "en-IN") => {
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
    const sections = trimSectionsToWordLimit(rawScript.sections, 300);
    const title = rawScript.title || topic;

    const jobTempDir = path.join(tempDir, `detailed_${topicHash}`);
    await ensureDir(jobTempDir);
    await ensureDir(audioDir);
    await ensureDir(videoDir);

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
    const outputPath = path.join(videoDir, outputFileName);

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

    // Clean up
    await deleteFile(outputPath);
    await fs.rm(jobTempDir, { recursive: true, force: true }).catch(() => {});

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
  }
};

module.exports = { generateDetailedVideo, generateDetailedVideoForCron };
