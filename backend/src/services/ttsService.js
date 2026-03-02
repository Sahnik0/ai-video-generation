const path = require("path");
const fsPromises = require("fs/promises");
const axios = require("axios");
const { ensureDir } = require("../utils/file");
const { runFfmpeg } = require("./ffmpegService");
const { env } = require("../config/env");

const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech";
const MAX_CHUNK_LENGTH = 2400;

/**
 * Strip fancy Unicode that can cause TTS API errors.
 * Replace/strip problematic characters before every API call.
 */
const sanitizeForTts = (text) =>
  String(text || "")
    .replace(/\u2014|\u2013/g, ", ")   // em-dash, en-dash → comma
    .replace(/\u2026/g, "...")          // ellipsis → three dots
    .replace(/[\u2018\u2019]/g, "'")   // curly single quotes
    .replace(/[\u201C\u201D]/g, '"')   // curly double quotes
    .replace(/[\u00B7\u2022\u2023]/g, "-") // bullets
    .replace(/[^\x00-\x7F\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/g, " ") // strip non-ASCII outside supported scripts
    .replace(/\s+/g, " ")
    .trim();

// bulbul:v2 speakers (v3 is currently returning 500)
const TTS_MODEL = "bulbul:v2";
const LANGUAGE_SPEAKERS = {
  "en-IN": "arya",
  "hi-IN": "arya",
  "bn-IN": "arya",
  "te-IN": "arya",
  "ta-IN": "arya",
  "mr-IN": "arya",
  "gu-IN": "arya",
  "kn-IN": "arya",
  "ml-IN": "arya",
  "od-IN": "arya",
  "pa-IN": "arya",
};

// Split text at sentence boundaries to keep natural speech flow
const chunkText = (text, maxLength) => {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxLength) {
      if (current) chunks.push(current.trim());
      // If a single sentence exceeds limit, split by words
      if (sentence.length > maxLength) {
        const words = sentence.split(/\s+/);
        let wordChunk = "";
        for (const word of words) {
          const next = wordChunk ? `${wordChunk} ${word}` : word;
          if (next.length > maxLength) {
            if (wordChunk) chunks.push(wordChunk.trim());
            wordChunk = word;
          } else {
            wordChunk = next;
          }
        }
        current = wordChunk;
      } else {
        current = sentence;
      }
    } else {
      current = candidate;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
};

const generateSpeech = async (text, outputPath, tempDir, languageCode = "en-IN") => {
  const chunks = chunkText(sanitizeForTts(text), MAX_CHUNK_LENGTH);
  const speaker = LANGUAGE_SPEAKERS[languageCode] || "arya";
  console.log(`[tts] splitting into ${chunks.length} parts | language=${languageCode} speaker=${speaker}`);

  await ensureDir(tempDir);

  const partPaths = [];
  for (let index = 0; index < chunks.length; index += 1) {
    console.log(`[tts] generating part ${index + 1}/${chunks.length} via Sarvam AI (${chunks[index].length} chars)`);

    let lastError;
    let base64Audio = null;

    // Retry up to 3 times on transient failures
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await axios.post(
          SARVAM_TTS_URL,
          {
            text: chunks[index],
            target_language_code: languageCode,
            speaker,
            model: TTS_MODEL,
            speech_sample_rate: 24000,
            pace: 1.0
          },
          {
            headers: {
              "api-subscription-key": env.sarvamApiKey,
              "Content-Type": "application/json"
            },
            timeout: 30000
          }
        );
        base64Audio = response.data.audios[0];
        break;
      } catch (err) {
        lastError = err;
        const errDetail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        console.warn(`[tts] attempt ${attempt + 1} failed for part ${index + 1}: ${errDetail}`);
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    if (!base64Audio) {
      const errDetail = lastError?.response?.data ? JSON.stringify(lastError.response.data) : lastError?.message;
      throw new Error(`[tts] failed to generate audio for part ${index + 1}: ${errDetail}`);
    }

    const audioBuffer = Buffer.from(base64Audio, "base64");
    const partPath = path.join(tempDir, `tts-part-${index}.wav`);
    await fsPromises.writeFile(partPath, audioBuffer);
    partPaths.push(partPath);
    console.log(`[tts] part ${index + 1}/${chunks.length} saved (${audioBuffer.length} bytes)`);
  }

  // Write FFmpeg concat list
  const listPath = path.join(tempDir, "tts-list.txt");
  const listContent = partPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n");
  await fsPromises.writeFile(listPath, listContent, "utf-8");

  // Concatenate WAV parts and encode to MP3
  await runFfmpeg([
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-c:a", "libmp3lame",
    "-q:a", "2",
    "-ar", "24000",
    outputPath
  ]);

  return outputPath;
};

/**
 * Generate TTS audio for each section individually.
 * Returns an array of { sectionIndex, audioPath, duration } objects
 * plus a merged final audio file.
 */
const generateSectionAudio = async (sections, outputPath, tempDir, languageCode = "en-IN") => {
  const speaker = LANGUAGE_SPEAKERS[languageCode] || "arya";
  await ensureDir(tempDir);

  const sectionAudios = [];

  for (let sIdx = 0; sIdx < sections.length; sIdx += 1) {
    const sectionText = sections[sIdx].script;
    if (!sectionText || !sectionText.trim()) {
      console.warn(`[tts] section ${sIdx} has no script text, skipping`);
      continue;
    }

    const chunks = chunkText(sanitizeForTts(sectionText), MAX_CHUNK_LENGTH);
    const sectionPartPaths = [];

    for (let cIdx = 0; cIdx < chunks.length; cIdx += 1) {
      console.log(`[tts] section ${sIdx} chunk ${cIdx + 1}/${chunks.length} (${chunks[cIdx].length} chars)`);

      let base64Audio = null;
      let lastError;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await axios.post(
            SARVAM_TTS_URL,
            {
              text: chunks[cIdx],
              target_language_code: languageCode,
              speaker,
              model: TTS_MODEL,
              speech_sample_rate: 24000,
              pace: 1.0
            },
            {
              headers: {
                "api-subscription-key": env.sarvamApiKey,
                "Content-Type": "application/json"
              },
              timeout: 30000
            }
          );
          base64Audio = response.data.audios[0];
          break;
        } catch (err) {
          lastError = err;
          const errDetail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
          console.warn(`[tts] section ${sIdx} chunk ${cIdx + 1} attempt ${attempt + 1} failed: ${errDetail}`);
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }

      if (!base64Audio) {
        const errDetail = lastError?.response?.data ? JSON.stringify(lastError.response.data) : lastError?.message;
        throw new Error(`[tts] failed section ${sIdx} chunk ${cIdx + 1}: ${errDetail}`);
      }

      const buf = Buffer.from(base64Audio, "base64");
      const partPath = path.join(tempDir, `tts-s${sIdx}-c${cIdx}.wav`);
      await fsPromises.writeFile(partPath, buf);
      sectionPartPaths.push(partPath);
    }

    // Merge chunks for this section into one WAV
    const sectionAudioPath = path.join(tempDir, `section-${sIdx}.wav`);
    if (sectionPartPaths.length === 1) {
      await fsPromises.copyFile(sectionPartPaths[0], sectionAudioPath);
    } else {
      const listPath = path.join(tempDir, `tts-section-${sIdx}-list.txt`);
      const listContent = sectionPartPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n");
      await fsPromises.writeFile(listPath, listContent, "utf-8");
      await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", sectionAudioPath]);
    }

    // Get duration of this section's audio
    const { getAudioDuration } = require("./ffmpegService");
    const duration = await getAudioDuration(sectionAudioPath);
    console.log(`[tts] section ${sIdx} audio: ${duration.toFixed(2)}s`);

    sectionAudios.push({ sectionIndex: sIdx, audioPath: sectionAudioPath, duration });
  }

  // Merge all sections into the final output
  const finalListPath = path.join(tempDir, "tts-final-list.txt");
  const finalListContent = sectionAudios
    .map((sa) => `file '${sa.audioPath.replace(/\\/g, "/")}'`)
    .join("\n");
  await fsPromises.writeFile(finalListPath, finalListContent, "utf-8");

  await runFfmpeg([
    "-y", "-f", "concat", "-safe", "0", "-i", finalListPath,
    "-c:a", "libmp3lame", "-q:a", "2", "-ar", "24000",
    outputPath
  ]);

  console.log(`[tts] all ${sectionAudios.length} sections merged → ${path.basename(outputPath)}`);
  return { outputPath, sectionAudios };
};

/**
 * Generate TTS for each image's individual sub-script.
 * Each image in tweakedSections.imageScripts gets its own audio file, so the
 * video can switch images at the EXACT moment the corresponding narration begins.
 *
 * tweakedSections[i].imageScripts  — array of sub-scripts, one per image slot
 * sectionImages[i].imagePaths.length — number of images for that section
 *
 * Returns { outputPath, perImageAudios: [{sectionIndex, imageIndex, duration}] }
 */
const generatePerImageAudio = async (
  tweakedSections,
  sectionImages,
  outputPath,
  tempDir,
  languageCode = "en-IN"
) => {
  const speaker = LANGUAGE_SPEAKERS[languageCode] || "arya";
  await ensureDir(tempDir);

  // Build a quick lookup: how many images per section
  const imageCountMap = {};
  for (const si of sectionImages) {
    imageCountMap[si.sectionIndex] = si.imagePaths.length;
  }

  const perImageAudios = []; // accumulated metadata
  const allAudioPaths = [];  // flat ordered list for final concat
  let silenceCount = 0;      // track how many TTS calls failed

  for (let sIdx = 0; sIdx < tweakedSections.length; sIdx += 1) {
    const section = tweakedSections[sIdx];
    const imageScripts = section.imageScripts || [];
    const imageCount = imageCountMap[sIdx] || 0;

    if (imageCount === 0 || imageScripts.length === 0) {
      console.warn(`[tts] section ${sIdx}: no images or no imageScripts — skipping`);
      continue;
    }

    const slots = Math.min(imageScripts.length, imageCount);

    for (let imgIdx = 0; imgIdx < slots; imgIdx += 1) {
      const rawText = (imageScripts[imgIdx] || "").trim();
      const text = sanitizeForTts(rawText);
      if (!text) {
        console.warn(`[tts] section ${sIdx} img ${imgIdx}: empty imageScript, skipping`);
        continue;
      }

      console.log(`[tts] section ${sIdx} img ${imgIdx}: "${text.slice(0, 70)}..."`);

      let base64Audio = null;
      let lastError;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await axios.post(
            SARVAM_TTS_URL,
            {
              text: text.slice(0, MAX_CHUNK_LENGTH),
              target_language_code: languageCode,
              speaker,
              model: TTS_MODEL,
              speech_sample_rate: 24000,
              pace: 1.0
            },
            {
              headers: {
                "api-subscription-key": env.sarvamApiKey,
                "Content-Type": "application/json"
              },
              timeout: 30000
            }
          );
          base64Audio = response.data.audios[0];
          break;
        } catch (err) {
          lastError = err;
          const errDetail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
          console.warn(`[tts] s${sIdx}-img${imgIdx} attempt ${attempt + 1} failed: ${errDetail}`);
          if (attempt < 2) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
      }

      // Throttle: wait between Sarvam calls to avoid rate-limiting
      await new Promise((r) => setTimeout(r, 800));

      if (!base64Audio) {
        silenceCount += 1;
        // Graceful fallback: generate 2.5s silence so the image still appears in the video
        console.warn(`[tts] s${sIdx}-img${imgIdx}: all attempts failed — using 2.5s silence (${silenceCount} silences so far)`);
        const silencePath = path.join(tempDir, `tts-s${sIdx}-img${imgIdx}.wav`);
        await runFfmpeg([
          "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
          "-t", "2.5", "-c:a", "pcm_s16le", "-ar", "24000", silencePath
        ]);
        perImageAudios.push({ sectionIndex: sIdx, imageIndex: imgIdx, audioPath: silencePath, duration: 2.5 });
        allAudioPaths.push(silencePath);
        continue;
      }

      const buf = Buffer.from(base64Audio, "base64");
      const imgAudioPath = path.join(tempDir, `tts-s${sIdx}-img${imgIdx}.wav`);
      await fsPromises.writeFile(imgAudioPath, buf);

      const { getAudioDuration } = require("./ffmpegService");
      let duration = await getAudioDuration(imgAudioPath);

      // Sanity cap: 1-3 sentences can never exceed 30s; corrupt WAV headers can
      // report absurd durations (hours) which cascade into 40-minute last-image bugs
      const MAX_SANE_IMAGE_DURATION = 30;
      if (duration > MAX_SANE_IMAGE_DURATION || !Number.isFinite(duration) || duration <= 0) {
        // Re-probe after a short delay; if still bad, estimate from text length
        await new Promise((r) => setTimeout(r, 300));
        duration = await getAudioDuration(imgAudioPath);
        if (duration > MAX_SANE_IMAGE_DURATION || !Number.isFinite(duration) || duration <= 0) {
          const wordCount = (text || "").split(/\s+/).length;
          duration = Math.max(2.0, Math.min(wordCount / 2.5, MAX_SANE_IMAGE_DURATION));
          console.warn(`[tts] section ${sIdx} img ${imgIdx}: bad duration, estimated ${duration.toFixed(2)}s from ${wordCount} words`);
        }
      }

      console.log(`[tts] section ${sIdx} img ${imgIdx}: ${duration.toFixed(2)}s`);

      perImageAudios.push({ sectionIndex: sIdx, imageIndex: imgIdx, audioPath: imgAudioPath, duration });
      allAudioPaths.push(imgAudioPath);
    }
  }

  if (allAudioPaths.length === 0) {
    throw new Error("[tts] generatePerImageAudio: no audio generated for any image");
  }

  // If more than half of the TTS calls failed, the video will be mostly silent
  const totalSlots = allAudioPaths.length;
  if (silenceCount > 0) {
    console.warn(`[tts] WARNING: ${silenceCount}/${totalSlots} TTS calls failed (silence fallback used)`);
  }
  if (silenceCount >= totalSlots) {
    throw new Error(`[tts] ALL ${totalSlots} TTS calls failed — cannot produce narrated video. Check Sarvam API key and connectivity.`);
  }

  // Concatenate all image-level audio files into one final output
  const finalListPath = path.join(tempDir, "tts-perimage-list.txt");
  const finalListContent = allAudioPaths
    .map((p) => `file '${p.replace(/\\/g, "/")}'`)
    .join("\n");
  await fsPromises.writeFile(finalListPath, finalListContent, "utf-8");

  await runFfmpeg([
    "-y", "-f", "concat", "-safe", "0", "-i", finalListPath,
    "-c:a", "libmp3lame", "-q:a", "2", "-ar", "24000",
    outputPath
  ]);

  console.log(`[tts] ${allAudioPaths.length} per-image audios merged → ${path.basename(outputPath)}`);
  return { outputPath, perImageAudios };
};

module.exports = { generateSpeech, generateSectionAudio, generatePerImageAudio };
