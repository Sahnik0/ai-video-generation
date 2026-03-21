const { GoogleGenerativeAI } = require("@google/generative-ai");
const { env } = require("../config/env");

const SYSTEM_PROMPT = [
  "Return JSON only. No markdown. Follow the schema exactly.",
  "Use all provided curriculum metadata to keep the script narrowly focused on the requested curriculum > grade > subject > chapter > topic > subtopic > concept.",
  "Do not broaden scope beyond the provided academic context."
].join(" ");

// Map BCP-47 codes to readable language names for the Gemini prompt
const LANGUAGE_NAMES = {
  "en-IN": "English",
  "hi-IN": "Hindi",
  "bn-IN": "Bengali",
  "te-IN": "Telugu",
  "ta-IN": "Tamil",
  "mr-IN": "Marathi",
  "gu-IN": "Gujarati",
  "kn-IN": "Kannada",
  "ml-IN": "Malayalam",
  "od-IN": "Odia",
  "pa-IN": "Punjabi",
};

const buildCurriculumBlock = (curriculumData = {}) => {
  if (!curriculumData || typeof curriculumData !== "object") return "";

  const pairs = [
    ["curriculum", curriculumData.curriculumName],
    ["grade", curriculumData.gradeName],
    ["subject", curriculumData.subjectName],
    ["chapter", curriculumData.chapterName],
    ["topic", curriculumData.topicName],
    ["subtopic", curriculumData.subtopicName],
    ["concept", curriculumData.conceptName],
  ].filter(([, value]) => value);

  if (!pairs.length) return "";

  const lines = pairs.map(([key, value]) => `- ${key}: ${value}`);
  return ["Curriculum context (must be reflected in output):", ...lines, ""].join("\n");
};

const buildPrompt = (topic, language = "en-IN", options = {}) => {
  const langName = LANGUAGE_NAMES[language] || "English";
  const langInstruction = langName !== "English"
    ? `\n- Write ALL text (title, headings, scripts) in ${langName} language only. Do NOT use English for any content fields.`
    : "";
  const curriculumBlock = buildCurriculumBlock(options.curriculumData);
  const modeLine = options.mode ? `Generation mode: ${options.mode}` : "";
  return [
    "You are generating a structured script for a short slideshow video.",
    "",
    `Topic: ${topic}`,
    modeLine,
    curriculumBlock,
    "",
    "Rules:",
    "- Return JSON only.",
    "- Keep each section tightly tied to the requested curriculum context (if provided).",
    "- Do not switch to adjacent chapters/subjects unless explicitly present in the given context.",
    "- Total script under 300 words (aim for a 2-3 minute video).",
    "- 5 to 8 sections.",
    "- Keywords must be visually descriptive in English (for image search), avoid abstract terms." + langInstruction,
    "",
    "Output JSON schema:",
    "{",
    '  "title": "",',
    '  "sections": [',
    "    {",
    '      "heading": "",',
    '      "script": "",',
    '      "keywords": ["visual keyword 1", "visual keyword 2"]',
    "    }",
    "  ]",
    "}"
  ].join("\n");
};

const generateScript = async (topic, language = "en-IN", options = {}) => {
  const client = new GoogleGenerativeAI(env.geminiApiKey);
  const model = client.getGenerativeModel({ model: "gemini-2.5-pro" });
  const result = await model.generateContent(`${SYSTEM_PROMPT}\n\n${buildPrompt(topic, language, options)}`);
  const text = result.response.text();
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  const jsonString = jsonStart >= 0 && jsonEnd >= 0 ? text.slice(jsonStart, jsonEnd + 1) : text;
  return JSON.parse(jsonString);
};

module.exports = { generateScript, buildPrompt };
