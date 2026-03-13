/**
 * cronController.js
 * 
 * Handles CRUD operations for cron jobs
 */

const CronJob = require("../models/CronJob");
const { scheduleJob, scheduleIntervalJob, cancelJob, isValidCronExpression, calculateNextRun, executeJob, computeIntervalStart } = require("../services/cronService");

/**
 * GET /api/cron - List all cron jobs
 */
const listCronJobs = async (req, res) => {
  try {
    const jobs = await CronJob.find().sort({ createdAt: -1 });
    res.json({ success: true, jobs });
  } catch (error) {
    console.error("[cron-api] list failed:", error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/cron/:id - Get a single cron job
 */
const getCronJob = async (req, res) => {
  try {
    const job = await CronJob.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Cron job not found" });
    }
    res.json({ success: true, job });
  } catch (error) {
    console.error("[cron-api] get failed:", error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/cron - Create a new cron job
 * Body: { topic, language, mode, schedule, isActive, intervalMode, intervalMinutes }
 */
const createCronJob = async (req, res) => {
  try {
    const { 
      topic, 
      language = "en-IN", 
      mode = "generic", 
      schedule, 
      isActive = true,
      intervalMode = false,
      intervalMinutes = 30,
      rapid = false
    } = req.body;
    
    if (!topic) {
      return res.status(400).json({ error: "Topic is required" });
    }
    
    let nextRun;
    
    if (intervalMode) {
      // For interval mode, validate interval minutes unless rapid
      if (!rapid) {
        if (!intervalMinutes || intervalMinutes < 1) {
          return res.status(400).json({ error: "Invalid interval minutes" });
        }
      }
      const firstRun = rapid ? new Date() : await computeIntervalStart(intervalMinutes);
      nextRun = firstRun;
    } else {
      // For traditional cron mode
      if (!schedule) {
        return res.status(400).json({ error: "Schedule is required for cron mode" });
      }
      
      if (!isValidCronExpression(schedule)) {
        return res.status(400).json({ error: "Invalid cron expression" });
      }
      
      nextRun = calculateNextRun(schedule);
    }
    
    const job = await CronJob.create({
      topic,
      language,
      mode,
      schedule: intervalMode ? "interval" : schedule,
      isActive,
      intervalMode,
      intervalMinutes: intervalMode ? intervalMinutes : 30,
      rapid: intervalMode ? rapid : false,
      nextRun,
      status: "pending"
    });
    
    // Schedule the job if active
    if (isActive) {
      if (intervalMode) {
        const startDelayMs = rapid ? 0 : Math.max(0, nextRun.getTime() - Date.now());
        scheduleIntervalJob(job._id.toString(), intervalMinutes, startDelayMs);
      } else {
        scheduleJob(job._id.toString(), schedule);
      }
    }
    
    console.log(`[cron-api] created ${intervalMode ? 'interval' : 'cron'} job ${job._id} for topic: ${topic}`);
    res.status(201).json({ success: true, job });
  } catch (error) {
    console.error("[cron-api] create failed:", error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * PUT /api/cron/:id - Update a cron job
 */
const updateCronJob = async (req, res) => {
  try {
    const job = await CronJob.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Cron job not found" });
    }
    
    const { topic, language, mode, schedule, isActive, rapid } = req.body;
    
    // Validate schedule if provided
    if (schedule && !isValidCronExpression(schedule)) {
      return res.status(400).json({ error: "Invalid cron expression" });
    }
    
    // Update fields
    if (topic !== undefined) job.topic = topic;
    if (language !== undefined) job.language = language;
    if (mode !== undefined) job.mode = mode;
    if (schedule !== undefined) {
      job.schedule = schedule;
      job.nextRun = calculateNextRun(schedule);
    }
    if (isActive !== undefined) job.isActive = isActive;
    
    job.updatedAt = new Date();
    await job.save();
    
    // Reschedule or cancel based on new state
    const jobId = job._id.toString();
    cancelJob(jobId); // Cancel existing schedule
    
    if (job.isActive) {
      if (job.intervalMode) {
        const startAt = (rapid || job.rapid)
          ? new Date()
          : (job.nextRun && job.nextRun > new Date()
              ? new Date(job.nextRun)
              : await computeIntervalStart(job.intervalMinutes, jobId));
        job.nextRun = startAt;
        if (rapid !== undefined) job.rapid = rapid;
        await job.save();
        const startDelayMs = (rapid || job.rapid) ? 0 : Math.max(0, startAt.getTime() - Date.now());
        scheduleIntervalJob(jobId, job.intervalMinutes, startDelayMs);
      } else {
        scheduleJob(jobId, job.schedule);
      }
    }
    
    console.log(`[cron-api] updated job ${jobId}`);
    res.json({ success: true, job });
  } catch (error) {
    console.error("[cron-api] update failed:", error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * DELETE /api/cron/:id - Delete a cron job
 */
const deleteCronJob = async (req, res) => {
  try {
    const job = await CronJob.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Cron job not found" });
    }
    
    // Cancel scheduled task
    cancelJob(job._id.toString());
    
    // Delete from database
    await CronJob.findByIdAndDelete(req.params.id);
    
    console.log(`[cron-api] deleted job ${req.params.id}`);
    res.json({ success: true, message: "Cron job deleted" });
  } catch (error) {
    console.error("[cron-api] delete failed:", error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/cron/:id/toggle - Toggle job active status
 */
const toggleCronJob = async (req, res) => {
  try {
    const job = await CronJob.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Cron job not found" });
    }
    
    job.isActive = !job.isActive;
    job.updatedAt = new Date();
    await job.save();
    
    const jobId = job._id.toString();
    cancelJob(jobId);
    
    if (job.isActive) {
      if (job.intervalMode) {
        const startAt = job.rapid
          ? new Date()
          : (job.nextRun && job.nextRun > new Date()
              ? new Date(job.nextRun)
              : await computeIntervalStart(job.intervalMinutes, jobId));
        job.nextRun = startAt;
        await job.save();
        const startDelayMs = job.rapid ? 0 : Math.max(0, startAt.getTime() - Date.now());
        scheduleIntervalJob(jobId, job.intervalMinutes, startDelayMs);
      } else {
        scheduleJob(jobId, job.schedule);
      }
    }
    
    console.log(`[cron-api] toggled job ${jobId} to ${job.isActive ? "active" : "inactive"}`);
    res.json({ success: true, job });
  } catch (error) {
    console.error("[cron-api] toggle failed:", error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * DELETE /api/cron/completed - Delete all completed cron jobs
 */
const deleteCompletedCronJobs = async (_req, res) => {
  try {
    const completedJobs = await CronJob.find({ status: "completed" }).select("_id");
    const ids = completedJobs.map((j) => j._id.toString());

    // Cancel any scheduled tasks for these jobs
    ids.forEach((id) => cancelJob(id));

    const result = await CronJob.deleteMany({ status: "completed" });
    console.log(`[cron-api] deleted ${result.deletedCount} completed jobs`);
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    console.error("[cron-api] delete completed failed:", error.message);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  listCronJobs,
  getCronJob,
  createCronJob,
  updateCronJob,
  deleteCronJob,
  toggleCronJob,
  deleteCompletedCronJobs
};
