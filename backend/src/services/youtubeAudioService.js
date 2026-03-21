/**
 * youtubeAudioService.js
 *
 * Downloads audio from a YouTube URL using yt-dlp-exec and
 * transcribes it using Gemini 2.5 Pro's native audio understanding.
 *
 * Returns: { transcript, title, audioPath }
 */

"use strict";

const path = require("path");
const fs = require("fs/promises");
const { existsSync } = require("fs");
const ytDlp = require("yt-dlp-exec");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { env } = require("../config/env");

/**
 * Extract YouTube video ID from various URL formats.
 * Supports:
 *   https://www.youtube.com/watch?v=ID
 *   https://youtu.be/ID
 *   https://youtube.com/shorts/ID
 */
function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Download YouTube audio as MP3 to tempDir using yt-dlp-exec.
 * Returns the path to the downloaded MP3.
 */
async function downloadYouTubeAudio(youtubeUrl, tempDir) {
  const videoId = extractYouTubeId(youtubeUrl);
  if (!videoId) {
    throw new Error(`Invalid YouTube URL: ${youtubeUrl}`);
  }

  const outputTemplate = path.join(tempDir, `yt_audio_${videoId}.%(ext)s`);
  const mp3Path = path.join(tempDir, `yt_audio_${videoId}.mp3`);

  // If already downloaded (e.g. retry), skip
  if (existsSync(mp3Path)) {
    console.log(`[ytAudio] found cached audio: ${mp3Path}`);
    return mp3Path;
  }

  console.log(`[ytAudio] downloading audio for video ${videoId}...`);

  await ytDlp(youtubeUrl, {
    extractAudio: true,
    audioFormat: "mp3",
    audioQuality: "128K",
    output: outputTemplate,
    noPlaylist: true,
    // Limit to 15 minutes to avoid massive files
    matchFilter: "duration < 1800",
  });

  if (!existsSync(mp3Path)) {
    // yt-dlp sometimes outputs .webm first — find whatever got downloaded
    const files = await fs.readdir(tempDir);
    const audioFile = files.find(
      (f) => f.startsWith(`yt_audio_${videoId}`) && f !== "yt_audio"
    );
    if (!audioFile) {
      throw new Error(`[ytAudio] download succeeded but no audio file found for ${videoId}`);
    }
    // Convert to MP3 via the ffmpeg we already have
    const { runFfmpeg } = require("./ffmpegService");
    const sourcePath = path.join(tempDir, audioFile);
    await runFfmpeg(["-y", "-i", sourcePath, "-q:a", "4", "-ar", "22050", mp3Path]);
    await fs.unlink(sourcePath).catch(() => {});
  }

  console.log(`[ytAudio] audio ready: ${mp3Path}`);
  return mp3Path;
}

/**
 * Fetch the video title and description from YouTube metadata.
 */
async function fetchVideoMetadata(youtubeUrl) {
  try {
    const info = await ytDlp(youtubeUrl, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      noCheckCertificate: true,
      preferFreeFormats: true,
      youtubeSkipDashManifest: true,
    });

    const title = info.title || "YouTube Video";
    const description = (info.description || "").slice(0, 500);
    const duration = info.duration || 0;
    const channelName = info.uploader || info.channel || "";

    return { title, description, duration, channelName };
  } catch (err) {
    console.warn(`[ytAudio] could not fetch metadata: ${err.message}`);
    return { title: "YouTube Video", description: "", duration: 0, channelName: "" };
  }
}

/**
 * Convert an audio file to a base64 string for the Gemini API.
 * Gemini requires audio to be passed as inline data for short files,
 * or uploaded via Files API for larger ones.
 *
 * For robustness we chunk it: if < 18 MB we use inline base64.
 * Above that we only transcribe first 60s to avoid token limits.
 */
async function transcribeWithGemini(audioPath, videoTitle = "") {
  const genAI = new GoogleGenerativeAI(env.geminiApiKey);

  // Use Gemini 2.5 Flash for transcription (fast, cheap, has audio understanding)
  const model = genAI.getGenerativeModel(
    { model: "gemini-2.5-flash" },
    { apiVersion: "v1beta" }
  );

  const stat = await fs.stat(audioPath);
  const fileSizeMb = stat.size / (1024 * 1024);
  console.log(`[ytAudio] audio size: ${fileSizeMb.toFixed(2)} MB, transcribing with Gemini...`);

  let audioData;
  let mimeType = "audio/mp3";

  if (fileSizeMb <= 18) {
    // Inline base64 — works for Gemini's 20 MB inline limit
    const buffer = await fs.readFile(audioPath);
    audioData = {
      inlineData: {
        data: buffer.toString("base64"),
        mimeType,
      },
    };
  } else {
    // Large file: truncate to first 10 MB (≈ 10 minutes at 128kbps)
    // and use that segment for transcription
    console.warn(`[ytAudio] audio too large (${fileSizeMb.toFixed(1)} MB) — truncating to 10 MB for transcription`);
    const truncPath = audioPath.replace(/\.mp3$/, "_trunc.mp3");
    const { runFfmpeg } = require("./ffmpegService");
    await runFfmpeg(["-y", "-i", audioPath, "-t", "600", "-c", "copy", truncPath]);
    const buffer = await fs.readFile(truncPath);
    audioData = {
      inlineData: {
        data: buffer.toString("base64"),
        mimeType,
      },
    };
    await fs.unlink(truncPath).catch(() => {});
  }

  const transcriptionPrompt = `You are a professional transcription assistant.

Your task: Produce a COMPLETE, VERBATIM transcript of everything spoken in this audio.

Context: The audio is from a YouTube educational video titled: "${videoTitle || 'unknown'}"

Instructions:
1. Transcribe every spoken word accurately — including all explanation, examples, and transitions.
2. Do NOT summarize, skip, or paraphrase anything.
3. Fix obvious speech-to-text errors based on context.
4. Output ONLY the clean transcript text — no timestamps, no speaker labels, no explanation.
5. Preserve paragraph breaks between topic shifts.
6. If the audio is inaudible or non-speech (music only), write "INAUDIBLE SEGMENT" for that part.
7. Write naturally flowing English that captures exactly what the teacher says.

Begin the transcript now:`;

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          audioData,
          { text: transcriptionPrompt },
        ],
      },
    ],
    generationConfig: {
      thinkingConfig: { thinkingBudget: 2048 },
    },
  });

  const transcript = result.response.text().trim();
  console.log(`[ytAudio] transcription complete: ${transcript.length} chars`);
  return transcript;
}

/**
 * Main entry point: fetch audio from YouTube and return transcript + metadata.
 *
 * @param {string} youtubeUrl  - Full YouTube URL
 * @param {string} tempDir     - Temp directory for intermediate files
 * @returns {Promise<{ transcript: string, title: string, audioPath: string, duration: number }>}
 */
async function fetchYouTubeTranscript(youtubeUrl, tempDir) {
  await fs.mkdir(tempDir, { recursive: true });

  // Fetch metadata and download audio in parallel
  const [metadata, audioPath] = await Promise.all([
    fetchVideoMetadata(youtubeUrl),
    downloadYouTubeAudio(youtubeUrl, tempDir),
  ]);

  const { title, duration, channelName } = metadata;
  console.log(`[ytAudio] video: "${title}" (${Math.round(duration / 60)}min) by ${channelName}`);

  // Transcribe
  const transcript = await transcribeWithGemini(audioPath, title);

  if (!transcript || transcript.length < 50) {
    throw new Error("[ytAudio] transcription produced insufficient text — video may be non-speech or too short");
  }

  return { transcript, title, audioPath, duration };
}

module.exports = { fetchYouTubeTranscript, extractYouTubeId };
