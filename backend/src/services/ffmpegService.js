const path = require("path");
const fsPromises = require("fs/promises");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;

const runFfmpeg = (args, timeoutMs = 600000) =>
  new Promise((resolve, reject) => {
    console.log(`[ffmpeg] running: ffmpeg ${args.join(" ").slice(0, 120)}...`);
    const ffmpeg = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const maxStderrLength = 50000;
    let lastLog = Date.now();
    let killed = false;

    // Timeout safety — kill if no output for too long
    const timer = timeoutMs > 0 ? setTimeout(() => {
      killed = true;
      ffmpeg.kill("SIGKILL");
      reject(new Error(`[ffmpeg] process timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs) : null;

    ffmpeg.stderr.on("data", (data) => {
      if (stderr.length < maxStderrLength) stderr += data.toString();
      // Log progress every 15 seconds
      if (Date.now() - lastLog > 15000) {
        const match = data.toString().match(/frame=\s*(\d+)/);
        if (match) console.log(`[ffmpeg] progress: frame ${match[1]}`);
        lastLog = Date.now();
      }
    });
    ffmpeg.on("error", (err) => { if (timer) clearTimeout(timer); if (!killed) reject(err); });
    ffmpeg.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (killed) return;
      if (code === 0) resolve();
      else reject(new Error(stderr));
    });
  });

const runFfprobe = (args) =>
  new Promise((resolve, reject) => {
    const ffprobe = spawn(ffprobePath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    ffprobe.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    ffprobe.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    ffprobe.on("error", (err) => reject(err));
    ffprobe.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr));
      }
    });
  });

// ─── Caption helpers (drawtext — no external file, no path-escaping issues) ────────
/**
 * Strip chars that would break FFmpeg's drawtext option parser.
 * Apostrophes, colons, backslashes, commas are all special inside filter strings.
 */
const sanitizeForDrawtext = (text) =>
  String(text || "")
    .replace(/["'\\:,;[\]{}|<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);

/**
 * Build a chain of drawtext filters — one per syncPlan item.
 * Each filter is only visible during its image's time window.
 * Returns an array of filter strings; join with "," for the -vf argument.
 */
const buildDrawtextVf = (syncPlan) => {
  const filters = [];
  let t = 0;
  for (const item of syncPlan) {
    const text = sanitizeForDrawtext((item.captionText || "").trim());
    if (text) {
      const startT = t.toFixed(3);
      const endT = Math.max(t + 0.1, t + item.duration - 0.1).toFixed(3);
      filters.push(
        `drawtext=text='${text}':fontsize=22:fontcolor=white:` +
        `box=1:boxcolor=black@0.5:boxborderw=8:` +
        `x=(w-text_w)/2:y=h-th-30:` +
        `enable='between(t,${startT},${endT})'`
      );
    }
    t += item.duration;
  }
  return filters;
};

const getAudioDuration = async (audioPath) => {
  const output = await runFfprobe([
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    audioPath
  ]);
  const duration = Number.parseFloat(output);
  return Number.isFinite(duration) ? duration : 0;
};

// ─── Ken Burns styles ───────────────────────────────────────────────────────
// Source is pre-normalised to exactly 1920×1080 by normalizeToJpeg.
// Output is 1280×720.
const KB_STYLES = [
  // 0: Slow zoom in — center
  (frames) =>
    `zoompan=z='min(zoom+0.0010,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1280x720:fps=25,setsar=1`,

  // 1: Slow zoom out — center
  (frames) =>
    `zoompan=z='if(eq(on\\,1)\\,1.10\\,max(1.001\\,zoom-0.0010))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1280x720:fps=25,setsar=1`,

  // 2: Pan left → right (constant zoom, drifting x)
  (frames) =>
    `zoompan=z='1.08':x='iw*(1-1/zoom)*(on/${frames})':y='ih/2-(ih/zoom/2)':d=${frames}:s=1280x720:fps=25,setsar=1`,

  // 3: Pan right → left
  (frames) =>
    `zoompan=z='1.08':x='iw*(1-1/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)':d=${frames}:s=1280x720:fps=25,setsar=1`,

  // 4: Zoom in — top-left corner
  (frames) =>
    `zoompan=z='min(zoom+0.0008,1.08)':x='0':y='0':d=${frames}:s=1280x720:fps=25,setsar=1`,

  // 5: Zoom in — bottom-right corner
  (frames) =>
    `zoompan=z='min(zoom+0.0008,1.08)':x='iw*(1-1/zoom)':y='ih*(1-1/zoom)':d=${frames}:s=1280x720:fps=25,setsar=1`,
];

// Transitions: light ones inside a section, dramatic ones at section boundaries
const TRANSITIONS_WITHIN = ["fade", "smoothleft", "smoothright", "fadewhite"];
const TRANSITIONS_BOUNDARY = ["fadeblack", "wipeleft", "wiperight", "circleopen"];

const buildFilterComplex = (imageCount, segmentDuration, fps) => {
  const zoomFrames = Math.max(1, Math.round(segmentDuration * fps));
  const lines = [];
  for (let index = 0; index < imageCount; index += 1) {
    lines.push(
      `[${index}:v]scale=1280:720,zoompan=z='min(zoom+0.0008,1.08)':d=${zoomFrames}:s=1280x720,setsar=1[v${index}]`
    );
  }

  let last = "v0";
  for (let index = 1; index < imageCount; index += 1) {
    const offset = segmentDuration * index - 0.5 * index;
    const next = `v${index}x`;
    lines.push(
      `[${last}][v${index}]xfade=transition=fade:duration=0.5:offset=${offset.toFixed(2)}[${next}]`
    );
    last = next;
  }

  return { filter: lines.join(";"), finalLabel: last };
};

/**
 * Build filter complex with variable durations, Ken Burns variety and diverse transitions.
 * @param {Array<{duration: number, kbStyle?: number, sectionIndex?: number}>} syncPlan
 * @param {number} fps
 * @returns {{ filter: string, finalLabel: string, totalDuration: number }}
 */
const buildVariableFilterComplex = (syncPlan, fps) => {
  const FADE_DUR = 0.4;
  const lines = [];
  const imageCount = syncPlan.length;

  // Ken Burns per image
  for (let i = 0; i < imageCount; i += 1) {
    const { duration, kbStyle } = syncPlan[i];
    const frames = Math.max(2, Math.round(duration * fps));
    const styleIdx = (kbStyle !== undefined ? kbStyle : i) % KB_STYLES.length;
    const kb = KB_STYLES[styleIdx](frames);
    lines.push(`[${i}:v]${kb}[v${i}]`);
  }

  if (imageCount === 1) {
    // Single image — no xfade needed
    return { filter: lines.join(";"), finalLabel: "v0", totalDuration: syncPlan[0].duration };
  }

  // Xfade transitions: offset = when the transition starts (from timeline start)
  let last = "v0";
  // First image plays for its full duration, then transition starts at (dur0 - fadeDur)
  let offset = Math.max(0, syncPlan[0].duration - FADE_DUR);
  let withinIdx = 0;
  let boundaryIdx = 0;

  for (let i = 1; i < imageCount; i += 1) {
    const prevSection = syncPlan[i - 1].sectionIndex;
    const currSection = syncPlan[i].sectionIndex;
    const isBoundary = (prevSection !== undefined && currSection !== undefined && prevSection !== currSection);

    const transition = isBoundary
      ? TRANSITIONS_BOUNDARY[boundaryIdx++ % TRANSITIONS_BOUNDARY.length]
      : TRANSITIONS_WITHIN[withinIdx++ % TRANSITIONS_WITHIN.length];

    const next = `v${i}x`;
    lines.push(
      `[${last}][v${i}]xfade=transition=${transition}:duration=${FADE_DUR}:offset=${offset.toFixed(3)}[${next}]`
    );
    last = next;
    // Next offset = current offset + current image duration - fadeDur
    offset += syncPlan[i].duration - FADE_DUR;
  }

  // Total video duration = last offset + fadeDur (the last fade)
  const totalDuration = offset + FADE_DUR;
  return { filter: lines.join(";"), finalLabel: last, totalDuration };
};

/**
 * Normalise any image (WebP, CMYK JPEG, PNG, etc.) to a plain YUV420p JPEG.
 * This ensures -loop 1 works regardless of source format.
 * Returns the output path (same as provided).
 */
const normalizeToJpeg = async (inputPath, outputPath) => {
  await runFfmpeg([
    "-y",
    "-i", inputPath,
    "-frames:v", "1",
    "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p",
    "-q:v", "2",
    outputPath
  ]);
  return outputPath;
};

const renderVideo = async ({ imagePaths, audioPath, outputPath }) => {
  const audioDuration = await getAudioDuration(audioPath);
  const imageCount = imagePaths.length;
  const minDuration = 2;
  const segmentDuration = Math.max(minDuration, audioDuration / Math.max(1, imageCount));
  const fps = 30;
  const { filter, finalLabel } = buildFilterComplex(imageCount, segmentDuration, fps);

  const args = ["-y"];
  imagePaths.forEach((imagePath) => {
    args.push("-loop", "1", "-t", segmentDuration.toFixed(2), "-i", imagePath);
  });
  args.push("-i", audioPath);
  args.push(
    "-filter_complex",
    filter,
    "-map",
    `[${finalLabel}]`,
    "-map",
    `${imageCount}:a`,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-r",
    String(fps),
    "-pix_fmt",
    "yuv420p",
    "-shortest",
    outputPath
  );

  await runFfmpeg(args);
  return { duration: audioDuration, segmentDuration };
};

/**
 * Render video with variable-duration images, Ken Burns variety, diverse transitions and audio fades.
 * @param {Array<{imagePath: string, duration: number, kbStyle?: number, sectionIndex?: number}>} syncPlan
 * @param {string} audioPath - merged audio
 * @param {string} outputPath
 */
const renderSyncedVideo = async ({ syncPlan, audioPath, outputPath }) => {
  // --- Step 1: Normalise all images to plain JPEG so -loop 1 always works ---
  // (WebP / CMYK / exotic formats cause "Option loop not found" with webp_pipe)
  const normDir = path.join(path.dirname(outputPath), `_norm_${Date.now()}`);
  await fsPromises.mkdir(normDir, { recursive: true });

  const normalisedPlan = await Promise.all(
    syncPlan.map(async (item, i) => {
      const normPath = path.join(normDir, `img_${i}.jpg`);
      try {
        await normalizeToJpeg(item.imagePath, normPath);
        return { ...item, imagePath: normPath };
      } catch (err) {
        // If normalisation fails, copy the original and hope for the best
        console.warn(`[ffmpeg] normalise failed for image ${i}, using original: ${err.message}`);
        await fsPromises.copyFile(item.imagePath, normPath).catch(() => {});
        return { ...item, imagePath: normPath };
      }
    })
  );

  const imageCount = normalisedPlan.length;
  const fps = 25;

  const { filter, finalLabel, totalDuration } = buildVariableFilterComplex(normalisedPlan, fps);

  // Audio fade-in (0.6s) and fade-out (1.2s) for polished feel
  const audioDuration = await getAudioDuration(audioPath);

  // Hard cap: audio duration is clamped to totalDuration+2s to prevent corrupt
  // audio headers (claiming hours) from causing the last image to loop forever.
  const safeDuration = Math.min(audioDuration, totalDuration + 2);
  const safeAudioFilter =
    `afade=t=in:st=0:d=0.6,afade=t=out:st=${Math.max(0, safeDuration - 1.2).toFixed(3)}:d=1.2`;

  // ── Pass 1: render video + audio (no captions) ──────────────────────────
  // Captions are added in a separate pass so a broken subtitles filter can
  // never strip the audio stream.
  const rawVideoPath = path.join(normDir, "raw.mp4");

  const args = ["-y"];
  for (let i = 0; i < imageCount; i += 1) {
    const dur = (normalisedPlan[i].duration + 0.5).toFixed(3);
    args.push("-loop", "1", "-t", dur, "-i", normalisedPlan[i].imagePath);
  }
  args.push("-i", audioPath);
  args.push(
    "-filter_complex", `${filter};[${imageCount}:a]${safeAudioFilter}[aout]`,
    "-map", `[${finalLabel}]`,
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-r", "25",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-t", totalDuration.toFixed(3),
    rawVideoPath
  );
  await runFfmpeg(args);

  // ── Pass 2: burn drawtext captions (no external file — no path-escaping issues) ───
  const drawtextFilters = buildDrawtextVf(normalisedPlan);
  if (drawtextFilters.length > 0) {
    try {
      await runFfmpeg([
        "-y",
        "-i", rawVideoPath,
        "-vf", drawtextFilters.join(","),
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "23",
        "-c:a", "copy",
        "-movflags", "+faststart",
        outputPath
      ]);
      console.log("[ffmpeg] captions burned successfully");
    } catch (captionErr) {
      console.warn("[ffmpeg] caption burn failed, using video without captions:", captionErr.message.slice(0, 120));
      await fsPromises.copyFile(rawVideoPath, outputPath);
    }
  } else {
    await fsPromises.copyFile(rawVideoPath, outputPath);
  }

  // Clean up normalised temp images
  await fsPromises.rm(normDir, { recursive: true, force: true }).catch(() => {});

  return { duration: totalDuration };
};

module.exports = {
  runFfmpeg,
  getAudioDuration,
  normalizeToJpeg,
  renderVideo,
  renderSyncedVideo
};
