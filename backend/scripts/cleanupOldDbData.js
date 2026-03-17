const mongoose = require("mongoose");
const { connectDb } = require("../src/config/db");
const Video = require("../src/models/Video");
const CronJob = require("../src/models/CronJob");

(async () => {
  try {
    await connectDb();

    const videoResult = await Video.deleteMany({});
    const cronResult = await CronJob.deleteMany({
      $or: [
        { status: "completed" },
        { status: "failed" },
        { isActive: false }
      ]
    });

    console.log(`[cleanup] deleted videos: ${videoResult.deletedCount}`);
    console.log(`[cleanup] deleted old cron records: ${cronResult.deletedCount}`);
  } catch (err) {
    console.error("[cleanup] failed:", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
})();
