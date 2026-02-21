const path = require("path");
const Video = require("../models/Video");
const { hashTopic } = require("../utils/hash");
const { normalizeTopic, trimSectionsToWordLimit } = require("../utils/text");
const { fileExists, ensureDir, downloadFile } = require("../utils/file");
const { generateScript } = require("../services/geminiService");
const { generateKeywordsForScript } = require("../services/keywordGeneratorService");
const { searchImagesForKeywords } = require("../services/photoApiService");
const { generateSpeech } = require("../services/ttsService");
const { renderVideo } = require("../services/ffmpegService");

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

const generateVideo = async (req, res) => {
  try {
    const topic = req.body.topic;
    if (!topic || typeof topic !== "string") {
      return res.status(400).json({ error: "Topic is required" });
    }

    const normalized = normalizeTopic(topic);
    const topicHash = hashTopic(normalized);
    console.log(`[video] start topicHash=${topicHash}`);

    const cached = await Video.findOne({ topicHash, status: "completed" });
    if (cached && cached.videoPath && (await fileExists(cached.videoPath))) {
      console.log(`[video] cache hit topicHash=${topicHash}`);
      return res.json({
        status: "cached",
        videoUrl: buildVideoUrl(req, cached.videoPath),
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

    console.log(`[video] requesting gemini`);
    const aiResponse = await generateScript(topic);
    if (!aiResponse || !Array.isArray(aiResponse.sections)) {
      throw new Error("Invalid Gemini response");
    }

    const normalizedSections = aiResponse.sections.map((section) => ({
      heading: String(section.heading || ""),
      script: String(section.script || ""),
      keywords: Array.isArray(section.keywords) ? section.keywords.map(String) : []
    }));

    const sections = trimSectionsToWordLimit(normalizedSections, 400);
    console.log(`[video] sections=${sections.length}`);

    if (sections.length < 5 || sections.length > 8) {
      throw new Error("Section count must be between 5 and 8");
    }

    const topicImagesDir = path.join(imageDir, topicHash);
    await ensureDir(topicImagesDir);

    console.log("[video] generating keywords from script");
    const allKeywords = await generateKeywordsForScript(sections);
    console.log(`[video] generated ${allKeywords.length} keywords:`, allKeywords);

    if (allKeywords.length === 0) {
      throw new Error("Failed to generate keywords from script");
    }

    console.log("[video] fetching images for all keywords");
    const searchResponse = await searchImagesForKeywords(allKeywords, 1);
    console.log(
      `[video] image fetch complete: ${searchResponse.successful}/${searchResponse.total_keywords} keywords succeeded`
    );

    const imagePaths = [];
    for (let resultIdx = 0; resultIdx < searchResponse.results.length; resultIdx += 1) {
      const result = searchResponse.results[resultIdx];
      if (result.success && result.result && Array.isArray(result.result.images)) {
        let downloaded = false;
        
        // Try multiple images from result if available
        for (let imgIdx = 0; imgIdx < Math.min(result.result.images.length, 3); imgIdx += 1) {
          const imageData = result.result.images[imgIdx];
          const imageUrl = imageData?.image || imageData;
          
          if (imageUrl && typeof imageUrl === 'string') {
            // Skip SVG and other incompatible formats
            if (imageUrl.toLowerCase().includes('.svg') || imageUrl.toLowerCase().endsWith('.svg')) {
              console.warn(`[video] skipping SVG image for "${result.keyword}"`);
              continue;
            }
            
            const imagePath = path.join(topicImagesDir, `image-${resultIdx}.jpg`);
            try {
              await downloadFile(imageUrl, imagePath);
              
              // Verify file size (skip if too small/empty)
              const stats = await require('fs/promises').stat(imagePath);
              if (stats.size < 1000) {
                console.warn(`[video] downloaded file too small for "${result.keyword}", trying next`);
                await require('fs/promises').unlink(imagePath).catch(() => {});
                continue;
              }
              
              imagePaths.push(imagePath);
              console.log(`[video] downloaded image for keyword "${result.keyword}"`);
              downloaded = true;
              break; // Success, move to next keyword
            } catch (downloadError) {
              console.warn(`[video] attempt ${imgIdx + 1} failed for "${result.keyword}": ${downloadError.message}`);
            }
          }
        }
        
        if (!downloaded) {
          console.warn(`[video] all download attempts failed for keyword "${result.keyword}"`);
        }
        
        // Random delay between 300-800ms to appear more human
        const delay = 300 + Math.floor(Math.random() * 500);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.warn(`[video] no images found for keyword "${result.keyword}"`);
      }
    }

    if (imagePaths.length === 0) {
      throw new Error("Failed to fetch images for any sections");
    }

    const scriptText = sections.map((section) => section.script).join(" ");

    await ensureDir(audioDir);
    await ensureDir(videoDir);

    const audioPath = path.join(audioDir, `${topicHash}.mp3`);
    const videoPath = path.join(videoDir, `${topicHash}.mp4`);

    console.log("[video] generating audio");
    await generateSpeech(scriptText, audioPath, tempDir);
    console.log("[video] rendering video");
    await renderVideo({ imagePaths, audioPath, outputPath: videoPath });

    record.title = aiResponse.title;
    record.script = scriptText;
    record.sections = sections;
    record.imagePathsCount = imagePaths.length;
    record.audioPath = audioPath;
    record.videoPath = videoPath;
    record.status = "completed";
    await record.save();
    console.log(`[video] completed topicHash=${topicHash}`);

    return res.json({
      status: "completed",
      videoUrl: buildVideoUrl(req, videoPath),
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
    videoUrl: video.videoPath ? buildVideoUrl(req, video.videoPath) : null
  }));
  return res.json({ items });
};

module.exports = { generateVideo, listVideos };
