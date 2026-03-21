/**
 * cronService.js
 * 
 * Manages scheduled video generation jobs using node-cron
 */

const cron = require("node-cron");
const CronJob = require("../models/CronJob");
const { generateVideoForCron } = require("../controllers/videoController");
const { generateDetailedVideoForCron } = require("../controllers/detailedVideoController");

// Active cron tasks
const activeTasks = new Map();

// Compute the next start time for an interval job. If there are no other
// active interval jobs, start immediately. Otherwise, start intervalMinutes
// after the latest scheduled (or last-run) interval job to avoid bunching.
const computeIntervalStart = async (intervalMinutes, excludeJobId = null) => {
  const query = { intervalMode: true, isActive: true };
  if (excludeJobId) {
    query._id = { $ne: excludeJobId };
  }
  const others = await CronJob.find(query).select("nextRun lastRun").lean();
  if (!others.length) return new Date();

  const latestTs = others.reduce((max, job) => {
    const nextTs = job.nextRun ? new Date(job.nextRun).getTime() : 0;
    const lastTs = job.lastRun ? new Date(job.lastRun).getTime() : 0;
    return Math.max(max, nextTs, lastTs);
  }, 0);

  if (!latestTs) return new Date();
  return new Date(latestTs + intervalMinutes * 60 * 1000);
};

/**
 * Parse cron expression and calculate next run time
 */
const calculateNextRun = (cronExpression) => {
  try {
    // For simplicity, we'll use a basic calculation
    // In production, use a library like 'cron-parser'
    const now = new Date();
    const next = new Date(now.getTime() + 60000); // Placeholder: +1 minute
    return next;
  } catch (error) {
    console.error("[cron] failed to calculate next run:", error.message);
    return null;
  }
};

/**
 * Validate cron expression
 */
const isValidCronExpression = (expression) => {
  return cron.validate(expression);
};

/**
 * Execute a cron job
 */
const executeJob = async (jobId) => {
  try {
    console.log(`[cron] executing job ${jobId}`);
    
    const job = await CronJob.findById(jobId);
    if (!job || !job.isActive) {
      console.log(`[cron] job ${jobId} is inactive or not found`);
      return;
    }
    
    // Update status
    job.status = "running";
    job.lastRun = new Date();
    await job.save();
    
    // Generate video based on mode
    let result;
    if (job.mode === "detailed") {
      result = await generateDetailedVideoForCron(
        job.topic,
        job.language,
        job.uploadTarget || "s3",
        { curriculumData: job.curriculumData }
      );
    } else {
      result = await generateVideoForCron(
        job.topic,
        job.language,
        job.uploadTarget || "s3",
        { curriculumData: job.curriculumData }
      );
    }
    
    // Update job with results
    job.status = "completed";
    job.lastVideoId = result.videoId;
    job.lastVideoUrl = result.videoUrl;
    job.lastYouTubeUrl = result.youtubeVideoId ? result.videoUrl : undefined;
    job.errorMessage = null;
    job.updatedAt = new Date();
    await job.save();

    console.log(`[cron] job ${jobId} completed successfully. Video URL: ${result.videoUrl}`);

    // One-and-done: stop scheduling and remove the job after a successful run
    cancelJob(jobId);
    await CronJob.findByIdAndDelete(jobId);
    console.log(`[cron] job ${jobId} deleted after completion`);
    return;
  } catch (error) {
    console.error(`[cron] job ${jobId} failed:`, error.message);
    
    // Update job with error and stop further scheduling
    const job = await CronJob.findById(jobId);
    if (job) {
      job.status = "failed";
      job.errorMessage = error.message;
      job.nextRun = null;
      job.isActive = false;
      job.updatedAt = new Date();
      await job.save();

      cancelJob(jobId);
      console.log(`[cron] job ${jobId} marked failed and unscheduled`);
    }
  }
};

/**
 * Schedule an interval-based job
 */
const scheduleIntervalJob = (jobId, intervalMinutes, startDelayMs = null) => {
  // Cancel existing task if any
  if (activeTasks.has(jobId)) {
    const existingTask = activeTasks.get(jobId);
    if (existingTask.clear) {
      clearTimeout(existingTask.clear);
    } else if (existingTask.stop) {
      existingTask.stop();
    }
    activeTasks.delete(jobId);
  }
  
  // Schedule next execution
  const delayMs = startDelayMs !== null
    ? Math.max(0, startDelayMs)
    : intervalMinutes * 60 * 1000;

  const timeoutId = setTimeout(async () => {
    await executeJob(jobId);
  }, delayMs);
  
  activeTasks.set(jobId, { clear: () => clearTimeout(timeoutId), type: 'interval' });
  console.log(`[cron] scheduled interval job ${jobId} in ${Math.round(delayMs / 60000)} minutes`);
  
  return timeoutId;
};

/**
 * Schedule a cron job
 */
const scheduleJob = (jobId, cronExpression) => {
  if (!isValidCronExpression(cronExpression)) {
    throw new Error(`Invalid cron expression: ${cronExpression}`);
  }
  
  // Cancel existing task if any
  if (activeTasks.has(jobId)) {
    const existingTask = activeTasks.get(jobId);
    if (existingTask.stop) {
      existingTask.stop();
    } else if (existingTask.clear) {
      existingTask.clear();
    }
    activeTasks.delete(jobId);
  }
  
  // Create new task
  const task = cron.schedule(cronExpression, async () => {
    await executeJob(jobId);
  }, {
    scheduled: true,
    timezone: "UTC"
  });
  
  activeTasks.set(jobId, task);
  console.log(`[cron] scheduled job ${jobId} with expression: ${cronExpression}`);
  
  return task;
};

/**
 * Cancel a scheduled job
 */
const cancelJob = (jobId) => {
  if (activeTasks.has(jobId)) {
    const task = activeTasks.get(jobId);
    if (task.stop) {
      task.stop();
    } else if (task.clear) {
      task.clear();
    }
    activeTasks.delete(jobId);
    console.log(`[cron] cancelled job ${jobId}`);
    return true;
  }
  return false;
};

/**
 * Initialize all active cron jobs from database
 */
const initializeCronJobs = async () => {
  try {
    console.log("[cron] initializing scheduled jobs...");
    
    const activeJobs = await CronJob.find({ isActive: true });
    
    for (const job of activeJobs) {
      try {
        if (job.intervalMode) {
          const computedStart = job.nextRun
            ? new Date(job.nextRun)
            : await computeIntervalStart(job.intervalMinutes, job._id.toString());
          const delay = Math.max(0, computedStart.getTime() - Date.now());

          scheduleIntervalJob(job._id.toString(), job.intervalMinutes, delay);

          // Ensure nextRun exists
          if (!job.nextRun) {
            job.nextRun = computedStart;
            await job.save();
          }
        } else {
          // For traditional cron jobs
          scheduleJob(job._id.toString(), job.schedule);
          
          // Update nextRun if not set
          if (!job.nextRun) {
            job.nextRun = calculateNextRun(job.schedule);
            await job.save();
          }
        }
      } catch (error) {
        console.error(`[cron] failed to schedule job ${job._id}:`, error.message);
      }
    }
    
    console.log(`[cron] initialized ${activeTasks.size} scheduled jobs`);
  } catch (error) {
    console.error("[cron] failed to initialize jobs:", error.message);
  }
};

/**
 * Get all active tasks
 */
const getActiveTasks = () => {
  return Array.from(activeTasks.keys());
};

module.exports = {
  scheduleJob,
  scheduleIntervalJob,
  cancelJob,
  executeJob,
  initializeCronJobs,
  getActiveTasks,
  isValidCronExpression,
  calculateNextRun,
  computeIntervalStart
};
