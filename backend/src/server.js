const { app } = require("./app");
const { connectDb } = require("./config/db");
const { env } = require("./config/env");

const start = async () => {
  await connectDb();
  app.listen(env.port, () => {
    console.log(`Backend running on port ${env.port}`);
  });
};

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
