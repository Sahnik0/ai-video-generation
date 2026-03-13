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
      result = await generateDetailedVideoForCron(job.topic, job.language);
    } else {
      result = await generateVideoForCron(job.topic, job.language);
    }
    
    // Update job with results
    job.status = "completed";
    job.lastVideoId = result.videoId;
    job.lastYouTubeUrl = result.youtubeUrl;
    
    // Calculate next run based on mode
    if (job.intervalMode) {
      const nextRun = new Date(Date.now() + job.intervalMinutes * 60 * 1000);
      job.nextRun = nextRun;
    } else {
      job.nextRun = calculateNextRun(job.schedule);
    }
    
    job.errorMessage = null;
    job.updatedAt = new Date();
    await job.save();
    
    console.log(`[cron] job ${jobId} completed successfully. YouTube URL: ${result.youtubeUrl}`);
    
    // If interval mode, schedule next execution
    if (job.intervalMode) {
      scheduleIntervalJob(jobId, job.intervalMinutes);
    }
  } catch (error) {
    console.error(`[cron] job ${jobId} failed:`, error.message);
    
    // Update job with error
    const job = await CronJob.findById(jobId);
    if (job) {
      job.status = "failed";
      job.errorMessage = error.message;
      
      // Calculate next run even on failure
      if (job.intervalMode) {
        const nextRun = new Date(Date.now() + job.intervalMinutes * 60 * 1000);
        job.nextRun = nextRun;
      } else {
        job.nextRun = calculateNextRun(job.schedule);
      }
      
      job.updatedAt = new Date();
      await job.save();
      
      // If interval mode, schedule next execution even after failure
      if (job.intervalMode) {
        scheduleIntervalJob(jobId, job.intervalMinutes);
      }
    }
  }
};

/**
 * Schedule an interval-based job
 */
const scheduleIntervalJob = (jobId, intervalMinutes) => {
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
  const timeoutId = setTimeout(async () => {
    await executeJob(jobId);
  }, intervalMinutes * 60 * 1000);
  
  activeTasks.set(jobId, { clear: () => clearTimeout(timeoutId), type: 'interval' });
  console.log(`[cron] scheduled interval job ${jobId} for ${intervalMinutes} minutes`);
  
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
    
    // Check if there are any interval mode jobs
    const intervalJobs = activeJobs.filter(job => job.intervalMode);
    const hasIntervalJobs = intervalJobs.length > 0;
    
    for (const job of activeJobs) {
      try {
        if (job.intervalMode) {
          // For interval mode jobs
          if (!job.lastRun) {
            // First job - execute immediately
            console.log(`[cron] executing first interval job ${job._id} immediately`);
            setImmediate(() => executeJob(job._id.toString()));
          } else {
            // Schedule based on next run time
            const now = new Date();
            const nextRun = job.nextRun ? new Date(job.nextRun) : new Date(now.getTime() + job.intervalMinutes * 60 * 1000);
            const delay = Math.max(0, nextRun.getTime() - now.getTime());
            
            setTimeout(async () => {
              await executeJob(job._id.toString());
            }, delay);
            
            activeTasks.set(job._id.toString(), { 
              clear: () => {}, 
              type: 'interval' 
            });
            console.log(`[cron] scheduled interval job ${job._id} in ${Math.round(delay / 1000)}s`);
          }
          
          // Update nextRun if not set
          if (!job.nextRun) {
            job.nextRun = new Date(Date.now() + job.intervalMinutes * 60 * 1000);
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
  calculateNextRun
};
