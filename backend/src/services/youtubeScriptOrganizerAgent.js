/**
 * youtubeScriptOrganizerAgent.js
 *
 * A dedicated AI agent that:
 *  1. Reads a raw YouTube transcript from a teacher's lecture
 *  2. Deeply reasons about the content structure, pacing, and visual opportunities
 *  3. Organizes it into structured sections ready for the Remotion rendering pipeline
 *
 * This is the brain of the YouTube-to-Video pipeline: it bridges the raw lecture
 * and the animated scene generator (detailedAgentService.generateScenesCode).
 *
 * Uses Gemini 2.5 Pro with extended thinking (thinkingBudget: 15000) so it can
 * reason carefully about how the narration should sync with animations.
 */

"use strict";

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { env } = require("../config/env");

const MAX_SECTIONS = 12;
const MIN_SECTIONS = 4;
const MAX_SECTION_WORDS = 150; // ~45–60s of speech per section

/**
 * Call Gemini 2.5 Pro with extended thinking.
 * Used for the heavy reasoning pass over the transcript.
 */
async function callGeminiProWithThinking(prompt) {
  const genAI = new GoogleGenerativeAI(env.geminiApiKey);
  const model = genAI.getGenerativeModel(
    { model: "gemini-2.5-pro" },
    { apiVersion: "v1beta" }
  );

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      thinkingConfig: { thinkingBudget: 15000 },
    },
  });

  return result.response.text();
}

/**
 * Extract the JSON block from a Gemini response that may or may not
 * have markdown code fences around it.
 */
function extractJson(raw) {
  // Strip ```json ... ``` fences if present
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }

  // Try raw JSON (starts with { or [)
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(raw.slice(start, end + 1));
  }

  throw new Error("No valid JSON found in Gemini response");
}

/**
 * Sanitize section scripts for TTS:
 * - Remove parenthetical asides
 * - Remove stage directions
 * - Normalize whitespace
 */
function sanitizeSectionScript(text) {
  return text
    .replace(/\[.*?\]/g, "") // [Applause], [Music], etc.
    .replace(/\(.*?\)/g, "") // (pauses), (laughs), etc.
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Trim a script to MAX_SECTION_WORDS words while keeping sentence boundaries.
 */
function trimToWordLimit(text, maxWords = MAX_SECTION_WORDS) {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;

  // Find the last sentence boundary before the word limit
  const candidate = words.slice(0, maxWords).join(" ");
  const lastPeriod = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("? "),
    candidate.lastIndexOf("! ")
  );

  if (lastPeriod > candidate.length * 0.6) {
    return candidate.slice(0, lastPeriod + 1).trim();
  }

  return candidate.trim() + "...";
}

/**
 * Main agent entry point.
 *
 * @param {string} transcript   - Raw full transcript from the YouTube audio
 * @param {string} videoTitle   - Title of the YouTube video (for context)
 * @param {string} [language]   - Language code for context (e.g. "en-IN")
 * @returns {Promise<Array<{ heading: string, script: string, keywords: string[], visualHint: string }>>}
 */
async function organizeYouTubeScript(transcript, videoTitle = "", language = "en-IN") {
  console.log(`[ytOrganizer] organizing transcript (${transcript.length} chars) for "${videoTitle}"...`);

  // Truncate very long transcripts to keep within Gemini's context
  const MAX_TRANSCRIPT_CHARS = 40000; // ~10,000–15,000 tokens worth of text
  const safeTranscript = transcript.length > MAX_TRANSCRIPT_CHARS
    ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) + "\n\n[...transcript truncated for processing...]"
    : transcript;

  const organizerPrompt = `You are both an expert educator and a motion-graphics director creating an animated educational video.

A teacher has given a lecture that was recorded and transcribed from YouTube. Your job is to:
1. Deeply understand what the teacher is explaining
2. Segment the lecture into ${MIN_SECTIONS}–${MAX_SECTIONS} focused sections for an animated video
3. For each section, craft a clean narration script AND describe what visuals should accompany it

═══════════════════════════════════════════════════
VIDEO TITLE: "${videoTitle || 'Educational Video'}"
LANGUAGE CONTEXT: ${language}
═══════════════════════════════════════════════════

FULL TRANSCRIPT:
---
${safeTranscript}
---

════════════════════════════════════════════════════════════════
STEP 1 — DEEP REASONING (think through this carefully):
════════════════════════════════════════════════════════════════

Before producing output, reason through:
A) What is the CORE TOPIC? What concept is the teacher teaching?
B) What are the KEY CONCEPTS or sub-topics covered? List them.
C) What is the natural PEDAGOGICAL FLOW (introduction → explanation → examples → conclusion)?
D) Where are the NATURAL BREAKING POINTS in the lecture?
E) What VISUAL METAPHORS or diagrams would make each concept clearer?
F) How should ANIMATION sync with narration? 
   - Data/statistics → animated charts that appear as numbers are mentioned
   - Processes → flowchart boxes that appear step by step as teacher names each step
   - Comparisons → side-by-side panels
   - Concepts/metaphors → illustrative scenes that appear as the metaphor is spoken

════════════════════════════════════════════════════════════════
STEP 2 — PRODUCE STRUCTURED OUTPUT
════════════════════════════════════════════════════════════════

Create ${MIN_SECTIONS}–${MAX_SECTIONS} sections. Each section:
- "heading": 2–5 word section title (punchy, clear)
- "script": The narration text for this section (${MAX_SECTION_WORDS} words MAX).
             Write it as CLEAN, NATURAL SPEECH — exactly what will be read aloud by TTS.
             Remove filler words ("um", "uh", "you know"), repetitions, and incomplete sentences.
             Keep the teacher's natural explanatory style but clean it up.
- "keywords": 3–6 keywords for this section's topic (for visual search)
- "visualHint": ONE sentence describing what the animation should show and HOW it syncs.
                Be SPECIFIC: "Bar chart with 4 bars appearing one-by-one as each statistic is named"
                NOT vague: "show some chart"

════════════════════════════════════════════════════════════════
CRITICAL RULES:
════════════════════════════════════════════════════════════════
1. The first section should be a clear INTRODUCTION to the topic (30–45 words)
2. The last section should be a clear CONCLUSION or summary (30–50 words)
3. Each script MUST be complete sentences — no fragments, no cutoffs mid-explanation
4. Do NOT add explanations outside the JSON
5. Preserve the teacher's KEY EXAMPLES — they're what make educational content memorable
6. The scripts will be read by TTS — no parentheses, no brackets, no markdown
7. Total script across all sections should be roughly proportional to the original transcript length

════════════════════════════════════════════════════════════════
OUTPUT — JSON ONLY:
════════════════════════════════════════════════════════════════
{
  "title": "Clean, descriptive title for the video (5–10 words)",
  "topic": "Core topic in 3–5 words",
  "sections": [
    {
      "heading": "Section Heading",
      "script": "Natural, clean narration text for this section...",
      "keywords": ["keyword1", "keyword2", "keyword3"],
      "visualHint": "Specific animation sync description"
    }
  ]
}

Return ONLY the JSON object. No markdown. No explanation.`;

  let parsed;
  try {
    console.log("[ytOrganizer] calling Gemini 2.5 Pro with extended thinking...");
    const raw = await callGeminiProWithThinking(organizerPrompt);
    parsed = extractJson(raw);
    console.log(`[ytOrganizer] received ${parsed.sections?.length || 0} sections from AI`);
  } catch (err) {
    console.error(`[ytOrganizer] Gemini call failed: ${err.message}`);
    throw new Error(`Script organization failed: ${err.message}`);
  }

  // Validate structure
  if (!parsed.sections || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    throw new Error("[ytOrganizer] AI returned empty or invalid sections array");
  }

  // Sanitize and trim each section
  const sections = parsed.sections
    .filter((s) => s.heading && s.script && s.script.trim().length > 20)
    .map((s) => ({
      heading: String(s.heading || "").slice(0, 60).trim(),
      script: trimToWordLimit(sanitizeSectionScript(String(s.script || ""))),
      keywords: Array.isArray(s.keywords)
        ? s.keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean).slice(0, 6)
        : [],
      visualHint: String(s.visualHint || "").slice(0, 200),
    }));

  if (sections.length < MIN_SECTIONS) {
    throw new Error(`[ytOrganizer] too few valid sections (${sections.length} < ${MIN_SECTIONS})`);
  }

  const finalTitle = parsed.title || videoTitle || "Educational Video";
  const finalTopic = parsed.topic || videoTitle || "Educational Topic";

  console.log(`[ytOrganizer] organized into ${sections.length} sections. Title: "${finalTitle}"`);
  sections.forEach((s, i) =>
    console.log(`  [${i + 1}] ${s.heading} — ${s.script.split(" ").length} words`)
  );

  return { title: finalTitle, topic: finalTopic, sections };
}

module.exports = { organizeYouTubeScript };
