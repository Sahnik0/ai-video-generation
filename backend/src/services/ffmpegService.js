const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;

const runFfmpeg = (args) =>
  new Promise((resolve, reject) => {
    console.log(`[ffmpeg] running: ffmpeg ${args.join(" ").slice(0, 120)}...`);
    const ffmpeg = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const maxStderrLength = 50000;
    ffmpeg.stderr.on("data", (data) => {
      if (stderr.length < maxStderrLength) {
        stderr += data.toString();
      }
    });
    ffmpeg.on("error", (err) => reject(err));
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr));
      }
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

module.exports = {
  runFfmpeg,
  getAudioDuration,
  renderVideo
};
