const crypto = require("crypto");

const hashTopic = (topic) =>
  crypto.createHash("sha256").update(topic).digest("hex");

module.exports = { hashTopic };
