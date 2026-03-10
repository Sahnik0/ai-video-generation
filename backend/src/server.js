const { app } = require("./app");
const { connectDb } = require("./config/db");
const { env } = require("./config/env");
const { initializeCronJobs } = require("./services/cronService");

const start = async () => {
  await connectDb();
  
  // Initialize cron jobs after DB connection
  await initializeCronJobs();
  
  app.listen(env.port, () => {
    console.log(`Backend running on port ${env.port}`);
    console.log(`YouTube OAuth URL: http://localhost:${env.port}/api/youtube/auth`);
  });
};

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
