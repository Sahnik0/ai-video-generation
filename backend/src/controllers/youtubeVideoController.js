/**
 * youtubeVideoController.js
 *
 * Async controller for "Fetch from YouTube" video generation.
 *
 * Workflow:
 *   1. POST /api/youtube-video  →  validates input, creates an in-memory job,
 *      and immediately returns { jobId }.
 *   2. Background pipeline runs:
 *        fetchYouTubeTranscript()  → raw transcript + title
 *        organizeYouTubeScript()   → structured sections (AI agent)
 *        generateSpeech() x N      → per-section TTS audio
 *        generateScenesCode()      → Remotion JSX scenes (detailed agent)
 *        renderDetailedVideo()     → final MP4
 *        uploadToS3()              → public video URL
 *        Video.create()            → persisted in MongoDB
 *   3. GET /api/youtube-video/status/:jobId  →  polls job progress
 *
 * The in-memory job store resets on server restart.
 * For production, swap with Redis or a DB-backed queue.
 */

"use strict";

const path = require("path");
const fs = require("fs/promises");

const Video = require("../models/Video");
const { hashTopic } = require("../utils/hash");
const { ensureDir, deleteFile } = require("../utils/file");
const { generateSpeech } = require("../services/ttsService");
const { getAudioDuration } = require("../services/ffmpegService");
const { generateScenesCode } = require("../services/detailedAgentService");
const { renderDetailedVideo } = require("../services/remotionService");
const { uploadToS3 } = require("../services/s3Service");
const { fetchYouTubeTranscript, extractYouTubeId } = require("../services/youtubeAudioService");
const { organizeYouTubeScript } = require("../services/youtubeScriptOrganizerAgent");

const tempDir = path.resolve(__dirname, "../../tmp");
const MAX_VIDEO_SECONDS = 300; // 5-minute cap (same as detailed mode)

// ─── In-memory job store ─────────────────────────────────────────────────────

/**
 * @type {Map<string, {
 *   id: string,
 *   status: 'pending' | 'running' | 'completed' | 'failed',
 *   step: string,
 *   progress: number,
 *   message: string,
 *   result: { videoUrl: string, title: string, videoId: string } | null,
 *   error: string | null,
 *   createdAt: Date
 * }>}
 */
const jobs = new Map();

function createJob(id) {
  const job = {
    id,
    status: "pending",
    step: "queued",
    progress: 0,
    message: "Job queued",
    result: null,
    error: null,
    createdAt: new Date(),
  };
  jobs.set(id, job);
  return job;
}

function updateJob(job, { status, step, progress, message, result, error } = {}) {
  if (status !== undefined) job.status = status;
  if (step !== undefined) job.step = step;
  if (progress !== undefined) job.progress = progress;
  if (message !== undefined) job.message = message;
  if (result !== undefined) job.result = result;
  if (error !== undefined) job.error = error;
}

// Purge jobs older than 2 hours to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt.getTime() < cutoff) {
      jobs.delete(id);
    }
  }
}, 15 * 60 * 1000); // check every 15 minutes

// ─── Pipeline runner ─────────────────────────────────────────────────────────

async function runYouTubePipeline(job, { youtubeUrl, language, uploadTarget }) {
  let jobTempDir = null;
  let outputPath = null;

  try {
    const videoId = extractYouTubeId(youtubeUrl);
    const jobId = `yt_${videoId}_${Date.now()}`;
    const topicHash = hashTopic(`yt::${videoId}::${language}`);

    jobTempDir = path.join(tempDir, jobId);
    await ensureDir(jobTempDir);

    // ── Step 1: Fetch audio + transcript ────────────────────────────────────
    updateJob(job, {
      status: "running",
      step: "downloading",
      progress: 5,
      message: "Downloading YouTube audio...",
    });

    const { transcript, title: rawTitle, audioPath: ytAudioPath } =
      await fetchYouTubeTranscript(youtubeUrl, jobTempDir);

    // ── Step 2: Organize transcript with AI ─────────────────────────────────
    updateJob(job, {
      step: "organizing",
      progress: 20,
      message: "Organizing script with AI agent...",
    });

    const { title, topic, sections: rawSections } =
      await organizeYouTubeScript(transcript, rawTitle, language);

    // Add a welcome section at the front
    const greeting = {
      heading: "Introduction",
      script: `Welcome! Today we are exploring: ${title}. Let's dive in.`,
      keywords: ["introduction", "welcome", "overview"],
      visualHint: "Title text animation fading in with a glowing background",
    };
    const allSections = [greeting, ...rawSections];

    // ── Step 3: Generate TTS per section ────────────────────────────────────
    updateJob(job, {
      step: "generating_audio",
      progress: 35,
      message: `Generating voiceover for ${allSections.length} sections...`,
    });

    const audioFiles = [];
    const audioDurations = [];

    for (let i = 0; i < allSections.length; i++) {
      const sectionAudioPath = path.join(jobTempDir, `section${i}.mp3`);
      try {
        await generateSpeech(allSections[i].script, sectionAudioPath, jobTempDir, language);
        let dur = await getAudioDuration(sectionAudioPath);
        if (!dur || dur < 0.5) dur = 3;
        dur = Math.min(dur, 60);
        audioFiles.push(sectionAudioPath);
        audioDurations.push(dur);
        console.log(`[ytController] TTS section ${i + 1}/${allSections.length}: ${dur.toFixed(1)}s`);
      } catch (err) {
        console.warn(`[ytController] TTS failed for section ${i}, using silence: ${err.message}`);
        audioFiles.push(null);
        audioDurations.push(5);
      }

      // Update progress linearly through TTS generation (35% → 55%)
      const ttsProgress = 35 + Math.round((i + 1) / allSections.length * 20);
      updateJob(job, {
        progress: ttsProgress,
        message: `Generating voiceover (${i + 1}/${allSections.length})...`,
      });
    }

    // Cap total video length
    let totalDur = audioDurations.reduce((a, b) => a + b, 0);
    let activeSections = allSections.length;
    while (totalDur > MAX_VIDEO_SECONDS && activeSections > 1) {
      activeSections--;
      totalDur = audioDurations.slice(0, activeSections).reduce((a, b) => a + b, 0);
    }

    const finalSections = allSections.slice(0, activeSections);
    const finalAudioFiles = audioFiles.slice(0, activeSections);
    const finalDurations = audioDurations.slice(0, activeSections);

    console.log(
      `[ytController] rendering ${finalSections.length} sections (${totalDur.toFixed(0)}s total)`
    );

    // ── Step 4: Generate Remotion scene code ────────────────────────────────
    updateJob(job, {
      step: "generating_scenes",
      progress: 57,
      message: "AI is designing animation scenes...",
    });

    const sceneDataArray = await generateScenesCode(finalSections, finalDurations, topic);

    // ── Step 5: Render video with Remotion ──────────────────────────────────
    updateJob(job, {
      step: "rendering",
      progress: 75,
      message: "Rendering animated video...",
    });

    const outputFileName = `yt_${topicHash}_${Date.now()}.mp4`;
    outputPath = path.join(jobTempDir, outputFileName);

    await renderDetailedVideo({
      sceneDataArray,
      audioFiles: finalAudioFiles,
      sectionScripts: finalSections.map((s) => s.script),
      outputPath,
      tempDir: jobTempDir,
    });

    // ── Step 6: Upload to S3 ─────────────────────────────────────────────────
    updateJob(job, {
      step: "uploading",
      progress: 90,
      message: "Uploading video...",
    });

    const s3Result = await uploadToS3(outputPath, {
      title,
      topic,
      language,
    });

    // ── Step 7: Save to DB ───────────────────────────────────────────────────
    const record = await Video.findOneAndUpdate(
      { topicHash },
      {
        topicHash,
        topic,
        title,
        s3Key: s3Result.key,
        s3Url: s3Result.videoUrl,
        s3UploadedAt: new Date(),
        uploadTarget: "s3",
        status: "completed",
        language,
        mode: "detailed",
        sections: finalSections,
        generatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    updateJob(job, {
      status: "completed",
      step: "done",
      progress: 100,
      message: "Video ready!",
      result: {
        videoUrl: s3Result.videoUrl,
        title,
        videoId: record._id.toString(),
      },
    });

    console.log(`[ytController] pipeline complete: ${s3Result.videoUrl}`);
  } catch (err) {
    console.error("[ytController] pipeline failed:", err.message);
    updateJob(job, {
      status: "failed",
      step: "error",
      message: `Generation failed: ${err.message}`,
      error: err.message,
    });
  } finally {
    if (outputPath) await deleteFile(outputPath).catch(() => {});
    if (jobTempDir) {
      await fs.rm(jobTempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

/**
 * POST /api/youtube-video
 * Body: { youtubeUrl, language?, uploadTarget? }
 * Returns: { jobId }
 */
const createYouTubeVideo = async (req, res) => {
  const {
    youtubeUrl,
    language = "en-IN",
    uploadTarget = "s3",
  } = req.body || {};

  if (!youtubeUrl || typeof youtubeUrl !== "string") {
    return res.status(400).json({ error: "youtubeUrl is required" });
  }

  const videoId = extractYouTubeId(youtubeUrl);
  if (!videoId) {
    return res.status(400).json({
      error: "Invalid YouTube URL. Please provide a valid youtube.com or youtu.be link.",
    });
  }

  if (!["s3", "youtube"].includes(uploadTarget)) {
    return res.status(400).json({ error: "Invalid uploadTarget" });
  }

  // For now force S3 (YouTube upload is locked everywhere in the project)
  const effectiveUploadTarget = "s3";

  const jobId = `ytjob_${videoId}_${Date.now()}`;
  const job = createJob(jobId);

  console.log(`[ytController] created job ${jobId} for ${youtubeUrl}`);

  // Fire and forget — pipeline runs in background
  runYouTubePipeline(job, {
    youtubeUrl,
    language,
    uploadTarget: effectiveUploadTarget,
  });

  return res.status(202).json({ jobId, message: "Job started" });
};

/**
 * GET /api/youtube-video/status/:jobId
 * Returns current job status, progress, and result when done.
 */
const getYouTubeVideoStatus = (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found. It may have expired." });
  }

  return res.json({
    jobId: job.id,
    status: job.status,
    step: job.step,
    progress: job.progress,
    message: job.message,
    result: job.result || null,
    error: job.error || null,
  });
};

module.exports = { createYouTubeVideo, getYouTubeVideoStatus };
