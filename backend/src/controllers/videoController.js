const path = require("path");
const fs = require("fs/promises");
const Video = require("../models/Video");
const { hashTopic } = require("../utils/hash");
const { normalizeTopic, trimSectionsToWordLimit } = require("../utils/text");
const { fileExists, ensureDir, deleteFile } = require("../utils/file");
const { generateScript } = require("../services/geminiService");
const { orchestrate, tweakScript, buildSyncPlan } = require("../services/aiAgentService");
const { generatePerImageAudio, generateSectionAudio } = require("../services/ttsService");
const { renderSyncedVideo } = require("../services/ffmpegService");
const { uploadToYouTube } = require("../services/youtubeService");

const storageRoot = path.resolve(__dirname, "../../storage");
const audioDir = path.join(storageRoot, "audio");
const videoDir = path.join(storageRoot, "videos");
const imageDir = path.join(storageRoot, "images");
const tempDir = path.resolve(__dirname, "../../tmp");

const buildVideoUrl = (req, filePath) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const fileName = path.basename(filePath);
  return `${baseUrl}/videos/${fileName}`;
};

const VALID_LANGUAGES = [
  "en-IN", "hi-IN", "bn-IN", "te-IN", "ta-IN",
  "mr-IN", "gu-IN", "kn-IN", "ml-IN", "od-IN", "pa-IN"
];

const generateVideo = async (req, res) => {
  try {
    const topic = req.body.topic;
    if (!topic || typeof topic !== "string") {
      return res.status(400).json({ error: "Topic is required" });
    }

    const language = VALID_LANGUAGES.includes(req.body.language) ? req.body.language : "en-IN";

    const normalized = normalizeTopic(topic);
    // Include language in hash so same topic in different languages gets different cache entries
    const topicHash = hashTopic(`${normalized}::${language}`);
    console.log(`[video] start topicHash=${topicHash} language=${language}`);

    const cached = await Video.findOne({ topicHash, status: "completed" });
    if (cached && cached.youtubeUrl) {
      console.log(`[video] cache hit topicHash=${topicHash}`);
      return res.json({
        status: "cached",
        videoUrl: cached.youtubeUrl,
        youtubeVideoId: cached.youtubeVideoId,
        title: cached.title,
        topic: cached.topic
      });
    }

    const record = await Video.create({
      topic: normalized,
      topicHash,
      status: "generating",
      createdAt: new Date()
    });

    console.log(`[video] requesting gemini (language=${language})`);
    const aiResponse = await generateScript(topic, language);
    if (!aiResponse || !Array.isArray(aiResponse.sections)) {
      throw new Error("Invalid Gemini response");
    }

    const normalizedSections = aiResponse.sections.map((section) => ({
      heading: String(section.heading || ""),
      script: String(section.script || ""),
      keywords: Array.isArray(section.keywords) ? section.keywords.map(String) : []
    }));

    const sections = trimSectionsToWordLimit(normalizedSections, 300);
    console.log(`[video] sections=${sections.length}`);

    if (sections.length < 5 || sections.length > 8) {
      throw new Error("Section count must be between 5 and 8");
    }

    const topicImagesDir = path.join(imageDir, topicHash);
    await ensureDir(topicImagesDir);

    // ─── AI Agent: orchestrate image selection ──────────────────────
    console.log("[video] handing off to AI agent for image orchestration");
    const { sectionImages, sectionKeywords } = await orchestrate(sections, topicImagesDir);

    if (sectionImages.length === 0) {
      throw new Error("AI agent could not fetch images for any sections");
    }

    // ─── Tweak script to align with fetched images ───────────────────
    console.log("[video] tweaking script to match fetched images");
    const tweakedSections = await tweakScript(sections, sectionImages, sectionKeywords);

    // ─── Per-image TTS: one audio per image slot for exact sync timing ───
    // Falls back to per-section TTS if too many per-image calls fail (rate limiting)
    await ensureDir(audioDir);
    await ensureDir(videoDir);

    const audioPath = path.join(audioDir, `${topicHash}.mp3`);
    const videoPath = path.join(videoDir, `${topicHash}.mp4`);

    let perImageAudios = null;
    let usedSectionFallback = false;

    try {
      console.log(`[video] generating per-image audio (language=${language})`);
      const result = await generatePerImageAudio(
        tweakedSections,
        sectionImages,
        audioPath,
        tempDir,
        language
      );
      perImageAudios = result.perImageAudios;
    } catch (perImgErr) {
      console.warn(`[video] per-image TTS failed: ${perImgErr.message}`);
      console.log("[video] falling back to per-section TTS");
      usedSectionFallback = true;

      const { sectionAudios } = await generateSectionAudio(tweakedSections, audioPath, tempDir, language);

      // Convert section-level durations to per-image durations (split equally within each section)
      perImageAudios = [];
      const imageCountMap = {};
      for (const si of sectionImages) {
        imageCountMap[si.sectionIndex] = si.imagePaths.length;
      }
      for (const sa of sectionAudios) {
        const imgCount = imageCountMap[sa.sectionIndex] || 1;
        const perImgDur = sa.duration / imgCount;
        for (let imgIdx = 0; imgIdx < imgCount; imgIdx += 1) {
          perImageAudios.push({
            sectionIndex: sa.sectionIndex,
            imageIndex: imgIdx,
            duration: perImgDur
          });
        }
      }
      console.log(`[video] section fallback: ${perImageAudios.length} per-image durations from ${sectionAudios.length} sections`);
    }

    // ─── Build sync plan: each image knows its exact TTS duration ────
    const syncPlan = buildSyncPlan(tweakedSections, sectionImages, perImageAudios);

    if (syncPlan.length === 0) {
      throw new Error("No sections with both image and audio — cannot render video");
    }

    // ─── Render video with synced timing ────────────────────────────
    console.log("[video] rendering synced video");
    await renderSyncedVideo({ syncPlan, audioPath, outputPath: videoPath });

    // ─── Upload to YouTube ──────────────────────────────────────────
    console.log("[video] uploading to YouTube...");
    const youtubeResult = await uploadToYouTube(videoPath, {
      title: aiResponse.title || topic,
      description: `Auto-generated video about: ${topic}\n\nLanguage: ${language}\n\nGenerated sections:\n${sections.map((s, i) => `${i + 1}. ${s.heading}`).join('\n')}`,
      tags: sections.flatMap(s => s.keywords).slice(0, 10),
      categoryId: "27", // Education
      privacyStatus: "unlisted"
    });

    // ─── Clean up local files ───────────────────────────────────────
    console.log("[video] cleaning up local files...");
    await deleteFile(videoPath);
    await deleteFile(audioPath);
    // Keep images in cache for potential reuse

    // ─── Update database record ─────────────────────────────────────
    record.title = aiResponse.title;
    record.script = tweakedSections.map((s) => s.script).join(" ");
    record.sections = sections;
    record.imagePathsCount = syncPlan.length;
    record.youtubeVideoId = youtubeResult.videoId;
    record.youtubeUrl = youtubeResult.videoUrl;
    record.youtubeUploadedAt = new Date();
    record.status = "completed";
    record.generatedAt = new Date();
    await record.save();
    console.log(`[video] completed topicHash=${topicHash}, YouTube: ${youtubeResult.videoUrl}`);

    return res.json({
      status: "completed",
      videoUrl: youtubeResult.videoUrl,
      youtubeVideoId: youtubeResult.videoId,
      videoId: record._id,
      title: record.title,
      topic: record.topic
    });
  } catch (error) {
    await Video.updateOne(
      { topicHash: hashTopic(normalizeTopic(req.body.topic || "")) },
      { $set: { status: "failed" } }
    );
    console.error("[video] failed", error);
    return res.status(500).json({ error: error.message || "Failed to generate video" });
  }
};

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
    const sections = trimSectionsToWordLimit(aiResponse.sections, 300);
    const topicImagesDir = path.join(imageDir, topicHash);
    await ensureDir(topicImagesDir);

    const { sectionImages, sectionKeywords } = await orchestrate(sections, topicImagesDir);
    const tweakedSections = await tweakScript(sections, sectionImages, sectionKeywords);

    await ensureDir(audioDir);
    await ensureDir(videoDir);

    const audioPath = path.join(audioDir, `${topicHash}.mp3`);
    const videoPath = path.join(videoDir, `${topicHash}.mp4`);

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

    // Clean up
    await deleteFile(videoPath);
    await deleteFile(audioPath);

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
  }
};

module.exports = { generateVideo, listVideos, generateVideoForCron };
