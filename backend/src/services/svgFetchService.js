/**
 * svgFetchService.js
 *
 * Pure SVG fetcher — no opinions, no preferred sets.
 * The AI scene director decides what icons it needs, this service
 * just fetches them from the Iconify API and returns the raw SVG data.
 *
 * Iconify API:
 *   Search:   GET https://api.iconify.design/search?query={term}&limit=N
 *   SVG body: GET https://api.iconify.design/{prefix}.json?icons={name}
 */

"use strict";

const ICONIFY_BASE = "https://api.iconify.design";

/**
 * Search Iconify for the best icon matching a search term.
 * If a multi-word query returns 0 results, tries each word individually.
 * Returns the top result as "prefix:name" or null.
 */
async function searchIcon(term) {
  try {
    const url = `${ICONIFY_BASE}/search?query=${encodeURIComponent(term)}&limit=5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.icons && data.icons.length > 0) return data.icons[0];

    // Multi-word query returned nothing — try individual words
    const words = term.trim().split(/\s+/).filter((w) => w.length > 2);
    if (words.length > 1) {
      for (const word of words) {
        const wordUrl = `${ICONIFY_BASE}/search?query=${encodeURIComponent(word)}&limit=3`;
        const wordRes = await fetch(wordUrl, { signal: AbortSignal.timeout(4000) });
        if (!wordRes.ok) continue;
        const wordData = await wordRes.json();
        if (wordData.icons && wordData.icons.length > 0) {
          console.log(`[svgFetch] "${term}" → 0 results, but "${word}" → ${wordData.icons.length}`);
          return wordData.icons[0];
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch the raw SVG body (inner markup) for a specific icon.
 * Returns { body, width, height } or null.
 *
 * @param {string} iconId - "prefix:name" format (e.g. "mdi:rocket")
 */
async function fetchIconBody(iconId) {
  try {
    const [prefix, name] = iconId.split(":");
    if (!prefix || !name) return null;

    const url = `${ICONIFY_BASE}/${prefix}.json?icons=${name}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const data = await res.json();
    const icon = data.icons?.[name];
    if (!icon?.body) return null;

    return {
      body: icon.body,
      width: icon.width || data.width || 24,
      height: icon.height || data.height || 24,
      id: iconId,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch SVG icons for a list of AI-requested search terms.
 * Accepts both old format (string[]) and new format ({ term, usage }[]).
 * Returns array of { term, usage, body, width, height, id }.
 *
 * @param {Array<string|{term: string, usage: string}>} requests - from AI analysis
 * @returns {Promise<Array<{term:string, usage:string, body:string, width:number, height:number, id:string}>>}
 */
async function fetchSvgIcons(requests = []) {
  if (!requests || requests.length === 0) return [];

  const tasks = requests.slice(0, 5).map(async (req) => {
    const term = typeof req === "string" ? req : req.term;
    const usage = typeof req === "string" ? "" : req.usage || "";
    if (!term) return null;

    const iconId = await searchIcon(term);
    if (!iconId) return null;

    const icon = await fetchIconBody(iconId);
    if (!icon) return null;

    return { term, usage, ...icon };
  });

  const settled = await Promise.allSettled(tasks);
  const results = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) {
      results.push(r.value);
    }
  }

  console.log(
    `[svgFetch] ${results.length}/${requests.length} icons: ${results.map((r) => r.id).join(", ") || "(none)"}`
  );
  return results;
}

/**
 * Format fetched icons into a prompt section so the AI code generator
 * knows exactly what SVG markup is available and how to use each one.
 */
function formatIconsForPrompt(icons) {
  if (!icons || icons.length === 0) return "";

  let section = `
══════════════════════════════════════════════════════════════
🖼️  SVG ICONS READY TO USE — THE AI DIRECTOR REQUESTED THESE
══════════════════════════════════════════════════════════════
These icons were fetched specifically for this scene. Embed them in your
SVG visual zone using a <g> wrapper to position and scale:

  <g transform="translate(X, Y) scale(S)">
    <!-- paste body markup here, replace ACCENT_COLOR with actual hex -->
  </g>

Original icon size is typically 24x24. scale(15) → ~360px, scale(20) → ~480px.
`;

  for (const icon of icons) {
    const cleanBody = icon.body.replace(/currentColor/g, "ACCENT_COLOR");
    section += `\n--- ICON: "${icon.term}" (${icon.id}, ${icon.width}x${icon.height})`;
    if (icon.usage) section += `\n    USE FOR: ${icon.usage}`;
    section += `\n    BODY:\n${cleanBody}\n`;
  }

  section += `\n══════════════════════════════════════════════════════════════\n`;
  return section;
}

module.exports = { fetchSvgIcons, formatIconsForPrompt, searchIcon, fetchIconBody };
