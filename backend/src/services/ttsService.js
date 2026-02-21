const path = require("path");
const fsPromises = require("fs/promises");
const googleTTS = require("google-tts-api");
const { downloadFile, ensureDir } = require("../utils/file");
const { runFfmpeg } = require("./ffmpegService");

const chunkText = (text, maxLength) => {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength) {
      if (current) {
        chunks.push(current);
      }
      current = word;
    } else {
      current = next;
    }
  });

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

const generateSpeech = async (text, outputPath, tempDir) => {
  const chunks = chunkText(text, 200);
  console.log(`[tts] splitting into ${chunks.length} parts`);

  await ensureDir(tempDir);

  const partPaths = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const url = await googleTTS(chunks[index], "en", 1);
    console.log(`[tts] part ${index + 1}/${chunks.length} url obtained`);
    const partPath = path.join(tempDir, `tts-part-${index}.mp3`);
    await downloadFile(url, partPath);
    partPaths.push(partPath);
  }

  const listPath = path.join(tempDir, "tts-list.txt");
  const listContent = partPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n");
  await fsPromises.writeFile(listPath, listContent, "utf-8");

  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    outputPath
  ]);

  return outputPath;
};

module.exports = { generateSpeech };
