/**
 * CronJob.js
 * 
 * Model for scheduled video generation jobs
 */

const mongoose = require("mongoose");

const CurriculumDataSchema = new mongoose.Schema(
  {
    curriculumId: { type: String, default: null },
    curriculumName: { type: String, default: null },
    gradeId: { type: String, default: null },
    gradeName: { type: String, default: null },
    subjectId: { type: String, default: null },
    subjectName: { type: String, default: null },
    chapterId: { type: String, default: null },
    chapterName: { type: String, default: null },
    topicId: { type: String, default: null },
    topicName: { type: String, default: null },
    subtopicId: { type: String, default: null },
    subtopicName: { type: String, default: null },
    conceptId: { type: String, default: null },
    conceptName: { type: String, default: null }
  },
  { _id: false }
);

const CronJobSchema = new mongoose.Schema({
  topic: { type: String, required: true },
  curriculumData: { type: CurriculumDataSchema, default: undefined },
  language: { type: String, default: "en-IN" },
  mode: { type: String, enum: ["generic", "detailed"], default: "generic" },
  schedule: { type: String, required: true }, // cron expression: "0 9 * * *" or "interval"
  isActive: { type: Boolean, default: true },
  intervalMode: { type: Boolean, default: false }, // true for interval-based scheduling
  intervalMinutes: { type: Number, default: 30 }, // interval in minutes (e.g., 30)
  lastRun: { type: Date },
  nextRun: { type: Date },
  lastVideoId: { type: String },
  lastVideoUrl: { type: String },
  lastYouTubeUrl: { type: String },
  uploadTarget: { type: String, enum: ["youtube", "s3"], default: "s3" },
  status: { type: String, enum: ["pending", "running", "completed", "failed"], default: "pending" },
  errorMessage: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

CronJobSchema.index({ isActive: 1, nextRun: 1 });

module.exports = mongoose.model("CronJob", CronJobSchema);
