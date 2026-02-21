const path = require("path");
const Video = require("../models/Video");
const { normalizeTopic } = require("../utils/text");
const { hashTopic } = require("../utils/hash");
const { fileExists } = require("../utils/file");

const storageRoot = path.resolve(__dirname, "../../storage");
const videoDir = path.join(storageRoot, "videos");

const getCachedVideo = async (topic) => {
  const normalized = normalizeTopic(topic);
  const topicHash = hashTopic(normalized);
  const cached = await Video.findOne({ topicHash, status: "completed" });
  if (cached && cached.videoPath && (await fileExists(cached.videoPath))) {
    return cached;
  }
  return null;
};

module.exports = { getCachedVideo, videoDir };
