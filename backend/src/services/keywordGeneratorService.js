const { GoogleGenerativeAI } = require("@google/generative-ai");
const { env } = require("../config/env");

const generateKeywordsForScript = async (sections) => {
  const scriptText = sections.map((s) => `${s.heading}: ${s.script}`).join("\n\n");

  const client = new GoogleGenerativeAI(env.geminiApiKey);
  const model = client.getGenerativeModel({ model: "gemini-2.5-pro" });

  const prompt = `Analyze the following video script and extract 10-15 of the most visually descriptive and relevant keywords that would be perfect for fetching images that match the content.

Script:
${scriptText}

Return ONLY a JSON object with this exact structure (no markdown, no extra text):
{
  "keywords": ["keyword1", "keyword2", "keyword3", ...]
}

Requirements:
- ALL keywords MUST be in ENGLISH only, regardless of what language the script is written in
- Translate concepts from the script into English visual search terms
- Keywords should be concrete, visual, and searchable on image databases
- Avoid abstract or overly generic terms
- Prioritize main topics and concepts mentioned
- Each keyword should be 1-3 words
- Total of 10-15 keywords`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  const jsonString = jsonStart >= 0 && jsonEnd >= 0 ? text.slice(jsonStart, jsonEnd + 1) : text;
  const parsed = JSON.parse(jsonString);

  return Array.isArray(parsed.keywords) ? parsed.keywords : [];
};

module.exports = { generateKeywordsForScript };
