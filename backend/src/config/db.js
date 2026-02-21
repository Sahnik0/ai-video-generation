const mongoose = require("mongoose");
const { env } = require("./env");

const connectDb = async () => {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongoUri);
};

module.exports = { connectDb };
