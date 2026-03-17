const mongoose = require("mongoose");

const SectionSchema = new mongoose.Schema(
  {
    heading: { type: String, required: true },
    script: { type: String, required: true },
    keywords: [{ type: String, required: true }]
  },
  { _id: false }
);

const ImageSchema = new mongoose.Schema(
  {
    sectionIndex: { type: Number, required: true },
    urls: [{ type: String, required: true }],
    paths: [{ type: String, required: true }]
  },
  { _id: false }
);

const VideoSchema = new mongoose.Schema({
  topic: { type: String, required: true },
  topicHash: { type: String, required: true, index: true },
  title: { type: String },
  script: { type: String },
  sections: [SectionSchema],
  images: [ImageSchema],
  audioPath: { type: String },
  videoPath: { type: String }, // Temporary local path (deleted after upload)
  
  // YouTube integration
  youtubeVideoId: { type: String },
  youtubeUrl: { type: String },
  youtubeUploadedAt: { type: Date },

  // S3 integration
  s3Key: { type: String },
  s3Url: { type: String },
  s3UploadedAt: { type: Date },

  uploadTarget: { type: String, enum: ["youtube", "s3"], default: "s3" },
  
  status: { type: String, required: true },
  language: { type: String, default: "en-IN" },
  mode: { type: String, default: "generic" }, // "generic" | "detailed"
  generatedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Video", VideoSchema);
