/**
 * CronJob.js
 * 
 * Model for scheduled video generation jobs
 */

const mongoose = require("mongoose");

const CronJobSchema = new mongoose.Schema({
  topic: { type: String, required: true },
  language: { type: String, default: "en-IN" },
  mode: { type: String, enum: ["generic", "detailed"], default: "generic" },
  schedule: { type: String, required: true }, // cron expression: "0 9 * * *" or "interval"
  isActive: { type: Boolean, default: true },
  intervalMode: { type: Boolean, default: false }, // true for interval-based scheduling
  intervalMinutes: { type: Number, default: 30 }, // interval in minutes (e.g., 30)
  lastRun: { type: Date },
  nextRun: { type: Date },
  lastVideoId: { type: String },
  lastYouTubeUrl: { type: String },
  status: { type: String, enum: ["pending", "running", "completed", "failed"], default: "pending" },
  errorMessage: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

CronJobSchema.index({ isActive: 1, nextRun: 1 });

module.exports = mongoose.model("CronJob", CronJobSchema);
