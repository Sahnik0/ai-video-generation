const { GoogleGenerativeAI } = require("@google/generative-ai");
const { env } = require("../config/env");

const SYSTEM_PROMPT = "Return JSON only. No markdown. Follow the schema exactly.";

const buildPrompt = (topic) => `You are generating a structured script for a short slideshow video.\n\nTopic: ${topic}\n\nRules:\n- Return JSON only.\n- Total script under 400 words.\n- 5 to 8 sections.\n- Keywords must be visually descriptive, avoid abstract terms.\n\nOutput JSON schema:\n{\n  \"title\": \"\",\n  \"sections\": [\n    {\n      \"heading\": \"\",\n      \"script\": \"\",\n      \"keywords\": [\"visual keyword 1\", \"visual keyword 2\"]\n    }\n  ]\n}`;

const generateScript = async (topic) => {
  const client = new GoogleGenerativeAI(env.geminiApiKey);
  const model = client.getGenerativeModel({ model: "gemini-2.5-pro" });
  const result = await model.generateContent(`${SYSTEM_PROMPT}\n\n${buildPrompt(topic)}`);
  const text = result.response.text();
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  const jsonString = jsonStart >= 0 && jsonEnd >= 0 ? text.slice(jsonStart, jsonEnd + 1) : text;
  return JSON.parse(jsonString);
};

module.exports = { generateScript, buildPrompt };
