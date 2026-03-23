
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { env } = require("../config/env");
const { fetchSvgIcons, formatIconsForPrompt } = require("./svgFetchService");

const FPS = 30;
const MIN_BUFFER_FRAMES = 15; // 0.5s visual buffer after audio ends

// ─── Scene Analysis AI Agent ──────────────────────────────────────────────────

/**
 * Calls Gemini Flash to deeply analyze a narration section and return a rich
 * scene prescription: visual type, SVG scaffold, text alignment approach,
 * color palette, and animation style. This replaces the old keyword-regex classifier.
 *
 * Returns a plain object (never throws — falls back to safe defaults).
 *
 * @param {string} text          - section narration text
 * @param {number} sectionIndex  - 0-based index
 * @param {number} totalSections - total number of sections
 * @param {string} videoTopic    - overall video topic for extra context
 */
async function analyzeSceneWithAI(text, sectionIndex, totalSections, videoTopic = '') {
  // We use Gemini Flash for this — it's fast, cheap, and smart enough for JSON metadata.
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const { env } = require("../config/env");
  const genAI = new GoogleGenerativeAI(env.geminiApiKey);
  const model = genAI.getGenerativeModel(
    { model: "gemini-2.5-flash" },
    { apiVersion: "v1beta" }
  );

  const analysisPrompt = `You are an expert motion-graphics director AND a visual storyteller.
Your job: read the narration, understand what is LITERALLY being described or acted out,
and prescribe SVG animations that make those ideas VISIBLE on screen.

CONTEXT:
- Video topic: "${videoTopic || 'educational video'}"
- Section ${sectionIndex + 1} of ${totalSections}
- Canvas: 1920x1080 px, dark background, modern explainer-video style

NARRATION:
"${text.slice(0, 600)}"

--------------------------------------------------------------
STEP 1 - LITERAL VISUAL EXTRACTION (think silently, apply below)
--------------------------------------------------------------
Before picking a type, ask yourself:
  a) What OBJECTS, ENTITIES, or ACTORS are mentioned or implied?
     (e.g. "feet", "ground", "water", "neurons", "rocket", "coin")
  b) What ACTION or RELATIONSHIP is described?
     (e.g. "attached to", "flows through", "grows", "splits", "orbits")
  c) What METAPHOR or CONCEPT is at play?
     (e.g. "staying grounded" => feet on earth; "spark of creativity" => lightbulb + sparks)
  d) If you drew ONE illustration for this sentence, what would it show?

Then write your svgScaffold to LITERALLY depict that illustration.
Generic rings/orbiting-dots are only acceptable when the narration is 100% abstract.

EXAMPLES of good literal extraction:

  Narration: "keeps your feet attached to the ground"
  => svgScaffold: "Ground line (SVG line) at y=420 from x=300 to x=1460. Two ellipses (rx=80 ry=40) as
     foot-shapes, centered at x=700,y=400 and x=1060,y=400. Curved gravity-pull lines from each foot
     down to ground. Feet animate dropping from y=200 to y=380 with spring bounce. Label 'GROUNDED' in
     SVG text at x=880 y=260. Center circle glow behind the scene, r=160."

  Narration: "neural signals fire across synapses at lightning speed"
  => svgScaffold: "Three neuron-body circles r=40 at x=200,y=274; x=880,y=274; x=1560,y=274. Connecting
     horizontal path line (stroke-dashoffset animation, total-length=680). A glowing particle circle
     r=12 fill=#f59e0b moves along the path via interpolated cx. Labels: 'Neuron A', 'Synapse',
     'Neuron B' in SVG text below each. Dendritic lines branch from each neuron body."

  Narration: "over 80% of users prefer the mobile version"
  => svgScaffold: "Vertical bar chart. Bar 'Mobile' at x=700 grows to h=330 fill=#6366f1. Bar 'Desktop'
     at x=1060 grows to h=82 fill=#a1a1aa. Baseline y=460. Y-axis x=580 from y=100 to y=460.
     X-axis from x=580 to x=1280. Labels '80%' and '20%' appear above bars. Spring animation."

--------------------------------------------------------------
STEP 2 - PICK VISUAL TYPE (based on literal extraction)
--------------------------------------------------------------
A - MOLECULAR / ATOMIC  : atoms, molecules, cells, DNA, bonds, chemistry, biology
B - DATA CHART          : numbers, percentages, statistics, rankings, growth rates, survey data
C - PROCESS FLOWCHART   : steps, how-it-works, pipelines, procedures, algorithms, stages
D - TIMELINE            : historical dates, milestones, evolution over time, eras, periods
E - CONCEPT / SCENE     : metaphors, abstract ideas, specific scenes described literally
                          (feet on ground, water flowing, a door opening, a lightbulb etc.)
F - COMPARISON          : A vs B, pros/cons, before/after, two opposing things side by side
G - PHYSICS / VECTOR    : forces, waves, electricity, gravity, optics, orbital/quantum physics

NOTE: Type E covers ANY narration that describes a concrete scene, metaphor, or moment.
It should show the ACTUAL scene implied by the words - not just decorative rings.

--------------------------------------------------------------
STEP 3 - ALIGNMENT, STYLE, COLORS
--------------------------------------------------------------
textAlignment:
  center - single sentence, headline, definition, short punchy statement
  left   - list of items, multiple steps, bullet-point-style multi-line content
  table  - exactly two things compared side by side (only with type F or B)

animationStyle:
  energetic    - fast snappy springs, quick 8-12f stagger. Tech, action, statistics.
  elegant      - smooth slow fades, 20-30f stagger. Philosophy, nature, history.
  technical    - precise linear reveals, path drawing. Science, engineering, data.
  storytelling - cinematic slow motion. Biography, narrative, introduction.

accentColors: pick 2 from ["#6366f1","#06b6d4","#10b981","#f59e0b","#ef4444","#a855f7","#ec4899"]
that fit the MOOD of this specific narration.

--------------------------------------------------------------
OUTPUT - JSON ONLY (no markdown fences, no explanation text):
--------------------------------------------------------------
{
  "type": "E",
  "name": "CONCEPT / SCENE",
  "textAlignment": "center",
  "animationStyle": "elegant",
  "accentColors": ["#6366f1", "#06b6d4"],
  "svgScaffold": "[LITERAL description of SVG that depicts what the narration says - include actual x/y coords, shapes that match the content, animation actions]",
  "iconRequests": [
    { "term": "search query for icon", "usage": "what this icon represents in the scene" }
  ],
  "textContent": "[2 short display phrases max 12 words each from the narration, separated by ' | ']",
  "titleText": "[3-6 word punchy scene title]"
}

CRITICAL RULES:
- svgScaffold MUST describe the narration's content LITERALLY - never just decorative rings unless content is 100% abstract
- svgScaffold MUST include actual x/y coordinates, specific shapes, and animation descriptions
- If narration mentions ANY object, person, action, or place, that thing MUST appear in the SVG
- Placeholder text like "[specific values from narration]" is FORBIDDEN - write the actual content
- iconRequests: 2-4 icon search queries. Use SINGLE WORDS only — the Iconify API works
  best with one-word queries. Multi-word queries often return zero results.
  Each has "term" (ONE WORD like "rocket", "brain", "chart") and "usage" (where/how it will be used).
  GOOD terms: "rocket", "brain", "atom", "flask", "globe", "lightning", "server", "dna"
  BAD terms: "rocket launch", "human brain", "bar chart", "solar panel energy"
  Examples: [{"term":"rocket","usage":"main focal element for space exploration"},{"term":"lightning","usage":"accent icon for power/electricity"}]
- textContent: 2 actual phrases from the real narration text, joined with ' | '
- titleText: real 3-6 word title, not the placeholder above
- All 8 fields are required`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: analysisPrompt }] }],
      generationConfig: { thinkingConfig: { thinkingBudget: 4000 } },
    });
    const raw = result.response.text();
    // Extract JSON from response
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s >= 0 && e > s) {
      const parsed = JSON.parse(raw.slice(s, e + 1));
      // Validate required fields exist
      if (parsed.type && parsed.svgScaffold && parsed.textContent) {
        console.log(`[detailedAgent] scene ${sectionIndex + 1}: AI analysis → type=${parsed.type} align=${parsed.textAlignment} style=${parsed.animationStyle}`);
        return parsed;
      }
    }
  } catch (err) {
    console.warn(`[detailedAgent] scene ${sectionIndex + 1}: AI analysis failed (${err.message}), using fallback classification`);
  }

  // ── Fallback: fast keyword-based classification if AI call fails ──────────
  return fallbackClassify(text);
}

/**
 * Keyword-based fallback classification used only when AI analysis fails.
 */
function fallbackClassify(text) {
  const t = text.toLowerCase();
  if (/\batom|molecule|chemical|bond|cell\b|dna|rna|protein|enzyme|gene|nucleus|electron|neutron|proton|biology|microscop/.test(t))
    return { type: 'A', name: 'MOLECULAR / ATOMIC STRUCTURE', textAlignment: 'center', animationStyle: 'technical', accentColors: ['#10b981', '#06b6d4'], svgScaffold: 'Draw atoms as circles and bonds as lines. Animate with stroke-dashoffset.', titleText: 'Molecular Structure', textContent: text.slice(0, 80) };
  if (/percent|%|statistic|number|\bdata\b|growth|rate|increase|decrease|million|billion|ratio|\bchart\b|\bgraph\b|survey|poll|figure/.test(t))
    return { type: 'B', name: 'DATA CHART / BAR GRAPH', textAlignment: 'left', animationStyle: 'technical', accentColors: ['#6366f1', '#06b6d4'], svgScaffold: 'Draw a 4-bar vertical chart. Baseline y=580. Bars grow from 0 width springs.', titleText: 'Key Statistics', textContent: text.slice(0, 80) };
  if (/\bstep\b|\bsteps\b|process|stage|pipeline|how it works|sequence|phase|cycle|method|procedure|workflow|algorithm/.test(t))
    return { type: 'C', name: 'PROCESS FLOWCHART', textAlignment: 'left', animationStyle: 'energetic', accentColors: ['#6366f1', '#f59e0b'], svgScaffold: 'Draw 3-4 labeled boxes connected by arrow lines. Stagger box entrances 25 frames apart.', titleText: 'Step by Step', textContent: text.slice(0, 80) };
  if (/history|timeline|\byear\b|century|decade|event|\bdate\b|evolution|era|period|founded|invented|discovered|ancient|modern/.test(t))
    return { type: 'D', name: 'TIMELINE / HISTORY', textAlignment: 'center', animationStyle: 'elegant', accentColors: ['#f59e0b', '#06b6d4'], svgScaffold: 'Draw a horizontal line extending left to right with milestone circles above and below.', titleText: 'Historical Timeline', textContent: text.slice(0, 80) };
  if (/compare|versus|\bvs\b|difference|opposite|contrast|pros|cons|advantages|disadvantages|benefit|drawback/.test(t))
    return { type: 'F', name: 'COMPARISON / SPLIT PANEL', textAlignment: 'table', animationStyle: 'energetic', accentColors: ['#6366f1', '#ef4444'], svgScaffold: 'Draw two panel rects that slide in from opposite sides. Center divider line.', titleText: 'Comparison', textContent: text.slice(0, 80) };
  if (/force|wave|motion|velocity|\bfield\b|electric|magnetic|frequency|oscillat|photon|quantum|gravity|momentum|orbit|radiation/.test(t))
    return { type: 'G', name: 'PHYSICS / VECTOR DIAGRAM', textAlignment: 'center', animationStyle: 'technical', accentColors: ['#06b6d4', '#a855f7'], svgScaffold: 'Draw directional arrows and a sine wave path. Add moving particle dots.', titleText: 'Physics Diagram', textContent: text.slice(0, 80) };
  return { type: 'E', name: 'CONCEPT WITH GEOMETRIC ACCENTS', textAlignment: 'center', animationStyle: 'elegant', accentColors: ['#6366f1', '#06b6d4'], svgScaffold: 'Draw 3 concentric circle rings growing from radius 0. Add 2 orbiting dots and 6 radiating lines.', titleText: 'Key Concept', textContent: text.slice(0, 80) };
}

/**
 * Returns true if the AI-generated code contains actual SVG drawing geometry.
 * Used to detect and reject text-only scenes before they reach the renderer.
 */
function validateSceneHasVisuals(code) {
  const tokens = ['<circle', '<rect', '<line ', ' <line\n', '<path ', '<path\n', '<polygon', '<ellipse', 'stroke-dashoffset', 'viewBox'];
  return tokens.some((t) => code.includes(t));
}

/**
 * Builds a forceful override retry prompt using the full AI analysis result.
 * Called when the first generated scene has zero SVG geometry.
 */
async function buildVisualOverridePrompt(sectionText, sectionIndex, durationInFrames, totalSections, analysis) {
  const durationSec = (durationInFrames / FPS).toFixed(1);
  const ph = Math.floor(durationInFrames / 2);
  const align = analysis.textAlignment || 'center';
  const color1 = (analysis.accentColors || ['#6366f1'])[0];
  const color2 = (analysis.accentColors || ['#6366f1', '#06b6d4'])[1] || '#06b6d4';
  const textAlignCSS = align === 'left' ? 'left' : 'center';

  return `You are a Remotion animation engineer. The previous attempt produced a TEXT-ONLY scene — REJECTED.

NARRATION:
"${sectionText.slice(0, 400)}"

SCENE PRESCRIPTION FROM AI DIRECTOR:
- Visual type: TYPE ${analysis.type} — ${analysis.name}
- Animation style: ${analysis.animationStyle || 'technical'}
- Text alignment: ${align}
- Accent colors: ${color1}, ${color2}
- Scene title: "${analysis.titleText || ''}"
- SVG scaffold instructions: ${analysis.svgScaffold}

ABSOLUTE RULE: The VISUAL ZONE must contain animated SVG geometry — at least 4 of:
  <circle>, <rect>, <path>, <line>, <polygon>, <ellipse>
If you produce zero SVG elements, this output will be thrown away.

LANGUAGE: Plain JavaScript ONLY — NO TypeScript. Do NOT use type annotations (: number,
: string, : React.FC, interface, type keyword, generics like <T>, as keyword).
esbuild compiles this as .jsx, NOT .tsx — TypeScript syntax will cause a fatal build error.

MANDATORY IMPORTS:
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, AbsoluteFill } from 'remotion';

⛔ DO NOT import: interpolateColor, useSequenceConfig, useSpring, animated, Transition,
   TransitionSeries, useAnimation, useTiming, config — these DO NOT EXIST in Remotion.
   If you need color interpolation use: interpolateColors (with an 's').

LAYOUT SKELETON — expand the SVG section with real geometry:
export const Scene = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const fade =
    interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' }) *
    interpolate(frame, [durationInFrames - 15, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: 'linear-gradient(160deg,#0a0a0f 0%,#0f0f2e 100%)', opacity: fade }}>

      {/* VISUAL ZONE: absolutely positioned, top 62%, inner padding 80px sides 60px top */}
      <div style={{ position:'absolute', top:0, left:0, width:'100%', height:'62%',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    padding:'60px 80px 0 80px', boxSizing:'border-box' }}>
        <svg viewBox="0 0 1760 548" width="1760" height="548" style={{ overflow:'visible' }}>
          {/* ← IMPLEMENT ${analysis.name} SVG HERE: ${analysis.svgScaffold} */}
        </svg>
      </div>

      {/* TEXT ZONE: absolutely positioned, bottom 38%, inner padding 80px sides */}
      <div style={{ position:'absolute', bottom:0, left:0, width:'100%', height:'38%',
                    display:'flex', flexDirection:'column', alignItems:${align === 'left' ? "'flex-start'" : "'center'"},
                    justifyContent:'center', padding:'0 120px 60px 120px', boxSizing:'border-box', gap:14 }}>

        <Sequence from={0} durationInFrames={${ph}}>
          <AbsoluteFill style={{ display:'flex', alignItems:'center',
                                  justifyContent:${align === 'left' ? "'flex-start'" : "'center'"},
                                  padding:'0 120px 60px 120px', boxSizing:'border-box' }}>
            <div style={{ color:'#ffffff', fontSize:'44px', fontWeight:700,
                          textAlign:'${textAlignCSS}', lineHeight:1.55, maxWidth:'1680px',
                          fontFamily:'system-ui,-apple-system,sans-serif',
                          textShadow:'0 2px 20px rgba(99,102,241,0.35)' }}>
              {/* FIRST HALF CAPTION */}
            </div>
          </AbsoluteFill>
        </Sequence>

        <Sequence from={${ph}} durationInFrames={${Math.max(1, durationInFrames - ph)}}>
          <AbsoluteFill style={{ display:'flex', alignItems:'center',
                                  justifyContent:${align === 'left' ? "'flex-start'" : "'center'"},
                                  padding:'0 120px 60px 120px', boxSizing:'border-box' }}>
            <div style={{ color:'#e0e7ff', fontSize:'44px', fontWeight:600,
                          textAlign:'${textAlignCSS}', lineHeight:1.55, maxWidth:'1680px',
                          fontFamily:'system-ui,-apple-system,sans-serif' }}>
              {/* SECOND HALF CAPTION */}
            </div>
          </AbsoluteFill>
        </Sequence>

      </div>
    </AbsoluteFill>
  );
};
export default Scene;

Return ONLY the complete .jsx file. No markdown. No explanation. Start with: import React from 'react';`;
}

// ─── Gemini helpers ─────────────────────────────────────────────────────────

/**
 * Gemini 2.5 Pro — used for code generation (high quality, thinks deeply).
 */
async function callGemini(prompt, retries = 3) {
  const genAI = new GoogleGenerativeAI(env.geminiApiKey);
  const model = genAI.getGenerativeModel(
    { model: "gemini-2.5-pro" },
    { apiVersion: "v1beta" }
  );

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      return result.response.text();
    } catch (err) {
      console.warn(`[detailedAgent] Gemini attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Gemini 2.5 Flash — used for code review (fast, cheap, still very capable).
 * Uses a modest thinking budget so it reasons about the code but doesn't overdo it.
 */
async function callGeminiFlash(prompt, retries = 2) {
  const genAI = new GoogleGenerativeAI(env.geminiApiKey);
  const model = genAI.getGenerativeModel(
    { model: "gemini-2.5-flash" },
    { apiVersion: "v1beta" }
  );

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          thinkingConfig: { thinkingBudget: 8000 },
        },
      });
      return result.response.text();
    } catch (err) {
      console.warn(`[detailedAgent] Flash review attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        throw err;
      }
    }
  }
}

// ─── Code extraction ─────────────────────────────────────────────────────────

/**
 * Strip markdown fences that Gemini adds despite being told not to.
 */
function extractCode(raw) {
  let code = raw
    .replace(/^```(?:jsx?|tsx?|javascript|typescript)?\s*\n?/im, "")
    .replace(/\n?```\s*$/im, "")
    .trim();

  // Make sure it starts with an import statement
  const idx = code.indexOf("import ");
  if (idx > 0) code = code.slice(idx);

  // Strip TypeScript annotations that break esbuild's jsx loader
  code = stripTypeScript(code);

  return code;
}

/**
 * Strip TypeScript-specific syntax from AI-generated code so esbuild's jsx/tsx
 * loader doesn't choke. Handles the most common patterns Gemini adds:
 *   - Variable/param type annotations:   const x: number = 5  →  const x = 5
 *   - Function return types:             ): React.ReactNode => {  →  ) => {
 *   - React.FC type:                     const Scene: React.FC = () =>  →  const Scene = () =>
 *   - Standalone type/interface blocks:  interface Props { ... }  →  (removed)
 *   - import type statements:            import type { ... }  →  (removed)
 *   - Generic type params:               useRef<HTMLDivElement>  →  useRef
 *   - as keyword casts:                  (x as number)  →  (x)
 */
function stripTypeScript(code) {
  // Remove `import type { ... } from '...'` lines entirely
  code = code.replace(/^import\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]*['"];?\s*$/gm, '');

  // Remove `import type X from '...'` (default type import, no curly braces)
  code = code.replace(/^import\s+type\s+\w+\s+from\s+['"][^'"]*['"];?\s*$/gm, '');

  // Remove standalone `type X = ...;` declarations (single-line, may contain ; inside braces)
  code = code.replace(/^type\s+[A-Z]\w*\s*=\s*.+$/gm, '');

  // Remove `export type X = ...` declarations (AI often adds export prefix)
  code = code.replace(/^export\s+type\s+[A-Z]\w*\s*=\s*.+$/gm, '');

  // Remove standalone `interface X { ... }` blocks (multi-line)
  code = code.replace(/^interface\s+\w+\s*\{[^}]*\}\s*$/gm, '');

  // Remove `export interface X { ... }` blocks
  code = code.replace(/^export\s+interface\s+\w+\s*\{[^}]*\}\s*$/gm, '');

  // Remove `: React.FC<...>` or `: React.FC` from const declarations
  code = code.replace(/:\s*React\.FC(?:<[^>]*>)?\s*(?==)/g, ' ');

  // Remove `: TYPE` annotations from const/let/var declarations
  // Only matches known type keywords + PascalCase custom types (not numbers/values)
  code = code.replace(/(?<=(?:const|let|var)\s+\w+)\s*:\s*(?:number|string|boolean|any|void|null|undefined|object|never|unknown|React\.\w+(?:<[^>]*>)?|[A-Z]\w*(?:\[\])?)\s*(?==)/g, ' ');

  // Remove return type annotations from arrow functions: ): ReturnType => {
  code = code.replace(/\)\s*:\s*(?:React\.\w+(?:<[^>]*>)?|JSX\.Element|void|null|undefined|[A-Z]\w*)\s*(?==>)/g, ') ');

  // Remove generic type parameters: useRef<HTMLDivElement>(null) → useRef(null)
  code = code.replace(/(\w+)<[A-Z]\w*(?:\s*\|\s*\w+)*>(?=\s*\()/g, '$1');

  // Remove `as Type` casts: (value as number) → (value)
  code = code.replace(/\s+as\s+(?:number|string|boolean|any|const|[A-Z]\w*)(?=[),;\s\]}])/g, '');

  // Remove parameter type annotations in destructured params: { text, color = '#fff' }: Props → { text, color = '#fff' }
  code = code.replace(/(\})\s*:\s*[A-Z]\w*(?:\s*(?:&|<)[^)]*)?(?=\s*[)=])/g, '$1');

  // Remove simple parameter type annotations: (param: string) → (param)
  // Only matches known type keywords + PascalCase custom types (not object values like x: 5)
  code = code.replace(/(\w+)\s*:\s*(?:number|string|boolean|any|void|React\.\w+(?:<[^>]*>)?|[A-Z]\w*(?:\[\])?)(?=\s*[,)=])/g, '$1');

  return code;
}

/**
 * Basic sanity check: must have import from remotion, export const Scene,
 * AND use Sequence (required for overlap-free multi-text scenes).
 */
function isValidCode(code) {
  return (
    code.includes("from 'remotion'") &&
    code.includes("export") &&
    code.includes("Scene") &&
    code.includes("return") &&
    (code.includes("AbsoluteFill") || code.includes("div") || code.includes("svg")) &&
    code.includes("Sequence") // mandatory for overlap prevention
  );
}

/**
 * Whitelist of VALID Remotion 4.x exports. Anything the AI imports from 'remotion'
 * that's not in this set will be stripped — preventing runtime "is not a function" errors.
 */
const REMOTION_VALID_EXPORTS = new Set([
  'AbsoluteFill', 'Audio', 'Composition', 'Easing', 'Folder', 'Freeze',
  'IFrame', 'Img', 'Loop', 'OffthreadVideo', 'Sequence', 'Series', 'Still',
  'Video', 'cancelRender', 'continueRender', 'delayRender', 'getInputProps',
  'getRemotionEnvironment', 'getStaticFiles', 'interpolate', 'interpolateColors',
  'measureSpring', 'prefetch', 'random', 'registerRoot', 'spring', 'staticFile',
  'useBufferState', 'useCurrentFrame', 'useCurrentScale', 'useDelayRender',
  'useRemotionEnvironment', 'useVideoConfig', 'watchStaticFile',
]);

/**
 * Common AI hallucinations → correct Remotion API name.
 * These are functions the AI "invents" that are close to real ones.
 */
const REMOTION_CORRECTIONS = {
  'interpolateColor':  'interpolateColors',       // missing 's'
  'interpolateColour': 'interpolateColors',       // british spelling
  'interpolateColours':'interpolateColors',
  'useSequenceConfig': null,                       // does not exist — strip entirely
  'useSequence':       null,                       // does not exist
  'useSpring':         null,                       // react-spring, not remotion
  'animated':          null,                       // react-spring
  'config':            null,                       // react-spring config object
  'useAnimation':      null,
  'useTiming':         null,
  'Transition':        null,                       // remotion doesn't have this
  'TransitionSeries':  null,                       // remotion-transitions, not core
};

/**
 * Sanitize imports from 'remotion': strip hallucinated API names and auto-correct
 * common mistakes. Also removes usages of stripped names from the code body.
 */
function sanitizeRemotionImports(code) {
  // Fix hallucinated subpath imports: 'remotion/easing', 'remotion/spring' → 'remotion'
  code = code.replace(/from\s+['"]remotion\/[a-zA-Z-]+['"]/g, "from 'remotion'");

  // Match the import { ... } from 'remotion' line (handles multi-line collapsed into one)
  const importRx = /^(import\s+\{)([^}]+)(\}\s+from\s+['"]remotion['"];?)$/m;
  const match = code.match(importRx);
  if (!match) return code;

  const originalImport = match[0];
  const names = match[2].split(',').map(n => n.trim()).filter(Boolean);

  const kept = [];
  const stripped = [];
  const corrections = {}; // oldName → newName for body replacement

  for (const name of names) {
    // Handle 'X as Y' aliases
    const baseName = name.split(/\s+as\s+/)[0].trim();

    if (REMOTION_VALID_EXPORTS.has(baseName)) {
      kept.push(name);
    } else if (baseName in REMOTION_CORRECTIONS) {
      const correction = REMOTION_CORRECTIONS[baseName];
      if (correction) {
        // Auto-correct to the right name
        kept.push(correction);
        corrections[baseName] = correction;
      } else {
        // No equivalent — strip entirely
        stripped.push(baseName);
      }
    } else {
      // Unknown — strip it
      stripped.push(baseName);
    }
  }

  // Step 1: Replace the import line FIRST (before body edits mutate the string)
  if (kept.length === 0) {
    const newImport = "import { useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, AbsoluteFill } from 'remotion';";
    code = code.replace(originalImport, newImport);
  } else {
    const newImport = `import { ${kept.join(', ')} } from 'remotion';`;
    code = code.replace(originalImport, newImport);
  }

  // Step 2: Apply corrections in the code body (e.g. interpolateColor → interpolateColors)
  for (const [oldName, newName] of Object.entries(corrections)) {
    code = code.replace(new RegExp(`\\b${oldName}\\b`, 'g'), newName);
    console.log(`[detailedAgent] auto-corrected: ${oldName} → ${newName}`);
  }

  // Step 3: Strip usages of completely removed names
  if (stripped.length > 0) {
    console.warn(`[detailedAgent] stripped invalid remotion imports: ${stripped.join(', ')}`);
    for (const name of stripped) {
      // Replace variable declarations that use the stripped function:
      // e.g. const foo = useSequenceConfig(); → const foo = {};
      code = code.replace(
        new RegExp(`(const|let|var)\\s+(\\w+)\\s*=\\s*${name}\\s*\\([^)]*\\)`, 'g'),
        '$1 $2 = {}'
      );
      // Replace remaining function calls: name(...) → 0
      code = code.replace(new RegExp(`\\b${name}\\s*\\(`, 'g'), '(0 && (');
    }
  }

  return code;
}

/**
 * Repair common AI code mistakes that cause blank frames:
 *  1. Frame numbers in interpolate() exceed durationInFrames → scale them down.
 *  2. Sequence durationInFrames exceeds remaining frames → clamp it.
 *  3. spring() delay offsets larger than duration → clamp them.
 */
function repairCode(code, durationInFrames) {
  // ── 0. Sanitize remotion imports (strip hallucinated API names) ──────────
  code = sanitizeRemotionImports(code);

  const max = durationInFrames;

  // ── 1. Find the largest raw frame number used in any interpolate call ───────
  const nums = [];
  const interpRx = /interpolate\s*\(\s*(?:frame|localFrame)\s*,\s*\[([0-9.]+)\s*,\s*([0-9.]+)\]/g;
  let m;
  while ((m = interpRx.exec(code)) !== null) {
    nums.push(parseFloat(m[1]), parseFloat(m[2]));
  }

  if (nums.length > 0) {
    const maxUsed = Math.max(...nums);
    if (maxUsed > max * 1.05) {
      // Scale every interpolate frame pair proportionally
      const scale = (max - 1) / maxUsed;
      code = code.replace(
        /interpolate\s*\(\s*(frame|localFrame)\s*,\s*\[([0-9.]+)\s*,\s*([0-9.]+)\]/g,
        (_, frameVar, a, b) => {
          const na = Math.max(0, Math.round(parseFloat(a) * scale));
          const nb = Math.min(max, Math.round(parseFloat(b) * scale));
          return `interpolate(${frameVar}, [${na}, ${nb}]`;
        }
      );
    }
  }

  // ── 2. Clamp hardcoded durationInFrames literals in Sequence props ──────────
  code = code.replace(
    /<Sequence([^>]*?)from=\{(\d+)\}([^>]*?)durationInFrames=\{(\d+)\}/g,
    (_, pre, from, mid, dur) => {
      const f = Math.min(parseInt(from, 10), max - 1);
      const remaining = max - f;
      const d = Math.max(1, Math.min(parseInt(dur, 10), remaining));
      return `<Sequence${pre}from={${f}}${mid}durationInFrames={${d}}`;
    }
  );
  code = code.replace(
    /<Sequence([^>]*?)durationInFrames=\{(\d+)\}([^>]*?)from=\{(\d+)\}/g,
    (_, pre, dur, mid, from) => {
      const f = Math.min(parseInt(from, 10), max - 1);
      const remaining = max - f;
      const d = Math.max(1, Math.min(parseInt(dur, 10), remaining));
      return `<Sequence${pre}durationInFrames={${d}}${mid}from={${f}}`;
    }
  );

  // ── 3. Clamp spring delay offsets (frame - N) where N >= max ────────────────
  code = code.replace(
    /spring\s*\(\s*\{\s*frame\s*:\s*frame\s*-\s*(\d+)/g,
    (_, delay) => {
      const safe = Math.min(parseInt(delay, 10), Math.max(0, max - 15));
      return `spring({ frame: frame - ${safe}`;
    }
  );

  // ── 4. Fix react-spring API confusion: spring(...).to(...) ─────────────────
  // Remotion's spring() returns a plain number — it has NO .to() method.
  // The AI sometimes confuses it with react-spring's useSpring().to().
  // Fix: spring({...}).to(inputRange, outputRange) → interpolate(spring({...}), inputRange, outputRange)
  // Also handle simple .to(fn) form → just call the fn inline
  code = code.replace(
    /spring\s*\(([^)]*(?:\([^)]*\))*[^)]*)\)\.to\s*\(\s*\[([^\]]+)\]\s*,\s*\[([^\]]+)\]\s*\)/g,
    (_, springArgs, inputRange, outputRange) =>
      `interpolate(spring(${springArgs}), [${inputRange}], [${outputRange}], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })`
  );
  // Simpler .to(fn) form → just unwrap: spring({...}).to(v => v * 100) → spring({...}) * 100
  // We can't perfectly parse arbitrary functions, so just strip .to(...) and let the
  // plain number pass through (usually it's 0-1 which is fine for opacity).
  code = code.replace(
    /(spring\s*\([^)]*(?:\([^)]*\))*[^)]*\))\.to\s*\([^)]*\)/g,
    '$1'
  );

  // ── 5. Auto-fix missing props on helper component call sites ──────────────
  // AI often creates helper components (AnimatedText, TextBlock, etc.) but forgets
  // to pass required props at the call site. This causes ReferenceErrors or
  // spring() getting Infinity from undefined durationInFrames.
  // FIX: detect props WITHOUT defaults in the destructuring pattern, then inject
  // safe defaults at every call site that's missing them.
  const PROP_DEFAULTS = {
    // Frame / timing
    from: '0', durationInFrames: 'durationInFrames', frame: 'frame', fps: 'fps',
    delay: '0', startFrame: '0', endFrame: 'durationInFrames', duration: '30',
    // Colors
    color: '"#ffffff"', primary: '"#3b82f6"', secondary: '"#8b5cf6"',
    accent: '"#f59e0b"', background: '"#1a1a2e"', bg: '"#1a1a2e"',
    textColor: '"#ffffff"', fillColor: '"#6366f1"', strokeColor: '"#06b6d4"',
    glow: '"#6366f180"', glowColor: '"#6366f180"',
    // Typography
    fontSize: '24', fontFamily: '"system-ui, sans-serif"', fontWeight: '700',
    lineHeight: '1.4', letterSpacing: '0',
    // Layout / geometry
    index: '0', total: '1', progress: '0', opacity: '1', scale: '1',
    x: '0', y: '0', width: '200', height: '200', radius: '50', size: '100',
    // Content
    text: '""', label: '""', title: '""', subtext: '""', subtitle: '""',
    description: '""', content: '""', heading: '""', name: '""', value: '""',
    icon: 'null', svg: 'null', src: '""', items: '[]', data: '[]',
  };
  const SKIP_PROPS = new Set(['children', 'key', 'ref', 'style']);

  // Phase A: collect helper definitions and their props that lack defaults
  const helperRx = /(?:const|let|var|function)\s+([A-Z]\w+)\s*=?\s*(?:\(\s*\{([^}]*)\}\s*\)|function\s*\(\s*\{([^}]*)\}\s*\))/g;
  let hm;
  const helperPropsMap = new Map(); // helperName → string[] of prop names needing injection
  while ((hm = helperRx.exec(code)) !== null) {
    const helperName = hm[1];
    if (helperName === 'Scene') continue;
    const rawParams = (hm[2] || hm[3] || '').split(',');
    const needsInjection = [];
    for (const p of rawParams) {
      let trimmed = p.trim();
      if (!trimmed || /^\.\.\./.test(trimmed)) continue;
      // Strip inline comments that AI sometimes adds in destructuring
      trimmed = trimmed.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim();
      if (!trimmed) continue;
      // Skip props that already have defaults — they won't be undefined
      if (/=\s*.+/.test(trimmed)) continue;
      const name = trimmed.split(/[:]/)[0].trim();
      // Must be a valid JS identifier (letters, digits, _, $) — reject garbage
      if (name && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && !SKIP_PROPS.has(name)) {
        needsInjection.push(name);
      }
    }
    if (needsInjection.length > 0) helperPropsMap.set(helperName, needsInjection);
  }

  // Phase B: for each helper, fix all call sites that are missing props
  for (const [helperName, requiredProps] of helperPropsMap) {
    code = code.replace(
      new RegExp(`<${helperName}\\b([^/]*?)(/>|>)`, 'g'),
      (fullMatch, attrs, close) => {
        // Skip spread callers — they pass everything
        if (/\{\.\.\.\w/.test(attrs)) return fullMatch;
        const missing = [];
        for (const prop of requiredProps) {
          if (!attrs.includes(prop)) {
            const val = PROP_DEFAULTS[prop] || '""';
            missing.push(`${prop}={${val}}`);
          }
        }
        if (missing.length > 0) {
          console.log(`[detailedAgent] auto-fixed: <${helperName}> injected ${missing.length} missing prop(s): ${missing.map(m => m.split('=')[0]).join(', ')}`);
          return `<${helperName}${attrs} ${missing.join(' ')} ${close}`;
        }
        return fullMatch;
      }
    );
  }

  // ── 6. Guard spring() against undefined durationInFrames ────────────────────
  // When durationInFrames comes from a helper's props and isn't passed,
  // it's undefined → spring() computes Infinity → runtime crash.
  // Fix: add fallback to scene-level max wherever spring() uses durationInFrames.
  code = code.replace(
    /spring\s*\(\s*\{([^}]*)\}/g,
    (match, inner) => {
      // Only fix if it has a bare durationInFrames (not already guarded)
      if (/durationInFrames/.test(inner) && !/durationInFrames\s*[|?:]/.test(inner)
          && !/durationInFrames\s*:\s*\(/.test(inner) && !/\|\|/.test(inner)) {
        return match.replace(
          /\bdurationInFrames\b(?!\s*:)/,
          `durationInFrames: (durationInFrames || ${max})`
        ).replace(
          /\bdurationInFrames\s*:\s*durationInFrames\b(?!\s*[|?])/,
          `durationInFrames: (durationInFrames || ${max})`
        );
      }
      return match;
    }
  );

  return code;
}

// ─── AI Code Reviewer ─────────────────────────────────────────────────────────

/**
 * Build a review prompt that asks Gemini to reason through the generated code
 * and fix any bugs before it is compiled by esbuild/Remotion.
 */
function buildReviewPrompt(code, sectionText, durationInFrames) {
  const durationSec = (durationInFrames / FPS).toFixed(1);
  return `You are an expert React / Remotion code reviewer. A junior AI wrote the JSX animation below.
Your job: carefully reason through the code, find every bug, then return the complete corrected code.

IMPORTANT: Output PLAIN JAVASCRIPT only. Remove any TypeScript annotations (: number, : string,
: React.FC, interface, type, generics). The build system uses esbuild with a .jsx loader —
TypeScript syntax causes fatal build errors.

CONTEXT:
- Framework: Remotion (React-based video renderer)
- Canvas: 1920 × 1080px
- Total frames: ${durationInFrames} (${durationSec}s at ${FPS}fps)
- Narration this scene must illustrate: "${sectionText.slice(0, 300)}"

═══════════════════════════════════════════════
CODE TO REVIEW:
═══════════════════════════════════════════════
${code}
═══════════════════════════════════════════════

STEP 1 — REASON THROUGH THESE BUG CATEGORIES (think carefully about each):

A. RUNTIME CRASHES (highest priority):
   - Any variable accessed before it is defined? (e.g. array.map() result used before checking it exists)
   - Any object property access that could be undefined? (e.g. items[i].x where items[i] could be undefined)
   - Any array destructuring on a value that could be null/undefined?
   - Any division by zero? (e.g. 1 / array.length when array might be empty)
   - Any Math.sqrt / Math.log of a negative/zero?
   - Any function called on a non-function? (e.g. spring(...).to(...) — Remotion spring returns a number, NOT an object)
   - HELPER COMPONENT PROPS BUG (very common!): If there is a helper component (e.g. AnimatedText, TextBlock, Label),
     check that EVERY variable it uses is either:
       (a) destructured from its OWN props: e.g. const AnimatedText = ({ text, color, startFrame }) => { ... }
       (b) defined inside its own function body
       (c) a module-level constant or import
     If a variable like 'color', 'text', 'opacity', 'index' is used inside a helper but NOT destructured from
     its props, this is a GUARANTEED ReferenceError at runtime. Fix it by adding the missing prop to the
     destructuring pattern AND making sure the parent passes it.

B. FRAME NUMBER CORRECTNESS:
   - Does any hardcoded frame number EXCEED ${durationInFrames}? If so, scale it down proportionally.
   - Does the scene-fade-out use \`durationInFrames\` from useVideoConfig()? (NOT a hardcoded number)
   - Do all Sequence from+durationInFrames combinations fit within the total ${durationInFrames} frames?

C. POSITIONING & LAYOUT:
   - Are SVG elements positioned within the 0–1920 (x) and 0–1080 (y) canvas?
   - Are absolutely positioned div elements within bounds?
   - Text elements: is font size reasonable (not 500px, not 0px)?
   - Are there overlapping elements that should be staggered?
   - Are all elements visible (not opacity: 0 for the entire duration)?
   - LAYOUT ZONE VIOLATION (most critical overlap bug): Does the code put both an SVG/visual
     diagram AND a text caption inside the same full-canvas AbsoluteFill with
     display:'flex', alignItems:'center'? That renders both at y≈540 — causing overlap.
     If YES, fix it by splitting into:
       • Visual container: position:'absolute', top:0, left:0, width:'100%', height:'62%',
                           display:'flex', alignItems:'center', justifyContent:'center'
       • Text container:   position:'absolute', bottom:0, left:0, width:'100%', height:'38%',
                           display:'flex', alignItems:'center', justifyContent:'center'
     The SVG diagram goes in the visual container, text captions in the text container.

D. REMOTION API CORRECTNESS:
   - spring() returns a plain number (0–1). NOT an object. No .x, .y, .to() on it.
   - interpolate() input range must be strictly ascending.
   - useCurrentFrame() and useVideoConfig() must be called at the TOP of the component, not inside conditions or loops.
   - Hooks (useState, useEffect etc.) must NOT be used — Remotion renders frame-by-frame, hooks break it.
   - IMPORT CHECK (critical!): Verify EVERY name imported from 'remotion' actually exists.
     These are VALID: useCurrentFrame, useVideoConfig, interpolate, spring, Sequence,
                      AbsoluteFill, interpolateColors, Easing, delayRender, continueRender,
                      measureSpring, random, Img, Audio, Video, Loop, Series, Freeze
     These DO NOT EXIST and must be REMOVED:
       ❌ interpolateColor → fix to interpolateColors (with 's')
       ❌ useSequenceConfig → remove entirely, use useVideoConfig instead
       ❌ useSpring, animated, config → these are react-spring, NOT Remotion
       ❌ Transition, TransitionSeries → not in core Remotion
     If you find a hallucinated import, remove it AND replace its usage with a valid alternative.

E. TEXT-ONLY DETECTION — FIX IF FOUND:
   - Count every SVG drawing element in the code: <circle, <rect, <line, <path, <polygon, <ellipse.
   - If ZERO such elements exist, this is a TEXT-ONLY scene — it MUST be fixed.
   - Add an SVG visualization in the VISUAL ZONE (position:absolute, top:0, height:62%):
       • Data / numbers narration → bar chart with 4+ <rect> bars growing from 0 height
       • Process / steps narration → flowchart boxes (<rect>+<text>) connected with <line> arrows
       • Chemistry / biology narration → <circle> atoms with <line> bonds
       • History / dates narration → horizontal <line> timeline with milestone <circle> nodes
       • Abstract / concept narration → 3–4 concentric <circle> rings + 2–3 orbiting <circle> dots
   - The SVG must use interpolate() or spring() to animate the elements in.
   - Move all text captions into the TEXT ZONE div (position:absolute, bottom:0, height:38%).

STEP 2 — RETURN THE FIXED CODE:
- If you found bugs: fix ALL of them and return the complete corrected .jsx file.
- If no bugs: return the original code unchanged.
- Output ONLY the raw .jsx code. No markdown fences. No explanation text. No comments about what you changed.
- The file MUST start with: import React from 'react';
`;
}

/**
 * Have Gemini Flash review and fix the generated code.
 * Returns the (possibly corrected) code string.
 * If the review call fails, returns the original code unchanged (non-blocking).
 */
async function reviewAndFixCode(code, sectionText, durationInFrames, sceneIdx) {
  const reviewPrompt = buildReviewPrompt(code, sectionText, durationInFrames);
  try {
    console.log(`[detailedAgent] scene ${sceneIdx + 1}: reviewing code with Flash...`);
    const raw = await callGeminiFlash(reviewPrompt);
    const fixed = extractCode(raw);

    // Only accept the reviewed version if it still looks like valid code
    if (fixed && fixed.includes("from 'remotion'") && fixed.includes("Scene")) {
      const changed = fixed.trim() !== code.trim();
      if (changed) {
        console.log(`[detailedAgent] scene ${sceneIdx + 1}: reviewer made fixes, using corrected code`);
      } else {
        console.log(`[detailedAgent] scene ${sceneIdx + 1}: reviewer approved code, no changes needed`);
      }
      // Run repairCode again on the reviewed output to catch any new frame-number issues
      return repairCode(fixed, durationInFrames);
    } else {
      console.warn(`[detailedAgent] scene ${sceneIdx + 1}: reviewer returned invalid code, keeping original`);
      return code;
    }
  } catch (err) {
    console.warn(`[detailedAgent] scene ${sceneIdx + 1}: review step failed (${err.message}), keeping original code`);
    return code;
  }
}

// ─── Rescue scene generator (AI-powered, simpler prompt) ──────────────────────

/**
 * When the main 3-attempt generation loop fails, this function makes one more
 * attempt with a drastically simplified prompt via Flash. It's shorter, avoids
 * complex layout rules, and is much more likely to produce valid JSX.
 *
 * Returns valid JSX code string, or null if even this fails.
 */
async function generateRescueScene(sectionText, durationInFrames, analysis = {}) {
  const color1 = (analysis.accentColors || ['#6366f1'])[0] || '#6366f1';
  const color2 = (analysis.accentColors || ['#6366f1', '#06b6d4'])[1] || '#06b6d4';
  const title = (analysis.titleText || sectionText.slice(0, 40)).replace(/`/g, "'").replace(/\\/g, '\\\\');
  const scaffold = analysis.svgScaffold || 'Animate 3 circles growing in, with connecting lines drawing between them';

  const rescuePrompt = `Write a COMPLETE Remotion JSX component file. 
This is a RESCUE generation — keep it simple but contextual to the narration below.

NARRATION: "${sectionText.slice(0, 300)}"
SCENE TITLE: "${title}"
DURATION: ${durationInFrames} frames at 30fps
COLORS: primary=${color1}, secondary=${color2}
VISUAL IDEA: ${scaffold}

RULES:
1. Start with: import React from 'react';
2. Import ONLY: useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, AbsoluteFill from 'remotion'
   DO NOT import: interpolateColor, useSequenceConfig, useSpring, animated, Transition — they don't exist
   If you need color interpolation: import { interpolateColors } from 'remotion' (with an 's')
3. PLAIN JAVASCRIPT ONLY — NO TypeScript annotations, no : type, no interface, no generics
4. Export: export const Scene = () => { ... }; export default Scene;
4. Use const frame = useCurrentFrame(); const { fps, durationInFrames } = useVideoConfig();
5. Background: dark gradient (linear-gradient(160deg, #0a0a0f 0%, #0e0e28 100%))
6. TWO zones inside AbsoluteFill:
   - Visual zone: position:'absolute', top:0, height:'62%' — put an <svg viewBox="0 0 1760 548"> with animated shapes
   - Text zone: position:'absolute', bottom:0, height:'38%' — put narration text in <Sequence> blocks
7. For transforms use string concat: 'translateY(' + value + 'px)' — NOT template literals
8. Use interpolate() for ALL animations, always with { extrapolateRight:'clamp' }
9. The SVG shapes MUST relate to what the narration says — no random decorative shapes
10. Keep it under 80 lines total
11. If you create helper sub-components, the caller MUST pass ALL props they need. Use defaults: ({ text, delay = 0 }) => { ... }

Return ONLY the raw JSX file. No markdown. No explanation. First line must be: import React from 'react';`;

  try {
    console.log(`[detailedAgent] rescue attempt via Flash...`);
    const raw = await callGeminiFlash(rescuePrompt, 2);
    const extracted = extractCode(raw);
    const repaired = repairCode(extracted, durationInFrames);
    if (isValidCode(repaired)) {
      console.log(`[detailedAgent] rescue succeeded (${repaired.length} chars)`);
      return repaired;
    }
    console.warn(`[detailedAgent] rescue produced invalid code`);
    return null;
  } catch (err) {
    console.warn(`[detailedAgent] rescue failed: ${err.message}`);
    return null;
  }
}

/**
 * Absolute nuclear last resort — minimal text-only scene with a subtle gradient
 * and the narration centered. No shapes, no SVG, just clean text presentation.
 * This should NEVER produce a syntax error because it's dead simple.
 */
function buildMinimalFallback(sectionText, durationInFrames) {
  const safeText = sectionText.replace(/`/g, "'").replace(/\\/g, "\\\\").slice(0, 200);
  const phase = Math.floor(durationInFrames / 3);
  const p1 = phase;
  const p2 = phase;
  const p3 = Math.max(1, durationInFrames - p1 - p2);
  const t1 = safeText.slice(0, 70);
  const t2 = safeText.slice(70, 150) || t1;
  const t3 = safeText.slice(150) || t2;

  return `import React from 'react';
import { useCurrentFrame, interpolate, AbsoluteFill, useVideoConfig, Sequence } from 'remotion';

export const Scene = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 15, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = fadeIn * fadeOut;

  return (
    <AbsoluteFill style={{ background: 'linear-gradient(160deg, #0a0a0f 0%, #0e0e28 100%)', opacity }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '62%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '60px 80px 0 80px', boxSizing: 'border-box' }}>
        <div style={{ width: 120, height: 120, borderRadius: '50%',
                      background: 'radial-gradient(circle, #6366f1 0%, transparent 70%)',
                      opacity: 0.3 + 0.2 * Math.sin(frame * 0.05) }} />
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '38%',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    padding: '0 120px 60px 120px', boxSizing: 'border-box' }}>
        <Sequence from={0} durationInFrames={${p1}}>
          <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 120px 60px 120px', boxSizing: 'border-box' }}>
            <div style={{ color: '#fff', fontSize: '44px', fontWeight: 700, textAlign: 'center', lineHeight: 1.55,
                          maxWidth: '1620px', fontFamily: 'system-ui', textShadow: '0 2px 20px rgba(99,102,241,0.35)',
                          opacity: interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' }) }}>
              {\`${t1}\`}
            </div>
          </AbsoluteFill>
        </Sequence>
        <Sequence from={${p1}} durationInFrames={${p2}}>
          <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 120px 60px 120px', boxSizing: 'border-box' }}>
            <div style={{ color: '#e0e7ff', fontSize: '44px', fontWeight: 700, textAlign: 'center', lineHeight: 1.55,
                          maxWidth: '1620px', fontFamily: 'system-ui', textShadow: '0 2px 20px rgba(99,102,241,0.35)',
                          opacity: interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' }) }}>
              {\`${t2}\`}
            </div>
          </AbsoluteFill>
        </Sequence>
        <Sequence from={${p1 + p2}} durationInFrames={${p3}}>
          <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 120px 60px 120px', boxSizing: 'border-box' }}>
            <div style={{ color: '#a5f3fc', fontSize: '44px', fontWeight: 700, textAlign: 'center', lineHeight: 1.55,
                          maxWidth: '1620px', fontFamily: 'system-ui', textShadow: '0 2px 20px rgba(99,102,241,0.35)',
                          opacity: interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' }) }}>
              {\`${t3}\`}
            </div>
          </AbsoluteFill>
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};
export default Scene;
`;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * Build the main generation prompt. Now accepts an `analysis` object from
 * the AI Scene Director agent, which prescribes the visual type, text alignment,
 * SVG scaffold, colors, and animation style for this specific narration.
 *
 * @param {string} sectionText
 * @param {number} sectionIndex
 * @param {number} durationInFrames
 * @param {number} totalSections
 * @param {object} analysis  - result from analyzeSceneWithAI()
 */
function buildCurriculumContextBlock(generationContext = {}) {
  const curriculumData = generationContext.curriculumData || {};
  const namePairs = [
    ["Curriculum", curriculumData.curriculumName],
    ["Grade", curriculumData.gradeName],
    ["Subject", curriculumData.subjectName],
    ["Chapter", curriculumData.chapterName],
    ["Topic", curriculumData.topicName],
    ["Subtopic", curriculumData.subtopicName],
    ["Concept", curriculumData.conceptName],
  ].filter(([, value]) => value);

  const idPairs = [
    ["CurriculumId", curriculumData.curriculumId],
    ["GradeId", curriculumData.gradeId],
    ["SubjectId", curriculumData.subjectId],
    ["ChapterId", curriculumData.chapterId],
    ["TopicId", curriculumData.topicId],
    ["SubtopicId", curriculumData.subtopicId],
    ["ConceptId", curriculumData.conceptId],
  ].filter(([, value]) => value);

  if (!namePairs.length && !idPairs.length) return "";

  return [
    "ACADEMIC CONTEXT (MANDATORY FOR VISUAL CHOICES):",
    ...namePairs.map(([label, value]) => `- ${label}: ${value}`),
    ...idPairs.map(([label, value]) => `- ${label}: ${value}`),
    "- Keep visuals and captions tightly scoped to this context; do not drift to adjacent topics.",
    "",
  ].join("\n");
}

function buildPrompt(sectionText, sectionIndex, durationInFrames, totalSections, analysis, iconPromptSection = '', generationContext = {}) {
  const durationSec = (durationInFrames / FPS).toFixed(1);
  const phaseFrames = Math.floor(durationInFrames / 3);
  const halfFrames  = Math.floor(durationInFrames / 2);
  const maxDelay    = Math.max(0, durationInFrames - 20);

  // Pull values from AI analysis (with safe defaults)
  const type          = analysis.type          || 'E';
  const typeName      = analysis.name          || 'CONCEPT WITH GEOMETRIC ACCENTS';
  const textAlignment = analysis.textAlignment || 'center';
  const animStyle     = analysis.animationStyle|| 'elegant';
  const colors        = analysis.accentColors  || ['#6366f1', '#06b6d4'];
  const color1        = colors[0] || '#6366f1';
  const color2        = colors[1] || '#06b6d4';
  const svgScaffold   = analysis.svgScaffold   || 'Draw 3 concentric circle rings growing in. Add 2 orbiting dots.';
  const titleText     = analysis.titleText     || sectionText.slice(0, 40);
  const textContent   = analysis.textContent   || '';
  const titleText_js  = titleText.replace(/`/g, "'").replace(/\\/g, '\\\\');
  const curriculumContext = buildCurriculumContextBlock(generationContext);

  // Text alignment rules → CSS and flexbox alignment values
  const cssTextAlign  = textAlignment === 'left'  ? 'left'  : 'center';
  const flexJustify   = textAlignment === 'left'  ? "'flex-start'" : "'center'";
  const textPaddingL  = textAlignment === 'left'  ? '140px' : '120px';
  const textPaddingR  = '120px';

  // Animation timing based on style
  const springConfig =
    animStyle === 'energetic'    ? '{ damping: 60, stiffness: 280, mass: 0.8 }' :
    animStyle === 'technical'    ? '{ damping: 120, stiffness: 180, mass: 1 }'  :
    animStyle === 'storytelling' ? '{ damping: 200, stiffness: 80, mass: 1.2 }' :
                                   '{ damping: 100, stiffness: 150, mass: 1 }';  // elegant
  const staggerFrames = animStyle === 'energetic' ? 10 : animStyle === 'storytelling' ? 30 : 20;
  const fadeIn  = animStyle === 'energetic' ? 12 : 20;
  const fadeOut = animStyle === 'energetic' ? 12 : 18;

  return `You are a senior Remotion animation engineer and motion graphics director.
Create a COMPLETE, BROADCAST-QUALITY React JSX animation for this narration.
Every frame must look like a premium tech-documentary or explainer video.

══════════════════════════════════════════════════
NARRATION — Section ${sectionIndex + 1} of ${totalSections}
══════════════════════════════════════════════════
"${sectionText}"

${curriculumContext}Mode         : ${(generationContext.mode || 'detailed').toUpperCase()}
Language     : ${generationContext.language || 'en-IN'}

Scene title  : "${titleText_js}"
Duration     : ${durationInFrames} frames at ${FPS}fps = ${durationSec}s
Canvas       : 1920 × 1080 px
Accent colors: ${color1} (primary)  ${color2} (secondary)
Anim style   : ${animStyle.toUpperCase()}

════════════════════════════════════════════════════════════════
🎬  SCENE TYPE — ASSIGNED BY AI DIRECTOR (MANDATORY)
════════════════════════════════════════════════════════════════
  TYPE ${type} — ${typeName}

SPECIFIC SVG INSTRUCTIONS FROM THE DIRECTOR:
  ${svgScaffold}

⛔  ABSOLUTE PROHIBITION — TEXT-ONLY SCENES:
  • The visual zone MUST have ≥4 animated SVG drawing primitives:
    <circle>, <rect>, <path>, <line>, <polygon>, or <ellipse>
  • A scene with zero SVG geometry is instantly rejected and regenerated
  • A title <text> label does NOT count as a visual — it needs geometric shapes too
════════════════════════════════════════════════════════════════

${iconPromptSection}

════════════════════════════════════════════════════════════════
📐  LAYOUT SYSTEM — SAFE ZONES & PADDING
════════════════════════════════════════════════════════════════
Canvas is 1920×1080. NOTHING may appear outside the inner safe area:
  - Left / Right : 80 px inset  → safe x range  80 → 1840
  - Top          : 60 px inset  → safe y starts  60
  - Bottom       : 60 px inset  → safe y ends  1020

TWO NON-OVERLAPPING LAYOUT ZONES:

  ╔══════════════════════════════════════════════════╗ y=60 (safe top)
  ║  VISUAL ZONE                                     ║
  ║  position:'absolute', top:0, height:'62%'        ║
  ║  Inner padding: 60px top, 80px left/right        ║
  ║  → SVG viewBox="0 0 1760 548"  (1920-2×80=1760)  ║
  ║  Place diagram center ~x=880, ~y=274             ║
  ╠══════════════════════════════════════════════════╣ y=670
  ║  TEXT ZONE                                       ║
  ║  position:'absolute', bottom:0, height:'38%'     ║
  ║  Inner padding: 0 top, ${textPaddingL} left, ${textPaddingR} right, 60px bottom ║
  ║  Text box max-width: 1620px                      ║
  ╚══════════════════════════════════════════════════╝ y=1080

IMPLEMENT IT EXACTLY LIKE THIS:
  <AbsoluteFill style={{ background:'linear-gradient(160deg,#0a0a0f 0%,#0e0e28 100%)' }}>

    {/* ── VISUAL ZONE ── */}
    <div style={{
      position:'absolute', top:0, left:0, width:'100%', height:'62%',
      display:'flex', alignItems:'center', justifyContent:'center',
      padding:'60px 80px 0 80px', boxSizing:'border-box'
    }}>
      <svg viewBox="0 0 1760 548" width="1760" height="548" style={{overflow:'visible'}}>
        {/* YOUR TYPE ${type} SVG CONTENT */}
      </svg>
    </div>

    {/* ── TEXT ZONE ── */}
    <div style={{
      position:'absolute', bottom:0, left:0, width:'100%', height:'38%',
      display:'flex', flexDirection:'column',
      alignItems:${flexJustify}, justifyContent:'center',
      padding:'0 ${textPaddingR} 60px ${textPaddingL}', boxSizing:'border-box', gap:14
    }}>
      {/* text phases via <Sequence> here */}
    </div>

  </AbsoluteFill>

COPY THESE EXACT STYLE OBJECTS — DO NOT MODIFY THEM:

Visual zone div style (COPY VERBATIM):
  position:'absolute', top:0, left:0, width:'100%', height:'62%',
  display:'flex', alignItems:'center', justifyContent:'center',
  padding:'60px 80px 0 80px', boxSizing:'border-box'

Text zone div style (COPY VERBATIM):
  position:'absolute', bottom:0, left:0, width:'100%', height:'38%',
  display:'flex', flexDirection:'column',
  alignItems:${flexJustify}, justifyContent:'center',
  padding:'0 ${textPaddingR} 60px ${textPaddingL}', boxSizing:'border-box', gap:14

SVG attributes (COPY VERBATIM):
  viewBox="0 0 1760 548" width="1760" height="548" style={{overflow:'visible'}}

COMMON MISTAKES THAT BREAK THE LAYOUT (EVERY ONE OF THESE IS BANNED):

  ❌ WRONG — full-canvas centered text (padding is ignored, text lands at y=540):
     <AbsoluteFill style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
       <div style={{fontSize:'48px'}}>Caption text</div>
     </AbsoluteFill>

  ❌ WRONG — text div with position:'absolute' and top: some arbitrary number:
     <div style={{position:'absolute', top:'68%', left:'10%'}}>Caption</div>

  ❌ WRONG — SVG with height="1080" that spans the full canvas and overlaps the text zone:
     <svg height="1080" viewBox="0 0 1920 1080">...</svg>

  ❌ WRONG — extra div wrapper that resets the padding:
     <div style={{padding:0}}> ...your text zone content... </div>

  ✅ CORRECT — text always lives inside the text-zone div with the verbatim styles above:
     <div style={{ position:'absolute', bottom:0, left:0, width:'100%', height:'38%',
                   display:'flex', flexDirection:'column', alignItems:${flexJustify},
                   justifyContent:'center', padding:'0 ${textPaddingR} 60px ${textPaddingL}',
                   boxSizing:'border-box', gap:14 }}>
       <Sequence from={0} durationInFrames={${phaseFrames}}>
         <div style={{color:'#fff', fontSize:'48px', fontWeight:700, textAlign:'${cssTextAlign}',
                      maxWidth:'1620px', lineHeight:1.5, fontFamily:'system-ui'}}>
           Phase 1 caption
         </div>
       </Sequence>
     </div>

FINAL CHECKLIST before writing your code:
  [ ] Root element is <AbsoluteFill> with dark gradient background
  [ ] Visual zone: position absolute, top:0, height:'62%', padding copied verbatim
  [ ] Text zone: position absolute, bottom:0, height:'38%', padding copied verbatim
  [ ] SVG viewBox is exactly "0 0 1760 548" — no other value
  [ ] No text element outside the text-zone div
  [ ] All caption divs wrapped in <Sequence> tags
  [ ] No AbsoluteFill used directly as text wrapper (only as Sequence child inside the text zone)
════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════
✍️  TEXT ALIGNMENT RULES — TEXT ZONE ONLY
════════════════════════════════════════════════════════════════
This scene uses: ${textAlignment.toUpperCase()} ALIGNMENT

${textAlignment === 'left' ? `LEFT ALIGNMENT — use for lists, steps, multiple items:
  • text-align: 'left'  on all text divs
  • alignItems: 'flex-start'  on the text-zone container
  • Each list item on its own line: use \\n or multiple <div> elements
  • Indent bullet items by adding paddingLeft: 24 on item divs
  • Keep lines short (max 60 chars) — do not wrap a list item across 2 lines
  • Font: 40–46px for main items, 32–36px for sub-items
  EXAMPLE PATTERN for a 3-item list revealed in sequence:
    <Sequence from={0}  durationInFrames={${phaseFrames}}><AbsoluteFill style={{display:'flex',alignItems:'flex-start',justifyContent:'flex-start',padding:'0 ${textPaddingR} 60px ${textPaddingL}',boxSizing:'border-box'}}><div style={{color:'#fff',fontSize:'44px',fontWeight:700,lineHeight:1.6,textAlign:'left',maxWidth:'1620px',fontFamily:'system-ui'}}>Item 1 text here</div></AbsoluteFill></Sequence>` :

textAlignment === 'table' ? `TABLE ALIGNMENT — use for side-by-side comparisons:
  • Use a flexbox row: display:'flex', flexDirection:'row', gap:60
  • Each column is a div with display:'flex', flexDirection:'column', gap:12
  • Column headers: color:'${color1}', fontSize:'36px', fontWeight:700, borderBottom: '2px solid ${color1}'
  • Column items: color:'#e0e7ff', fontSize:'32px', lineHeight:1.5
  • Wrap the table in the text zone with padding on all sides
  • Animate each column sliding in from its side: left col from left, right col from right
  EXAMPLE PATTERN:
    <div style={{display:'flex',flexDirection:'row',gap:80,width:'100%',maxWidth:'1620px'}}>
      <div style={{flex:1,display:'flex',flexDirection:'column',gap:10}}>
        <div style={{color:'${color1}',fontSize:'36px',fontWeight:700}}>Pros</div>
        <div style={{color:'#e0e7ff',fontSize:'32px'}}>• Point 1</div>
      </div>
      <div style={{flex:1,display:'flex',flexDirection:'column',gap:10}}>
        <div style={{color:'${color2}',fontSize:'36px',fontWeight:700}}>Cons</div>
        <div style={{color:'#e0e7ff',fontSize:'32px'}}>• Point 1</div>
      </div>
    </div>` :

`CENTER ALIGNMENT — use for headlines, definitions, short statements:
  • text-align: 'center' on all text divs
  • alignItems: 'center' + justifyContent: 'center' on text-zone container
  • maxWidth: 1620px to prevent lines spanning full 1760px (too wide for eyes to track)
  • Font: 48–56px for headlines, 36–42px for supporting text
  • Each Sequence phase shows one clear, punchy idea (max 15 words)
  EXAMPLE PATTERN:
    <Sequence from={0} durationInFrames={${phaseFrames}}><AbsoluteFill style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'0 120px 60px 120px',boxSizing:'border-box'}}><div style={{color:'#fff',fontSize:'52px',fontWeight:700,textAlign:'center',lineHeight:1.5,maxWidth:'1620px',fontFamily:'system-ui'}}>Main headline text here</div></AbsoluteFill></Sequence>`}
════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════
⚠️  FRAME CORRECTNESS — MANDATORY
════════════════════════════════════════════════════════════════
• Every frame 0 → ${durationInFrames - 1} MUST have visible content
• Scene fade-in:  interpolate(frame, [0, ${fadeIn}], [0, 1], { extrapolateRight:'clamp' })
• Scene fade-out: interpolate(frame, [durationInFrames - ${fadeOut}, durationInFrames], [1, 0], { extrapolateLeft:'clamp', extrapolateRight:'clamp' })
  → ALWAYS use the variable durationInFrames from useVideoConfig(), NEVER a hardcoded number
• ALL interpolate input ranges must use values ≤ ${durationInFrames}
  WRONG: interpolate(frame, [0, 300], ...) when total duration is ${durationInFrames}
  RIGHT: interpolate(frame, [0, ${durationInFrames}], ...)
• spring() delay: frame - N where N must be < ${maxDelay} to avoid the spring never triggering

════════════════════════════════════════════════════════════════
⚠️  TEXT OVERLAP PREVENTION — MANDATORY
════════════════════════════════════════════════════════════════
Use <Sequence> to gate every text phase — Remotion UNMOUNTS children when a Sequence ends,
making overlap physically impossible.

  <Sequence from={0} durationInFrames={${phaseFrames}}>   ← first phase, unmounts at frame ${phaseFrames}
    <AbsoluteFill ...><div>Phase 1 text</div></AbsoluteFill>
  </Sequence>
  <Sequence from={${phaseFrames}} durationInFrames={${phaseFrames}}>  ← second phase, can NEVER overlap first
    <AbsoluteFill ...><div>Phase 2 text</div></AbsoluteFill>
  </Sequence>

• Fade IN  inside each Sequence: interpolate(frame, [0, ${fadeIn}], [0, 1], {extrapolateRight:'clamp'})
• Fade OUT inside each Sequence: interpolate(frame, [durationInFrames - ${fadeOut}, durationInFrames], [1, 0], {extrapolateLeft:'clamp',extrapolateRight:'clamp'})
• NEVER use opacity alone (no Sequence) to hide overlapping text
════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════
🎨  ANIMATION STYLE: ${animStyle.toUpperCase()}
════════════════════════════════════════════════════════════════
${animStyle === 'energetic' ?
  `• Fast, snappy springs: spring({ frame: frame - delay, fps, config: ${springConfig} })
• Short stagger: ${staggerFrames} frames between each element entrance
• SVG elements pop in quickly with slight overshoot (don't clamp spring overshoot)
• Use bold scale-up animations: scale from 0.6→1.0 using spring
• Text slides up 40px while fading in` :
animStyle === 'technical' ?
  `• Precise, mechanical timing: spring({ frame: frame - delay, fps, config: ${springConfig} })
• Drawing animations preferred: animate stroke-dashoffset from strokeLength→0
• Stagger: ${staggerFrames} frames. Elements reveal in strict visual order
• SVG lines draw themselves onscreen. Bars grow from zero with no bounce
• Text fades in cleanly (no translate — it just appears)` :
animStyle === 'storytelling' ?
  `• Slow, cinematic timing: spring({ frame: frame - delay, fps, config: ${springConfig} })
• Elements drift in softly from slight offsets (translateY 30px, fade)
• Stagger: ${staggerFrames} frames. Long, graceful entrances
• Emphasize the primary accent element with a slow glowing pulse animation
• Text wipes in by animating clipPath or translateX from left edge` :
  /* elegant */
  `• Smooth, refined timing: spring({ frame: frame - delay, fps, config: ${springConfig} })
• Stagger: ${staggerFrames} frames. Clean entrance transitions
• A subtle glowing radial gradient pulses behind the main focal element
• Text slides up gently (20px) while fading in over ${fadeIn} frames
• Scene fades out smoothly in the final ${fadeOut} frames`}

spring() returns a PLAIN NUMBER (0–1). No .to() method. No .x or .y properties.
  WRONG: spring({...}).to([0,1], [0, 100])
  CORRECT: interpolate(spring({...}), [0, 1], [0, 100], { extrapolateLeft:'clamp', extrapolateRight:'clamp' })
════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════
🖌️  DESIGN SYSTEM
════════════════════════════════════════════════════════════════
Background     : linear-gradient(160deg, #0a0a0f 0%, #0e0e28 100%)
Primary accent : ${color1}
Secondary accent: ${color2}
Text primary   : #ffffff  weight 700
Text secondary : #e0e7ff  weight 500
Text muted     : #a1a1aa  weight 400
Font family    : 'system-ui, -apple-system, sans-serif'

Glow shadow    : textShadow: '0 0 40px ${color1}88, 0 4px 16px rgba(0,0,0,0.8)'
SVG glow filter: <filter id="glow"><feGaussianBlur stdDeviation="8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>

Rules:
• At least 1 element uses the glow filter or textShadow
• Background always dark (no white/light backgrounds)
• Accent bar or divider line between visual and text zones looks polished (gradient stroke)
• DO NOT import any library other than React and remotion
════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════
⛔  IMPORT RESTRICTIONS — CRITICAL (violations crash the render)
════════════════════════════════════════════════════════════════
You may ONLY import these names from 'remotion':
  useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, AbsoluteFill,
  interpolateColors, Easing, delayRender, continueRender, measureSpring, random, Img

DO NOT import ANY of these — they DO NOT EXIST in Remotion and will crash:
  ❌ interpolateColor  (wrong — correct name is interpolateColors with an 's')
  ❌ useSequenceConfig  (does not exist)
  ❌ useSpring          (this is react-spring, NOT Remotion)
  ❌ animated           (this is react-spring, NOT Remotion)
  ❌ Transition         (does not exist in core Remotion)
  ❌ TransitionSeries   (requires @remotion/transitions, NOT installed)
  ❌ useAnimation       (does not exist)
  ❌ useTiming          (does not exist)
  ❌ config             (this is react-spring's config, NOT Remotion)

If you need color interpolation, import interpolateColors (with 's'):
  import { interpolateColors } from 'remotion';
  const col = interpolateColors(frame, [0, 60], ['#6366f1', '#06b6d4']);
════════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════════
⚠️  HELPER COMPONENT PROPS — CRITICAL (violations crash at runtime)
════════════════════════════════════════════════════════════════
If you create helper components (AnimatedText, TextBlock, Label, etc.):
1. Every variable used inside MUST be either:
   (a) destructured from the component's own props, OR
   (b) declared inside the component, OR
   (c) a module-level const/import
2. The CALLER must pass ALL required props explicitly — do NOT rely on scope closure.
3. For spring() animations inside helpers, ALWAYS pass durationInFrames from the parent:
   WRONG:
     const AnimatedText = ({ text }) => {
       const s = spring({ frame, fps, durationInFrames }); // ❌ durationInFrames is undefined!
     };
     <AnimatedText text="Hello" />

   CORRECT:
     const AnimatedText = ({ text, durationInFrames }) => {
       const s = spring({ frame: useCurrentFrame(), fps: 30, durationInFrames });
     };
     <AnimatedText text="Hello" durationInFrames={durationInFrames} />
4. PREFER using default values: const MyHelper = ({ color = '#fff', index = 0 }) => { ... }
════════════════════════════════════════════════════════════════

MANDATORY IMPORTS (copy exactly):
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, AbsoluteFill } from 'remotion';

COMPONENT:
export const Scene = () => { ... }
export default Scene;
const frame = useCurrentFrame();
const { fps, durationInFrames } = useVideoConfig();

RETURN ONLY THE RAW .jsx FILE.
No markdown fences. No \`\`\`jsx. No explanation. No comments outside the file itself.
First line of response must be: import React from 'react';
`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate Remotion animation code for every section.
 * @param {Array}    sections       - [{heading, script, ...}]
 * @param {number[]} audioDurations - seconds per section (from TTS)
 * @param {string}   videoTopic     - overall topic (passed to AI scene director)
 * @returns {Array} [{sectionIndex, code, durationInFrames}]
 */
async function generateScenesCode(sections, audioDurations, videoTopic = '', generationContext = {}) {
  console.log(`[detailedAgent] generating ${sections.length} scenes in parallel...`);

  /**
   * Generate + review code for a single scene. Returns {sectionIndex, code, durationInFrames}.
   */
  async function generateScene(i) {
    const section = sections[i];
    const audioDur = audioDurations[i] || 5;
    const durationInFrames = Math.ceil(audioDur * FPS) + MIN_BUFFER_FRAMES;

    console.log(`[detailedAgent] scene ${i + 1}/${sections.length} starting | dur=${durationInFrames}f (${(durationInFrames / FPS).toFixed(1)}s)`);

    // Ask the AI Scene Director to analyse this narration before code generation
    const analysisTopic = [
      videoTopic,
      generationContext.curriculumData?.subjectName,
      generationContext.curriculumData?.chapterName,
      generationContext.curriculumData?.topicName,
      generationContext.curriculumData?.subtopicName,
    ]
      .filter(Boolean)
      .join(" | ");
    const analysis = await analyzeSceneWithAI(section.script, i, sections.length, analysisTopic);
    console.log(`[detailedAgent] scene ${i + 1} analysis: type=${analysis.type} align=${analysis.textAlignment} style=${analysis.animationStyle}`);

    // Fetch contextual SVG icons from Iconify based on AI-requested icons
    const iconRequests = analysis.iconRequests || analysis.svgSearchTerms || [];
    const svgIcons = await fetchSvgIcons(iconRequests);

    const iconPromptSection = formatIconsForPrompt(svgIcons);
    const prompt = buildPrompt(section.script, i, durationInFrames, sections.length, analysis, iconPromptSection, generationContext);
    let code = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await callGemini(prompt);
        const extracted = extractCode(raw);
        const repaired = repairCode(extracted, durationInFrames);

        if (isValidCode(repaired)) {
          code = await reviewAndFixCode(repaired, section.script, durationInFrames, i);
          console.log(`[detailedAgent] scene ${i + 1} ready (${code.length} chars)`);
          break;
        } else {
          console.warn(`[detailedAgent] scene ${i + 1} attempt ${attempt + 1}: invalid code structure, retrying`);
        }
      } catch (err) {
        console.warn(`[detailedAgent] scene ${i + 1} attempt ${attempt + 1} error: ${err.message}`);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
      }
    }

    if (!code) {
      console.warn(`[detailedAgent] scene ${i + 1}: main generation failed — trying AI rescue...`);
      code = await generateRescueScene(section.script, durationInFrames, analysis);
    }

    if (!code) {
      console.warn(`[detailedAgent] scene ${i + 1}: rescue also failed — using minimal fallback`);
      code = buildMinimalFallback(section.script, durationInFrames);
    }

    // ── Visual quality check ─────────────────────────────────────────────────
    if (code && !validateSceneHasVisuals(code)) {
      console.warn(`[detailedAgent] scene ${i + 1}: text-only detected — retrying with visual override...`);
      try {
        const overrideRaw = await callGemini(
          await buildVisualOverridePrompt(section.script, i, durationInFrames, sections.length, analysis)
        );
        const overrideExtracted = extractCode(overrideRaw);
        const overrideRepaired = repairCode(overrideExtracted, durationInFrames);
        if (isValidCode(overrideRepaired) && validateSceneHasVisuals(overrideRepaired)) {
          code = await reviewAndFixCode(overrideRepaired, section.script, durationInFrames, i);
          console.log(`[detailedAgent] scene ${i + 1}: visual override succeeded`);
        } else {
          console.warn(`[detailedAgent] scene ${i + 1}: visual override text-only — trying rescue...`);
          const rescueCode = await generateRescueScene(section.script, durationInFrames, analysis);
          if (rescueCode) code = rescueCode;
        }
      } catch (overrideErr) {
        console.warn(`[detailedAgent] scene ${i + 1}: visual override error (${overrideErr.message}) — trying rescue...`);
        const rescueCode = await generateRescueScene(section.script, durationInFrames, analysis);
        if (rescueCode) code = rescueCode;
      }
    }

    return { sectionIndex: i, code, durationInFrames };
  }

  // Launch all scenes simultaneously and wait for all to finish
  const results = await Promise.all(sections.map((_, i) => generateScene(i)));

  // Return in original order (Promise.all preserves order)
  return results;
}

module.exports = { generateScenesCode, FPS };
