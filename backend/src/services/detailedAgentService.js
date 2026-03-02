/**
 * detailedAgentService.js
 *
 * AI agent that generates Remotion JSX animation code for each video section.
 * Uses Gemini 2.5 Pro to write complete, self-contained React components that
 * visually match the narration with precision.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { env } = require("../config/env");

const FPS = 30;
const MIN_BUFFER_FRAMES = 15; // 0.5s visual buffer after audio ends

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
 * Repair common AI code mistakes that cause blank frames:
 *  1. Frame numbers in interpolate() exceed durationInFrames → scale them down.
 *  2. Sequence durationInFrames exceeds remaining frames → clamp it.
 *  3. spring() delay offsets larger than duration → clamp them.
 */
function repairCode(code, durationInFrames) {
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

// ─── Fallback scene ───────────────────────────────────────────────────────────

function buildFallbackCode(sectionText, durationInFrames) {
  const safeText = sectionText.replace(/`/g, "'").replace(/\\/g, "\\\\").slice(0, 250);
  // Split into 3 phases — each in its own Sequence so text can never overlap
  const phase = Math.floor(durationInFrames / 3);
  const p1 = phase;
  const p2 = phase;
  const p3 = durationInFrames - p1 - p2;
  // First ~60 chars, middle ~60, rest
  const t1 = safeText.slice(0, 80);
  const t2 = safeText.slice(80, 180) || t1;
  const t3 = safeText.slice(180) || t2;

  return `import React from 'react';
import { useCurrentFrame, interpolate, AbsoluteFill, useVideoConfig, Sequence } from 'remotion';

// Reusable phase text with automatic fade-in/out — NO overlap possible because each
// phase lives inside its own <Sequence> which unmounts when it ends.
const PhaseText = ({ text, color = '#ffffff' }) => {
  const frame = useCurrentFrame();
  const { durationInFrames: dur } = useVideoConfig();
  const opacity =
    interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' }) *
    interpolate(frame, [dur - 18, dur], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const slideY = interpolate(frame, [0, 25], [40, 0], { extrapolateRight: 'clamp' });
  return (
    <div style={{ opacity, transform: \`translateY(\${slideY}px)\`, color, fontSize: '52px', fontWeight: 700, textAlign: 'center', lineHeight: 1.5, maxWidth: '1480px', fontFamily: 'system-ui,-apple-system,sans-serif', textShadow: '0 4px 24px rgba(99,102,241,0.35)', padding: '0 80px' }}>
      {text}
    </div>
  );
};

export const Scene = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Whole-scene fade in/out wrapper
  const sceneOpacity =
    interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' }) *
    interpolate(frame, [durationInFrames - 15, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Accent bar grows across the screen
  const barW = interpolate(frame, [10, Math.min(90, durationInFrames - 10)], [0, 1400], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: 'linear-gradient(160deg, #0a0a0f 0%, #0f0f2e 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: sceneOpacity }}>
      {/* Persistent accent bar */}
      <div style={{ position: 'absolute', top: '38%', left: '50%', transform: 'translateX(-50%)', width: barW, height: 5, background: 'linear-gradient(90deg,#6366f1,#06b6d4)', borderRadius: 99 }} />

      {/* Phase 1 text — unmounts at frame ${p1}, guaranteed gone before Phase 2 */}
      <Sequence from={0} durationInFrames={${p1}}>
        <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PhaseText text={\`${t1}\`} />
        </AbsoluteFill>
      </Sequence>

      {/* Phase 2 text — starts at frame ${p1}, cannot overlap Phase 1 */}
      <Sequence from={${p1}} durationInFrames={${p2}}>
        <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PhaseText text={\`${t2}\`} color="#e0e7ff" />
        </AbsoluteFill>
      </Sequence>

      {/* Phase 3 text — starts at frame ${p1 + p2} */}
      <Sequence from={${p1 + p2}} durationInFrames={${p3}}>
        <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PhaseText text={\`${t3}\`} color="#a5f3fc" />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

export default Scene;
`;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(sectionText, sectionIndex, durationInFrames, totalSections) {
  const durationSec = (durationInFrames / FPS).toFixed(1);
  // Split duration into equal phase slots for multi-phase animations
  const phaseFrames = Math.floor(durationInFrames / 3);

  return `You are a Remotion (React video framework) animation engineer.
Write a COMPLETE, SELF-CONTAINED React JSX file that visually explains this narration in exactly ${durationSec} seconds.

═══════════════════════════════════════════════
NARRATION (Section ${sectionIndex + 1}/${totalSections}):
"${sectionText}"
═══════════════════════════════════════════════

MANDATORY IMPORTS (copy exactly):
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, AbsoluteFill } from 'remotion';

COMPONENT CONTRACT:
- Named export: export const Scene = () => { ... }
- Also add: export default Scene;
- const frame = useCurrentFrame(); const { fps, durationInFrames } = useVideoConfig();
- Total duration: ${durationInFrames} frames at ${FPS}fps (${durationSec}s)
- Canvas: 1920 × 1080 pixels

════════════════════════════════════════════════════════
⚠️  MANDATORY LAYOUT — TWO ZONES, STRICT SEPARATION
════════════════════════════════════════════════════════
The 1920×1080 canvas has TWO non-overlapping zones. ALL elements MUST stay in their zone.

  ┌────────────────────────────────────────────────┐  y = 0
  │  VISUAL ZONE — diagrams, SVG, charts, shapes   │
  │  height ≈ 620 px  (top 57% of canvas)          │
  │  Place visual center-point around  y ≈ 310 px  │
  ├────────────────────────────────────────────────┤  y = 640
  │  TEXT ZONE — all narration text and captions   │
  │  height ≈ 400 px  (bottom 37% of canvas)       │
  │  Center text around  y ≈ 880 px                │
  └────────────────────────────────────────────────┘  y = 1080

HOW TO IMPLEMENT (COPY THIS EXACT PATTERN — do NOT deviate):

  <AbsoluteFill style={{ background: '#0a0a0f' }}>

    {/* ── VISUAL ZONE: top 62% of canvas ── */}
    <div style={{ position:'absolute', top:0, left:0, width:'100%', height:'62%',
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
      {/* ← your SVG / diagram / chart / animated shapes go here */}
    </div>

    {/* ── TEXT ZONE: bottom 38% of canvas ── */}
    <div style={{ position:'absolute', bottom:0, left:0, width:'100%', height:'38%',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  flexDirection:'column', gap:16, padding:'0 80px' }}>
      {/* ← ALL text, captions, narration labels go here — use <Sequence> for phases */}
    </div>

  </AbsoluteFill>

RULES:
- SVG diagrams: use height="620" OR place inside the visual-zone div above.
- ALL text captions: must live inside the text-zone div, NEVER in a full-canvas flex center.
- NEVER place a text div inside a full-canvas AbsoluteFill with display:'flex', alignItems:'center' —
  that puts text at y=540 which is squarely inside the visual zone — causing overlap.
- SVG <text> atom labels inside the visual-zone SVG are acceptable IF they stay above y=620.
  But do NOT add floating caption divs over the full canvas.
- A persistent title can sit at the top edge (y≈50) inside the visual zone.
════════════════════════════════════════════════════════

════════════════════════════════════════
⚠️  NO BLANK FRAMES — THIS IS MANDATORY
════════════════════════════════════════
Every single frame from 0 to ${durationInFrames - 1} MUST show visible content.
- ALL interpolate calls MUST use frame numbers between 0 and ${durationInFrames}.
  NEVER use a frame number above ${durationInFrames}.
  WRONG: interpolate(frame, [0, 300], ...) when total is ${durationInFrames}
  RIGHT: interpolate(frame, [0, ${durationInFrames}], ...)
- Scene-fade-out MUST use durationInFrames from useVideoConfig(), NOT a hardcoded number.
  CORRECT: interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], { extrapolateLeft:'clamp', extrapolateRight:'clamp' })
- DO NOT apply any opacity=0 to the root container at the start — the scene must be
  visible from frame 0.

════════════════════════════════════════════════════════
⚠️  CRITICAL RULE — TEXT OVERLAP PREVENTION (READ CAREFULLY)
════════════════════════════════════════════════════════

OLD TEXT MUST FULLY DISAPPEAR BEFORE NEW TEXT APPEARS.
This is the #1 rendering bug. Follow these rules without exception:

RULE 1 — USE <Sequence> FOR EVERY DISTINCT TEXT PHASE.
  Remotion's <Sequence> UNMOUNTS its children when it ends — making overlap PHYSICALLY IMPOSSIBLE.
  CORRECT pattern for text that changes:

    <Sequence from={0} durationInFrames={${phaseFrames}}>
      <div style={{ opacity: ... }}>First text</div>
    </Sequence>
    <Sequence from={${phaseFrames}} durationInFrames={${phaseFrames}}>
      <div style={{ opacity: ... }}>Second text (never overlaps first)</div>
    </Sequence>

RULE 2 — NEVER use opacity alone to hide text if another text appears later.
  opacity:0 keeps the element in the DOM — it can still visually bleed through on some frames.
  ALWAYS use <Sequence> to gate visibility by time.

RULE 3 — FADE TIMING inside each Sequence:
  - Fade IN:  interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' })
             (frame here is the LOCAL frame inside the Sequence — useCurrentFrame() inside a Sequence returns local frame)
  - Fade OUT: interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  - The 18-frame fade-out GUARANTEES text is gone before the next Sequence starts.

RULE 4 — Background and structural elements (SVG diagrams, background gradient, title) do NOT need Sequence.
  Only text labels and captions that CHANGE need Sequence isolation.

EXAMPLE of a 3-phase scene (adapt to your specific content):
  Phase A (frames 0–${phaseFrames}): show first concept text
  Phase B (frames ${phaseFrames}–${phaseFrames * 2}): show second concept text
  Phase C (frames ${phaseFrames * 2}–${durationInFrames}): show summary / final label
  Each phase wrapped in its own <Sequence from={start} durationInFrames={length}>.
════════════════════════════════════════════════════════

ANIMATION RULES:
1. Clamp ALL interpolations: { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
2. Global scene fade-in: opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' })
3. Global scene fade-out: multiply by interpolate(frame, [durationInFrames - 15, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
   IMPORTANT: use the variable durationInFrames from useVideoConfig(), never a hardcoded number.
4. spring config: spring({ frame: frame - delay, fps, config: { damping: 80, stiffness: 200, mass: 1 } })
   IMPORTANT: delay must be less than ${Math.max(0, durationInFrames - 20)} — do NOT use large delays that push spring past the clip end.
   CRITICAL: Remotion's spring() returns a PLAIN NUMBER (0 to 1). It has NO .to() method.
   WRONG: spring({...}).to([0,1], [0, 100])   ← this is react-spring API, NOT Remotion!
   RIGHT: interpolate(spring({...}), [0,1], [0, 100], { extrapolateLeft:'clamp', extrapolateRight:'clamp' })
   If you need to map the 0-1 spring output to another range, use interpolate() around it.
5. Stagger visual elements by 10-20 frames each (keep it short for brief clips)

DESIGN SYSTEM:
- Background: #0a0a0f or a dark gradient
- Primary text: #ffffff, weight 700, system-ui font
- Accent colors: #6366f1 (indigo), #06b6d4 (cyan), #10b981 (emerald), #f59e0b (amber), #ef4444 (red)
- Subtitle / body text: #a1a1aa
- Add a glowing drop-shadow on key elements

CHOOSE THE RIGHT VISUAL TYPE for this narration:

TYPE A — MOLECULAR / ATOMIC STRUCTURE
  Use when: chemistry, biology, atoms, molecules, bonds, DNA, cells
  HOW: SVG <circle> atoms, <line> bonds, <text> labels. Animate stroke-dashoffset for bonds.
  LAYOUT: Put the SVG inside the VISUAL ZONE div (top 62%). SVG viewBox="0 0 1920 620".
  Text caption/narration goes in the TEXT ZONE div (bottom 38%). NO overlap possible.

TYPE B — DATA CHART (plain SVG — no external libraries)
  Use when: statistics, numbers, percentages, comparisons, growth
  HOW: Use plain SVG <rect> for bars, <line> for axes. Compute positions with simple math.
  Animate bar height from 0 using interpolate. DO NOT import d3 or any external library.
  LAYOUT: Chart SVG in the VISUAL ZONE (top 62%). Axis labels inside the SVG are fine.
  Explanatory text / title in the TEXT ZONE (bottom 38%).

TYPE C — PROCESS FLOWCHART
  Use when: steps, pipeline, stages, how something works
  HOW: SVG <rect>+<text> boxes connected by <line> arrows. Stagger each box in.
  LAYOUT: Flowchart SVG in the VISUAL ZONE (top 62%). Caption in TEXT ZONE (bottom 38%).

TYPE D — TIMELINE
  Use when: history, events in order, dates, progression
  HOW: Extending horizontal SVG line, event nodes pop up above/below in sequence.

TYPE E — CONCEPT TEXT REVEAL (DEFAULT — use this if unsure)
  Use when: definitions, vocabulary, explanations, anything else
  HOW: Large bold headline centered, supporting phrases slide up from below in phases.
  Use geometric SVG accents (circles, lines, hexagons) as decoration.

TYPE F — COMPARISON
  Use when: two things, pros/cons, before/after, A vs B
  HOW: Two SVG panels side by side with a glow divider. Each panel in its own Sequence.

TYPE G — PHYSICS / VECTOR
  Use when: forces, motion, waves, electricity
  HOW: SVG arrows, sine wave paths animated with interpolate.

ALWAYS include:
- A persistent title at the top of the VISUAL ZONE (NOT a full-canvas centered title)
- Visual content that covers EVERY frame — no gaps
- The two-zone layout pattern above — visual div on top, text div on bottom
- At least 3 distinct animated elements
- DO NOT import any library other than React and remotion

RETURN ONLY THE COMPLETE .jsx FILE CONTENT.
No markdown code fences. No \`\`\`jsx. No explanation text. No comments outside the file.
Begin your response with: import React from 'react';
`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate Remotion animation code for every section.
 * @param {Array} sections  - [{heading, script, ...}]
 * @param {number[]} audioDurations - seconds per section (from TTS)
 * @returns {Array} [{sectionIndex, code, durationInFrames}]
 */
async function generateScenesCode(sections, audioDurations) {
  console.log(`[detailedAgent] generating ${sections.length} scenes in parallel...`);

  /**
   * Generate + review code for a single scene. Returns {sectionIndex, code, durationInFrames}.
   */
  async function generateScene(i) {
    const section = sections[i];
    const audioDur = audioDurations[i] || 5;
    const durationInFrames = Math.ceil(audioDur * FPS) + MIN_BUFFER_FRAMES;

    console.log(`[detailedAgent] scene ${i + 1}/${sections.length} starting | dur=${durationInFrames}f (${(durationInFrames / FPS).toFixed(1)}s)`);

    const prompt = buildPrompt(section.script, i, durationInFrames, sections.length);
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
      console.warn(`[detailedAgent] scene ${i + 1}: using fallback text scene`);
      code = buildFallbackCode(section.script, durationInFrames);
    }

    return { sectionIndex: i, code, durationInFrames };
  }

  // Launch all scenes simultaneously and wait for all to finish
  const results = await Promise.all(sections.map((_, i) => generateScene(i)));

  // Return in original order (Promise.all preserves order)
  return results;
}

module.exports = { generateScenesCode, FPS };
