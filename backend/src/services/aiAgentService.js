const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { env } = require("../config/env");
const { searchImagesForKeywords } = require("./photoApiService");
const { downloadFile, ensureDir } = require("../utils/file");

// === Gemini helper =========================================================
const geminiJSON = async (prompt, maxRetries = 3) => {
  const client = new GoogleGenerativeAI(env.geminiApiKey);
  const model = client.getGenerativeModel({ model: "gemini-2.5-pro" });
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const result = await model.generateContent(
        "Return JSON only. No markdown fences. No explanation.\n\n" + prompt
      );
      const raw = result.response.text();
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      return JSON.parse(s >= 0 && e >= 0 ? raw.slice(s, e + 1) : raw);
    } catch (err) {
      lastError = err;
      console.warn(`[agent] geminiJSON attempt ${attempt + 1}/${maxRetries} failed: ${err.message}`);
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }

  throw lastError;
};

// === Helpers ===============================================================

/** 1 image per ~15 words, clamped 3-6 */
const imagesForSection = (script) => {
  const words = script.trim().split(/\s+/).length;
  return Math.min(6, Math.max(3, Math.round(words / 15)));
};

const filterImageUrls = (images) =>
  (Array.isArray(images) ? images : [])
    .map((img) => img?.image || img)
    .filter((u) => {
      if (typeof u !== "string" || !u.startsWith("http")) return false;
      const lower = u.toLowerCase();
      // Skip SVG and WebP — these cause FFmpeg demuxer issues with -loop 1
      return !lower.endsWith(".svg") && !lower.endsWith(".webp") && !lower.includes(".svg?") && !lower.includes("format=webp");
    });

/**
 * Check the first 12 bytes of a downloaded file.
 * Returns true if the file is a WebP (RIFF...WEBP header).
 * These are saved with .jpg extension by some APIs and break FFmpeg -loop.
 */
const isWebpFile = async (filePath) => {
  try {
    const fd = await fsPromises.open(filePath, "r");
    const buf = Buffer.alloc(12);
    await fd.read(buf, 0, 12, 0);
    await fd.close();
    // WebP: bytes 0-3 = "RIFF", bytes 8-11 = "WEBP"
    return buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP";
  } catch (_) {
    return false;
  }
};
const splitScriptIntoGroups = (script, count) => {
  const sentences = script.match(/[^.!?\n]+[.!?\n]*/g) || [script];
  const groups = [];
  const perGroup = Math.max(1, Math.ceil(sentences.length / count));
  for (let i = 0; i < count; i += 1) {
    const chunk = sentences.slice(i * perGroup, (i + 1) * perGroup).join(" ").trim();
    groups.push(chunk || script.slice(0, 80));
  }
  return groups;
};

// === Step 1b: Tweak script to align with fetched images ==================
/**
 * After images are fetched, lightly rewrite each section's script so it flows
 * with the actual images shown. Also splits each section into per-image sub-scripts
 * so TTS can be generated independently per image with exact timing.
 *
 * Returns sections with two extra fields:
 *   script      — slightly rewritten full section text
 *   imageScripts — array of sub-scripts, one per image slot
 */
const tweakScript = async (sections, sectionImages, sectionKeywords) => {
  const imageCountMap = {};
  for (const si of sectionImages) {
    imageCountMap[si.sectionIndex] = si.imagePaths.length;
  }
  const kwMap = {};
  for (const sk of (sectionKeywords || [])) {
    kwMap[sk.sectionIndex] = sk.keywords || [];
  }

  // Only send sections that actually have images
  const compact = sections
    .map((s, i) => ({
      sectionIndex: i,
      heading: s.heading,
      originalScript: s.script,
      imageCount: imageCountMap[i] || 0,
      imageKeywords: (kwMap[i] || []).slice(0, imageCountMap[i] || 0)
    }))
    .filter((s) => s.imageCount > 0);

  const prompt = `You are a documentary video scriptwriter. I have a script with sections. For each section, specific stock images have been fetched (described by the keywords below).

Your tasks:
1. Very lightly rewrite each section's script so the narration feels natural alongside the images shown — keep all facts, just adjust phrasing so it flows visually.
2. Split the rewritten script into EXACTLY imageCount parts — each part is the narration spoken while that specific image is on screen.

Sections:
${JSON.stringify(compact, null, 2)}

Return JSON:
{
  "tweakedSections": [
    {
      "sectionIndex": 0,
      "script": "full rewritten section script here",
      "imageScripts": ["narration for image 0", "narration for image 1", "narration for image 2"]
    }
  ]
}

Rules:
- imageScripts.length MUST equal imageCount exactly
- Preserve all original facts and tone — only lightly adjust phrasing
- Each imageScript is 1-3 sentences that can stand alone naturally
- imageScripts joined together should cover the full section narrative
- Think of it as a natural documentary voice-over where each sentence pairs with a shot
- IMPORTANT: imageScripts must ALWAYS be written in ENGLISH regardless of the original script language — they are used as English captions on the video`;

  let parsed;
  try {
    parsed = await geminiJSON(prompt);
    console.log(`[agent] tweakScript: rewrote ${(parsed.tweakedSections || []).length} sections`);
  } catch (err) {
    console.warn("[agent] tweakScript failed, falling back to original scripts:", err.message);
    parsed = { tweakedSections: [] };
  }

  const tweakMap = {};
  for (const ts of (parsed.tweakedSections || [])) {
    tweakMap[ts.sectionIndex] = ts;
  }

  return sections.map((s, i) => {
    const count = imageCountMap[i] || 0;
    const tweak = tweakMap[i];
    if (
      tweak &&
      Array.isArray(tweak.imageScripts) &&
      tweak.imageScripts.length === count &&
      tweak.imageScripts.every((t) => typeof t === "string" && t.trim().length > 0)
    ) {
      return { ...s, script: tweak.script || s.script, imageScripts: tweak.imageScripts };
    }
    // Fallback: split original script sentence-by-sentence across image slots
    return { ...s, imageScripts: count > 0 ? splitScriptIntoGroups(s.script, count) : [] };
  });
};

// === Step 1: Plan storyboard keywords ======================================
/**
 * Returns [{sectionIndex, imageCount, keywords: ["kw1","kw2",...]}]
 * Keywords are sentence-aware: each maps to a specific visual slot in the narration.
 */
const planSections = async (sections) => {
  const compact = sections.map((s, i) => {
    const count = imagesForSection(s.script);
    const groups = splitScriptIntoGroups(s.script, count);
    return {
      idx: i,
      heading: s.heading,
      imageCount: count,
      scriptGroups: groups.map((g, gi) => ({ slot: gi, text: g.slice(0, 150) }))
    };
  });

  const prompt = `You are a professional video editor and visual researcher. For each script section I have broken the narration into visual "slots". Each slot corresponds to a specific piece of the narration.

Your task: generate ONE precise English image-search keyword per slot that would produce the PERFECT stock photo for that exact narration moment.

Sections and slots:
${JSON.stringify(compact, null, 2)}

Return JSON:
{
  "sectionKeywords": [
    { "sectionIndex": 0, "imageCount": 3, "keywords": ["keyword for slot 0", "keyword for slot 1", "keyword for slot 2"] },
    ...
  ]
}

Rules:
- keywords array length MUST equal imageCount exactly
- ALL keywords in English (image-search API is English-only)
- Each keyword is specific to that EXACT slot text, not the whole section
- 1-4 words max: concrete, visual, searchable (e.g. "doctor examining patient", "solar panel field", "busy stock market")
- Vary subjects across slots to avoid repetition - each image should look different
- Think like a documentary filmmaker: what specific shot would a human editor cut to here?
- Prefer journalistic / documentary style: real people, real places, real objects`;

  const parsed = await geminiJSON(prompt);
  return parsed.sectionKeywords || [];
};

// === Step 2: Fetch & download multiple images per section =================
/**
 * Returns [{sectionIndex, imagePaths: [path1, path2, ...]}]
 */
const fetchSectionImages = async (sectionKeywords, imagesDir) => {
  await ensureDir(imagesDir);

  const allKeywords = sectionKeywords.flatMap((sk) => sk.keywords || []);
  const uniqueKeywords = [...new Set(allKeywords)];

  console.log(`[agent] bulk-fetching ${uniqueKeywords.length} keywords across ${sectionKeywords.length} sections`);
  const searchResponse = await searchImagesForKeywords(uniqueKeywords, 6);

  const urlsByKeyword = {};
  for (const r of (searchResponse.results || [])) {
    if (r.success && r.result) {
      urlsByKeyword[r.keyword.toLowerCase()] = filterImageUrls(r.result.images);
    }
  }

  const result = [];

  for (const sk of sectionKeywords) {
    const imagePaths = [];

    for (let imgIdx = 0; imgIdx < (sk.keywords || []).length; imgIdx += 1) {
      const kw = sk.keywords[imgIdx];
      const candidates = urlsByKeyword[kw.toLowerCase()] || [];
      const savePath = path.join(imagesDir, `section-${sk.sectionIndex}-img-${imgIdx}.jpg`);

      let downloaded = false;
      for (let c = 0; c < Math.min(candidates.length, 7); c += 1) {
        try {
          await downloadFile(candidates[c], savePath);
          const stats = await fsPromises.stat(savePath);
          if (stats.size < 1000) {
            await fsPromises.unlink(savePath).catch(() => {});
            continue;
          }
          // Reject WebP files served with .jpg extension
          if (await isWebpFile(savePath)) {
            console.warn(`[agent] section ${sk.sectionIndex} img ${imgIdx}: skipping WebP disguised as jpg`);
            await fsPromises.unlink(savePath).catch(() => {});
            continue;
          }
          downloaded = true;
          console.log(`[agent] section ${sk.sectionIndex} img ${imgIdx}: ok "${kw}"`);
          break;
        } catch (_) { /* try next URL */ }
      }

      if (!downloaded) {
        console.warn(`[agent] section ${sk.sectionIndex} img ${imgIdx}: no image for "${kw}"`);
      } else {
        imagePaths.push(savePath);
      }

      await new Promise((r) => setTimeout(r, 120 + Math.random() * 200));
    }

    if (imagePaths.length > 0) {
      result.push({ sectionIndex: sk.sectionIndex, imagePaths });
    } else {
      console.warn(`[agent] section ${sk.sectionIndex}: ZERO images downloaded`);
    }
  }

  return result;
};

// === Step 3: Validate coverage ============================================
const validateImages = (sections, sectionImages) => {
  const coveredIndices = new Set(sectionImages.map((si) => si.sectionIndex));
  const missingSections = [];

  for (let i = 0; i < sections.length; i += 1) {
    if (!coveredIndices.has(i)) missingSections.push(i);
  }

  if (missingSections.length > 0) {
    console.log(`[agent] validation: ${missingSections.length} sections missing images - will retry`);
  } else {
    console.log(`[agent] validation: all ${sections.length} sections have images`);
  }

  return missingSections;
};

// === Step 4: Retry missing sections =======================================
const retryMissingSections = async (sections, missingSections, imagesDir) => {
  if (missingSections.length === 0) return [];

  const missingData = missingSections.map((idx) => ({
    idx,
    heading: sections[idx].heading,
    scriptPreview: sections[idx].script.slice(0, 130),
    imageCount: imagesForSection(sections[idx].script)
  }));

  const prompt = `These video sections have no images yet. Generate simple, common English keywords per section highly likely to return stock photos.

Sections needing images:
${JSON.stringify(missingData, null, 2)}

Return JSON:
{
  "retryKeywords": [
    { "sectionIndex": 0, "keywords": ["kw1", "kw2", "kw3"] },
    ...
  ]
}

Rules:
- Generate imageCount keywords per section (from missingData.imageCount)
- Very common, generic English visual terms (e.g. "city skyline", "laptop office", "people meeting")
- All in English, 1-3 words each`;

  let retryPlan;
  try {
    retryPlan = await geminiJSON(prompt);
  } catch (err) {
    console.warn("[agent] retry keyword generation failed:", err.message);
    return [];
  }

  const allRetryKws = (retryPlan.retryKeywords || []).flatMap((rk) => rk.keywords || []);
  if (allRetryKws.length === 0) return [];

  const searchResponse = await searchImagesForKeywords([...new Set(allRetryKws)], 5);
  const urlsByKeyword = {};
  for (const r of (searchResponse.results || [])) {
    if (r.success && r.result) {
      urlsByKeyword[r.keyword.toLowerCase()] = filterImageUrls(r.result.images);
    }
  }

  const recovered = [];
  for (const rk of (retryPlan.retryKeywords || [])) {
    const imagePaths = [];

    for (let imgIdx = 0; imgIdx < (rk.keywords || []).length; imgIdx += 1) {
      const kw = rk.keywords[imgIdx];
      const candidates = urlsByKeyword[kw.toLowerCase()] || [];
      const savePath = path.join(imagesDir, `section-${rk.sectionIndex}-img-${imgIdx}.jpg`);

      for (let c = 0; c < Math.min(candidates.length, 5); c += 1) {
        try {
          await downloadFile(candidates[c], savePath);
          const stats = await fsPromises.stat(savePath);
          if (stats.size < 1000) { await fsPromises.unlink(savePath).catch(() => {}); continue; }
          if (await isWebpFile(savePath)) { await fsPromises.unlink(savePath).catch(() => {}); continue; }
          imagePaths.push(savePath);
          console.log(`[agent] retry section ${rk.sectionIndex} img ${imgIdx} ok ("${kw}")`);
          break;
        } catch (_) { /* next */ }
      }

      await new Promise((r) => setTimeout(r, 120 + Math.random() * 200));
    }

    if (imagePaths.length > 0) recovered.push({ sectionIndex: rk.sectionIndex, imagePaths });
  }

  return recovered;
};

// === Step 5: Build sync plan ==============================================
/**
 * Returns flat [{imagePath, duration, kbStyle, sectionIndex, heading}]
 *
 * perImageAudios: [{sectionIndex, imageIndex, duration}] — actual TTS duration
 * per image slot. Each image's display duration = its own TTS duration (instant switch).
 * kbStyle cycles 0-5 globally so adjacent images never share the same motion.
 */
const buildSyncPlan = (sections, sectionImages, perImageAudios) => {
  const imageMap = {};
  for (const si of sectionImages) {
    imageMap[si.sectionIndex] = si.imagePaths || (si.imagePath ? [si.imagePath] : []);
  }

  // Build per-image duration lookup: durationMap[sectionIdx][imageIdx] = seconds
  const durationMap = {};
  for (const pa of (perImageAudios || [])) {
    if (!durationMap[pa.sectionIndex]) durationMap[pa.sectionIndex] = {};
    durationMap[pa.sectionIndex][pa.imageIndex] = pa.duration;
  }

  const plan = [];
  const MIN_IMAGE_DURATION = 2.0;
  const MAX_IMAGE_DURATION = 10.0;
  const MAX_VIDEO_DURATION = 300;   // 5 minutes hard cap
  let globalKbCounter = 0;

  for (let i = 0; i < sections.length; i += 1) {
    const paths = imageMap[i];
    if (!paths || paths.length === 0) continue;

    const imgDurs = durationMap[i] || {};

    for (let imgIdx = 0; imgIdx < paths.length; imgIdx += 1) {
      // Use exact TTS duration for this image slot; clamp to reasonable bounds
      let duration = imgDurs[imgIdx] || 3.5;
      duration = Math.min(Math.max(duration, MIN_IMAGE_DURATION), MAX_IMAGE_DURATION);

      plan.push({
        sectionIndex: i,
        imagePath: paths[imgIdx],
        duration,
        kbStyle: globalKbCounter % 6,
        heading: sections[i].heading,
        captionText: ((sections[i].imageScripts || [])[imgIdx] || sections[i].heading || "").trim()
      });
      globalKbCounter += 1;
    }
  }

  // Enforce total video duration cap
  const rawTotal = plan.reduce((s, p) => s + p.duration, 0);
  if (rawTotal > MAX_VIDEO_DURATION) {
    const ratio = MAX_VIDEO_DURATION / rawTotal;
    for (const p of plan) {
      p.duration = Math.max(MIN_IMAGE_DURATION, p.duration * ratio);
    }
    console.log(`[agent] sync plan trimmed from ${rawTotal.toFixed(1)}s to ~${plan.reduce((s, p) => s + p.duration, 0).toFixed(1)}s to stay under ${MAX_VIDEO_DURATION}s`);
  }

  console.log("[agent] sync plan:");
  let secIdx = -1;
  for (const p of plan) {
    if (p.sectionIndex !== secIdx) {
      secIdx = p.sectionIndex;
      const sectionItems = plan.filter((x) => x.sectionIndex === secIdx);
      const styles = sectionItems.map((x) => x.kbStyle).join(",");
      const durs = sectionItems.map((x) => x.duration.toFixed(1)).join(",");
      console.log(`  section ${secIdx} imgs=${sectionItems.length} dur=[${durs}]s KB=[${styles}] "${p.heading}"`);
    }
  }
  const totalSecs = plan.reduce((s, p) => s + p.duration, 0).toFixed(1);
  console.log(`  TOTAL: ${plan.length} images ~${totalSecs}s`);

  return plan;
};

// === Main orchestrator ====================================================
const orchestrate = async (sections, imagesDir) => {
  console.log("[agent] ======= AI Agent starting orchestration =======");

  console.log("[agent] Step 1: Planning sentence-aware storyboard keywords...");
  const sectionKeywords = await planSections(sections);
  const totalPlanned = sectionKeywords.reduce((s, sk) => s + (sk.keywords?.length || 0), 0);
  console.log(`[agent] planned ${totalPlanned} images across ${sectionKeywords.length} sections`);

  console.log("[agent] Step 2: Fetching & downloading images...");
  const sectionImages = await fetchSectionImages(sectionKeywords, imagesDir);
  const totalDownloaded = sectionImages.reduce((s, si) => s + si.imagePaths.length, 0);
  console.log(`[agent] downloaded ${totalDownloaded} images across ${sectionImages.length}/${sections.length} sections`);

  console.log("[agent] Step 3: Validating coverage...");
  const missingSections = validateImages(sections, sectionImages);

  let allImages = [...sectionImages];
  if (missingSections.length > 0) {
    console.log("[agent] Step 4: Retrying missing sections...");
    const recovered = await retryMissingSections(sections, missingSections, imagesDir);
    allImages = [...allImages, ...recovered];
    const recoveredTotal = recovered.reduce((s, r) => s + r.imagePaths.length, 0);
    console.log(`[agent] recovered ${recoveredTotal} images for ${recovered.length} sections`);
  } else {
    console.log("[agent] Step 4: Skipped (all covered)");
  }

  allImages.sort((a, b) => a.sectionIndex - b.sectionIndex);

  const grandTotal = allImages.reduce((s, si) => s + si.imagePaths.length, 0);
  console.log(`[agent] ======= Orchestration done: ${grandTotal} images for ${allImages.length}/${sections.length} sections =======`);

  // Return both images AND keywords so the controller can run tweakScript
  return { sectionImages: allImages, sectionKeywords };
};

module.exports = {
  orchestrate,
  tweakScript,
  buildSyncPlan
};