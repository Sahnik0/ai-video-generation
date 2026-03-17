const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { env } = require("../config/env");

const getS3Client = () => {
  if (!env.aws.accessKeyId || !env.aws.secretAccessKey || !env.aws.region || !env.aws.bucketName) {
    throw new Error("AWS S3 credentials are not fully configured.");
  }

  return new S3Client({
    region: env.aws.region,
    credentials: {
      accessKeyId: env.aws.accessKeyId,
      secretAccessKey: env.aws.secretAccessKey,
    },
  });
};

const uploadToS3 = async (videoPath, metadata = {}) => {
  const client = getS3Client();
  const now = Date.now();
  const basename = path.basename(videoPath).replace(/\s+/g, "-");
  const topic = (metadata.topic || "video").toString().toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 40);
  const key = `videos/${topic}-${now}-${basename}`;

  const body = fs.createReadStream(videoPath);
  const contentType = "video/mp4";

  await client.send(
    new PutObjectCommand({
      Bucket: env.aws.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: {
        title: (metadata.title || "").toString().slice(0, 100),
        topic: (metadata.topic || "").toString().slice(0, 100),
        language: (metadata.language || "").toString().slice(0, 20),
      },
    })
  );

  const videoUrl = `https://${env.aws.bucketName}.s3.${env.aws.region}.amazonaws.com/${key}`;

  return {
    key,
    videoUrl,
    bucket: env.aws.bucketName,
    region: env.aws.region,
  };
};

module.exports = { uploadToS3 };
