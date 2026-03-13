/**
 * remotionService.js
 *
 * Handles bundling AI-generated Remotion components and rendering video clips.
 * Each clip is rendered muted (video only) and then muxed with Sarvam TTS audio via FFmpeg.
 * All clips are finally concatenated into one MP4.
 */

"use strict";

const path = require("path");
const fs = require("fs/promises");
const { existsSync } = require("fs");
const { bundle } = require("@remotion/bundler");
const { renderMedia, selectComposition, renderStill } = require("@remotion/renderer");
const ffmpegStatic = require("ffmpeg-static");
const { spawn } = require("child_process");
const esbuild = require("esbuild");
const os = require("os");

const REMOTION_DIR = path.resolve(__dirname, "../../remotion");
const SCENES_DIR = path.join(REMOTION_DIR, "src", "scenes");
const ROOT_FILE = path.join(REMOTION_DIR, "src", "Root.jsx");
const ENTRY_POINT = path.join(REMOTION_DIR, "src", "index.jsx");
const FPS = 30;

// Gemini Flash for rescue scene generation (lightweight, fast)
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { env } = require("../config/env");

// ─── Remotion API whitelist ────────────────────────────────────────────────────
// Fast check to strip hallucinated import names that would crash at runtime.

const REMOTION_VALID = new Set([
  'AbsoluteFill', 'Audio', 'Composition', 'Easing', 'Folder', 'Freeze',
  'IFrame', 'Img', 'Loop', 'OffthreadVideo', 'Sequence', 'Series', 'Still',
  'Video', 'cancelRender', 'continueRender', 'delayRender', 'getInputProps',
  'getRemotionEnvironment', 'getStaticFiles', 'interpolate', 'interpolateColors',
  'measureSpring', 'prefetch', 'random', 'registerRoot', 'spring', 'staticFile',
  'useBufferState', 'useCurrentFrame', 'useCurrentScale', 'useDelayRender',
  'useRemotionEnvironment', 'useVideoConfig', 'watchStaticFile',
]);

const REMOTION_FIX = { 'interpolateColor': 'interpolateColors', 'interpolateColour': 'interpolateColors' };

/**
 * Quick sanitization of remotion imports — strips hallucinated names, fixes typos.
 * This is a safety net for code that didn't go through detailedAgentService.repairCode().
 */
function sanitizeRemotionImports(code) {
  // Fix hallucinated subpath imports: 'remotion/easing', 'remotion/spring' → 'remotion'
  code = code.replace(/from\s+['"]remotion\/[a-zA-Z-]+['"]/g, "from 'remotion'");

  return code.replace(
    /^(import\s+\{)([^}]+)(\}\s+from\s+['"]remotion['"];?)$/m,
    (full, pre, names, post) => {
      const cleaned = names.split(',')
        .map(n => n.trim())
        .filter(Boolean)
        .map(n => {
          const base = n.split(/\s+as\s+/)[0].trim();
          if (REMOTION_VALID.has(base)) return n;
          if (base in REMOTION_FIX) {
            // Fix body usages too
            code = code.replace(new RegExp(`\\b${base}\\b`, 'g'), REMOTION_FIX[base]);
            return REMOTION_FIX[base];
          }
          // Strip unknown — also neuter its usages in the body
          code = code.replace(
            new RegExp(`(const|let|var)\\s+(\\w+)\\s*=\\s*${base}\\s*\\([^)]*\\)`, 'g'),
            '$1 $2 = {}'
          );
          code = code.replace(new RegExp(`\\b${base}\\s*\\(`, 'g'), '(0 && (');
          console.warn(`[remotion] stripped hallucinated import: ${base}`);
          return null;
        })
        .filter(Boolean);

      if (cleaned.length === 0) {
        return 'import { useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, AbsoluteFill } from \'remotion\';';
      }
      return `import { ${cleaned.join(', ')} } from 'remotion';`;
    }
  );
}

// ─── Simple async mutex ────────────────────────────────────────────────────────
// Remotion bundling modifies shared files, so only one detailed render at a time.

let lockQueue = [];
let isLocked = false;

function acquireRenderLock() {
  return new Promise((resolve) => {
    if (!isLocked) {
      isLocked = true;
      resolve();
    } else {
      console.log("[remotion] waiting for render lock...");
      lockQueue.push(resolve);
    }
  });
}

function releaseRenderLock() {
  if (lockQueue.length > 0) {
    const next = lockQueue.shift();
    next();
  } else {
    isLocked = false;
  }
}

// ─── FFmpeg helpers ────────────────────────────────────────────────────────────

function runFfmpegCmd(args, label = "ffmpeg") {
  return new Promise((resolve, reject) => {
    console.log(`[remotion/${label}] ${[ffmpegStatic, ...args].join(" ")}`);
    const proc = spawn(ffmpegStatic, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`[remotion/${label}] exit ${code}\n${stderr.slice(-1000)}`));
    });
  });
}

/**
 * Mux a muted video clip with an audio file.
 * The output duration is capped to the video duration.
 */
async function muxVideoWithAudio(videoPath, audioPath, outputPath) {
  await runFfmpegCmd(
    [
      "-y",
      "-i", videoPath,
      "-i", audioPath,
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "320k",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-shortest",
      outputPath,
    ],
    "mux"
  );
}

/**
 * Concatenate an array of MP4 clips into a single output file.
 */
async function concatClips(clipPaths, outputPath, tempDir) {
  if (clipPaths.length === 1) {
    // No need to concat a single file
    await fs.copyFile(clipPaths[0], outputPath);
    return;
  }

  const listFile = path.join(tempDir, "concat_detailed.txt");
  const content = clipPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n");
  await fs.writeFile(listFile, content, "utf8");

  await runFfmpegCmd(
    [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-c", "copy",
      outputPath,
    ],
    "concat"
  );
}

// ─── Scene file writers ────────────────────────────────────────────────────────

/**
 * Safely transform AI-generated code into a bundleable scene file.
 *
 * Instead of trying to regex-rename every possible "Scene" declaration pattern
 * (which keeps failing because the AI generates invalid / unexpected JS), we:
 *
 *  1  Extract all `import` statements and hoist them to the top (ESM requires
 *     imports at module level).
 *  2  Strip every `export` keyword from the remaining body code.
 *  3  Convert `const Scene` / `let Scene` → `var Scene` so that duplicate
 *     declarations (common AI mistake) become valid `var` re-declarations.
 *  4  Convert `function Scene(` → `var Scene = function(` (same reason).
 *  5  Wrap the entire body in an IIFE that returns `Scene`.  This scopes ALL
 *     helper components and variables inside the closure — zero name collisions.
 *  6  Assign the IIFE result to `const _SceneInner${i}`.
 *  7  Append an error-boundary class that exports as `Scene${i}`.
 */
async function writeSceneFiles(sceneDataArray, sectionScripts) {
  await fs.mkdir(SCENES_DIR, { recursive: true });

  for (const { sectionIndex, code: rawCode, durationInFrames } of sceneDataArray) {
    const inner = `_SceneInner${sectionIndex}`;
    const cls = `_EB${sectionIndex}`;
    const exported = `Scene${sectionIndex}`;

    // Sanitize remotion imports first (strip hallucinated API names)
    const code = sanitizeRemotionImports(rawCode);

    // ── 1. Separate import lines from body ──────────────────────────────────
    // Uses a stateful parser to handle multi-line imports that the AI sometimes
    // generates (e.g. import {\n  X,\n  Y\n} from 'remotion'). A naive line-by-
    // line check would hoist only the first line, leaving an unclosed import
    // that causes esbuild to error with "Expected 'as'".
    const lines = code.split("\n");
    const importLines = [];
    const bodyLines = [];
    let pendingImport = '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (pendingImport) {
        // Continue collecting a multi-line import
        pendingImport += ' ' + trimmed;
        // Complete when we see `from '...'` / `from "..."` or a bare semicolon
        if (/from\s+['"]/.test(trimmed) || /;\s*$/.test(trimmed)) {
          const normalized = pendingImport.replace(/\s+/g, ' ').trim();
          if (!importLines.some((l) => l === normalized)) {
            importLines.push(normalized);
          }
          pendingImport = '';
        }
        continue;
      }

      if (/^import\s+/.test(trimmed)) {
        // Check if import is complete on this single line
        if (/from\s+['"]/.test(trimmed) || /^import\s+['"]/.test(trimmed)) {
          // Single-line complete import (normal case + side-effect imports)
          if (!importLines.some((l) => l === trimmed)) {
            importLines.push(trimmed);
          }
        } else {
          // Multi-line import starting (e.g. "import {")
          pendingImport = trimmed;
        }
      } else {
        bodyLines.push(line);
      }
    }

    // Safety: push any dangling incomplete import
    if (pendingImport) {
      importLines.push(pendingImport);
    }

    // Make sure React is always imported (error boundary needs it)
    if (!importLines.some((l) => /import\s+React/.test(l))) {
      importLines.unshift("import React from 'react';");
    }

    let body = bodyLines.join("\n");

    // ── 2. Strip every export keyword ───────────────────────────────────────
    body = body.replace(/export\s+default\s+/g, "");
    body = body.replace(/export\s*\{[^}]*\}\s*;?/g, "");
    body = body.replace(/\bexport\s+(?=(?:const|let|var|function|class)\s)/g, "");

    // ── 2.5 Normalize Scene{N} → Scene ──────────────────────────────────────
    // AI fix / rescue code may name the component Scene0, Scene1 etc.
    // The IIFE expects bare `Scene`, so normalize before wrapping.
    body = body.replace(new RegExp(`\\bScene${sectionIndex}\\b`, 'g'), 'Scene');

    // ── 3. const/let Scene → var Scene (var allows re-declaration) ──────────
    body = body.replace(/\b(const|let)\s+Scene\b/g, "var Scene");

    // ── 4. function Scene( → var Scene = function( ─────────────────────────
    body = body.replace(/\bfunction\s+Scene\s*\(/g, "var Scene = function(");

    // ── 5. Wrap in IIFE with try/catch for module-level error capture ───────
    const wrappedCode = `${importLines.join("\n")}

// ── AI scene code (wrapped in IIFE for scope isolation) ─────────────────────
let ${inner};
try {
  ${inner} = (() => {
${body}
    return typeof Scene !== 'undefined' ? Scene : () => React.createElement('div', { style: { width:'100%', height:'100%', background:'#0a0a0f', display:'flex', alignItems:'center', justifyContent:'center' } }, React.createElement('div', { style: { color:'#fff', fontSize:48, fontFamily:'system-ui' } }, 'Scene ${sectionIndex}'));
  })();
} catch (_moduleErr) {
  console.error('[Scene${sectionIndex} MODULE_ERROR] ' + (_moduleErr && _moduleErr.message ? _moduleErr.message : String(_moduleErr)));
  ${inner} = () => React.createElement('div', { style: { width:'100%', height:'100%', background:'#0a0a0f', display:'flex', alignItems:'center', justifyContent:'center', padding:80 } }, React.createElement('div', { style:{ color:'#ef4444', fontSize:36, fontFamily:'system-ui', textAlign:'center', lineHeight:1.5 } }, 'Module error: ' + (_moduleErr && _moduleErr.message ? _moduleErr.message : String(_moduleErr)).slice(0, 120)));
}

// ── Error boundary with runtime error logging (DO NOT EDIT) ─────────────────
class ${cls} extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: String(e && e.message ? e.message : e) }; }
  componentDidCatch(e) { console.error('[Scene${sectionIndex} RENDER_ERROR] ' + (e && e.message ? e.message : String(e))); }
  render() {
    if (this.state.err) {
      return React.createElement(
        'div',
        { style: { width:'100%', height:'100%', background:'#0a0a0f', display:'flex', alignItems:'center', justifyContent:'center', padding:80 } },
        React.createElement('div', { style:{ color:'#ef4444', fontSize:36, fontFamily:'system-ui', textAlign:'center', lineHeight:1.5 } },
          'Scene error: ' + this.state.err.slice(0, 120)
        )
      );
    }
    return React.createElement(${inner}, this.props);
  }
}
export const ${exported} = ${cls};
export default ${cls};
`;

    await fs.writeFile(
      path.join(SCENES_DIR, `Scene${sectionIndex}.jsx`),
      wrappedCode,
      "utf8"
    );

    // ── 6. Pre-validate with esbuild transform ─────────────────────────────
    // If the AI wrote syntactically invalid JSX, esbuild transform will catch
    // it here BEFORE we try to bundle everything (which would crash all scenes).
    const scenePath = path.join(SCENES_DIR, `Scene${sectionIndex}.jsx`);
    const syntaxError = await validateJsx(scenePath);
    if (syntaxError) {
      console.warn(`[remotion] scene ${sectionIndex} has syntax error: ${syntaxError}`);
      console.warn(`[remotion] replacing scene ${sectionIndex} with fallback`);
      const fallbackText = (sectionScripts && sectionScripts[sectionIndex]) || `Scene ${sectionIndex}`;
      await replaceWithFallback(sectionIndex, fallbackText, durationInFrames || 150);
    }
  }
}

/**
 * Pre-validate a JSX file with esbuild's transform API.
 * Returns null if valid, or an error message string if invalid.
 * This catches syntax errors (mismatched braces, bad JSX, etc.) BEFORE
 * the full bundle step — preventing one bad scene from crashing all scenes.
 */
async function validateJsx(filePath) {
  try {
    const source = await fs.readFile(filePath, "utf8");
    await esbuild.transform(source, {
      loader: "tsx",
      jsx: "automatic",
      target: "es2020",
    });
    return null; // valid
  } catch (err) {
    // Show first 3 lines of the error for debugging (line 1 is generic, line 2+ has actual detail)
    const errLines = (err.message || String(err)).split("\n").slice(0, 3).join(" | ");
    return errLines.slice(0, 500);
  }
}

/**
 * Generate Root.jsx with one Composition per section.
 * Each composition uses the corresponding Scene component.
 */
async function writeRootJsx(sceneDataArray) {
  const importLines = sceneDataArray
    .map(({ sectionIndex }) => `import { Scene${sectionIndex} } from './scenes/Scene${sectionIndex}';`)
    .join("\n");

  const compositionLines = sceneDataArray
    .map(
      ({ sectionIndex, durationInFrames }) => `
    <Composition
      id="Scene${sectionIndex}"
      component={Scene${sectionIndex}}
      durationInFrames={${durationInFrames}}
      fps={${FPS}}
      width={1920}
      height={1080}
    />`
    )
    .join("\n");

  const rootContent = `// Auto-generated by remotionService.js — DO NOT EDIT
import React from 'react';
import { Composition } from 'remotion';
${importLines}

export const RemotionRoot = () => (
  <>
    ${compositionLines}
  </>
);
`;

  await fs.writeFile(ROOT_FILE, rootContent, "utf8");
}

/**
 * Replace a failed scene by trying AI rescue first, then falling back to
 * a truly minimal text-only scene as the nuclear option.
 */
async function replaceWithFallback(sectionIndex, sectionText, durationInFrames) {
  // Try AI rescue first — ask Flash for a simple contextual scene
  try {
    const rescueCode = await generateRescueFallback(sectionIndex, sectionText, durationInFrames);
    if (rescueCode) {
      const scenePath = path.join(SCENES_DIR, `Scene${sectionIndex}.jsx`);
      await fs.writeFile(scenePath, rescueCode, "utf8");
      // Validate rescue code too — AI rescue can also produce broken syntax
      const rescueError = await validateJsx(scenePath);
      if (rescueError) {
        console.warn(`[remotion] scene ${sectionIndex} rescue also has syntax error: ${rescueError}`);
        // Fall through to nuclear fallback below
      } else {
        console.log(`[remotion] scene ${sectionIndex} replaced with AI rescue`);
        return;
      }
    }
  } catch (err) {
    console.warn(`[remotion] scene ${sectionIndex} AI rescue failed: ${err.message}`);
  }

  // Nuclear fallback — just text on dark gradient, zero syntax risk
  const safeText = (sectionText || "").replace(/`/g, "'").replace(/\\/g, "\\\\").slice(0, 200);
  const phase = Math.floor(durationInFrames / 3);
  const p1 = phase;
  const p2 = phase;
  const p3 = Math.max(1, durationInFrames - p1 - p2);
  const t1 = safeText.slice(0, 70);
  const t2 = safeText.slice(70, 150) || t1;
  const t3 = safeText.slice(150) || t2;

  const fallback = `import React from 'react';
import { useCurrentFrame, interpolate, AbsoluteFill, useVideoConfig, Sequence } from 'remotion';

export const Scene${sectionIndex} = () => {
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
                          maxWidth: '1620px', fontFamily: 'system-ui',
                          opacity: interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' }) }}>
              {\`${t1}\`}
            </div>
          </AbsoluteFill>
        </Sequence>
        <Sequence from={${p1}} durationInFrames={${p2}}>
          <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 120px 60px 120px', boxSizing: 'border-box' }}>
            <div style={{ color: '#e0e7ff', fontSize: '44px', fontWeight: 700, textAlign: 'center', lineHeight: 1.55,
                          maxWidth: '1620px', fontFamily: 'system-ui',
                          opacity: interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' }) }}>
              {\`${t2}\`}
            </div>
          </AbsoluteFill>
        </Sequence>
        <Sequence from={${p1 + p2}} durationInFrames={${p3}}>
          <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 120px 60px 120px', boxSizing: 'border-box' }}>
            <div style={{ color: '#a5f3fc', fontSize: '44px', fontWeight: 700, textAlign: 'center', lineHeight: 1.55,
                          maxWidth: '1620px', fontFamily: 'system-ui',
                          opacity: interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' }) }}>
              {\`${t3}\`}
            </div>
          </AbsoluteFill>
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};
export default Scene${sectionIndex};
`;

  await fs.writeFile(path.join(SCENES_DIR, `Scene${sectionIndex}.jsx`), fallback, "utf8");
  console.log(`[remotion] scene ${sectionIndex} replaced with minimal fallback`);
}

/**
 * Ask Gemini Flash to generate a rescue scene — simpler prompt, more reliable output.
 * Returns valid JSX code string or null.
 */
async function generateRescueFallback(sectionIndex, sectionText, durationInFrames) {
  const genAI = new GoogleGenerativeAI(env.geminiApiKey);
  const model = genAI.getGenerativeModel(
    { model: "gemini-2.5-flash" },
    { apiVersion: "v1beta" }
  );

  const prompt = `Write a COMPLETE Remotion JSX component file for this narration.
Keep it simple — this is a rescue generation, so reliability is more important than complexity.

NARRATION: "${sectionText.slice(0, 300)}"
DURATION: ${durationInFrames} frames at 30fps
COMPONENT NAME: Scene${sectionIndex} (export const Scene${sectionIndex} and export default Scene${sectionIndex})

STRICT RULES:
1. First line: import React from 'react';
2. Import ONLY: useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, AbsoluteFill from 'remotion'
   DO NOT import: interpolateColor, useSequenceConfig, useSpring, animated, Transition — they don't exist
   If you need color interpolation: import { interpolateColors } from 'remotion' (with an 's')
3. PLAIN JAVASCRIPT ONLY — NO TypeScript. No type annotations, no : number, no interface, no React.FC, no generics <T>
4. Use: const frame = useCurrentFrame(); const { fps, durationInFrames } = useVideoConfig();
4. Background: dark gradient linear-gradient(160deg, #0a0a0f 0%, #0e0e28 100%)
5. TWO zones inside AbsoluteFill:
   - top 62%: position:'absolute', top:0, height:'62%' — SVG with animated shapes RELATED to the narration
   - bottom 38%: position:'absolute', bottom:0, height:'38%' — narration text in Sequence blocks
6. For CSS transforms use STRING CONCAT: 'translateY(' + value + 'px)' — NEVER use backtick template literals inside JSX
7. All interpolate calls need { extrapolateRight: 'clamp' }
8. SVG shapes must visually represent the narration content — no random generic shapes
9. Under 80 lines total. Simple but contextual.

Return ONLY raw JSX. No markdown fences. No explanation.`;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { thinkingConfig: { thinkingBudget: 5000 } },
  });

  let code = result.response.text()
    .replace(/^```(?:jsx?|tsx?|javascript|typescript)?\s*\n?/im, "")
    .replace(/\n?```\s*$/im, "")
    .trim();

  const idx = code.indexOf("import ");
  if (idx > 0) code = code.slice(idx);

  // Sanitize hallucinated remotion imports
  code = sanitizeRemotionImports(code);

  // Basic validation
  if (code.includes("from 'remotion'") && code.includes("export") && code.includes(`Scene${sectionIndex}`)) {
    return code;
  }
  return null;
}

// ─── Scene Compiler: Pre-render Validation ─────────────────────────────────────

/**
 * AI-powered scene code fixer.
 * Sends the original code + detected runtime errors to Gemini Flash,
 * which returns a corrected version of the component.
 */
async function aiFixSceneCode(sectionIndex, originalCode, errors, durationInFrames, sectionScript) {
  const errorSummary = errors.map(e => `• ${e}`).join('\n');

  const prompt = `Fix this Remotion JSX scene component that has runtime errors.

COMPONENT NAME: Scene (use bare "Scene" — the build pipeline renames it)
DURATION: ${durationInFrames} frames at 30fps
NARRATION CONTEXT: "${(sectionScript || '').slice(0, 250)}"

CURRENT CODE:
\`\`\`jsx
${originalCode}
\`\`\`

RUNTIME ERRORS DETECTED DURING TEST RENDER:
${errorSummary}

FIX REQUIREMENTS:
1. Fix ALL the runtime errors while preserving the scene's visual intent
2. Make sure ALL variables are defined before use (common: color, fontFamily, duration, items, data, colors, sizes)
3. All spring() calls must have valid numeric durationInFrames (never undefined/Infinity)
4. interpolate() rules — THIS IS THE #1 MOST COMMON ERROR:
   a. inputRange MUST be a plain numeric array literal, e.g. [0, 30, 60] — NEVER pass a variable or expression
   b. inputRange values must be monotonically increasing (each value > previous)
   c. outputRange must be the same length as inputRange
   d. The first argument (frame value) must always be a number
   e. Always add { extrapolateRight: 'clamp' } as the last argument
   f. WRONG: interpolate(frame, range, [...])  CORRECT: interpolate(frame, [0, 30, 60], [0, 1, 1], { extrapolateRight: 'clamp' })
5. Helper components must receive ALL required props when called
6. For CSS transforms use string concatenation: 'translateY(' + value + 'px)' — NEVER template literals inside JSX style
7. PLAIN JAVASCRIPT ONLY — no TypeScript annotations, no : number, no interface, no React.FC
8. Use: const frame = useCurrentFrame(); const { fps, durationInFrames } = useVideoConfig();
9. SVG values that use interpolate() must be clamped to valid ranges:
   - circle radius: Math.max(0, interpolate(...)) — never negative
   - opacity: clamp between 0 and 1
   - strokeWidth: Math.max(0, ...)
10. Define ALL colors as string constants at the top of the component, e.g.: const primaryColor = '#3B82F6';

IMPORT RULES:
- First line: import React from 'react';
- Import ONLY from 'react' and 'remotion'
- Valid remotion exports: useCurrentFrame, useVideoConfig, interpolate, interpolateColors, spring, Sequence, AbsoluteFill, Easing, Img, Loop, Series, Freeze, Video, Audio, staticFile
- DO NOT import: interpolateColor, useSequenceConfig, useSpring, animated, Transition, motion
- If you need color interpolation: interpolateColors (with an 's')

EXPORT: export const Scene and export default Scene
(Do NOT append a number to Scene — the build pipeline handles indexing.)

Return ONLY the fixed JSX code. No markdown fences. No explanation.`;

  const genAI = new GoogleGenerativeAI(env.geminiApiKey);
  const model = genAI.getGenerativeModel(
    { model: "gemini-2.5-flash" },
    { apiVersion: "v1beta" }
  );

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { thinkingConfig: { thinkingBudget: 10000 } },
  });

  let code = result.response.text()
    .replace(/^```(?:jsx?|tsx?|javascript|typescript)?\s*\n?/im, "")
    .replace(/\n?```\s*$/im, "")
    .trim();

  const startIdx = code.indexOf("import ");
  if (startIdx > 0) code = code.slice(startIdx);

  code = sanitizeRemotionImports(code);

  if (code.includes("from 'remotion'") && (code.includes('Scene') || code.includes(`Scene${sectionIndex}`))) {
    return code;
  }
  return null;
}

/**
 * Pre-render Scene Compiler / Validator.
 *
 * After bundling all scenes, this function renders 2 test frames per scene
 * using renderStill(). Console errors from the browser (MODULE_ERROR,
 * RENDER_ERROR, ReferenceError, TypeError, etc.) are captured via
 * onBrowserLog. Failed scenes are sent to AI for fixing, re-written,
 * re-bundled, and re-validated — up to MAX_FIX_ROUNDS times.
 *
 * Returns the (possibly updated) bundle path.
 */
async function preValidateScenes(bundlePath, sceneDataArray, sectionScripts, tempDir) {
  const MAX_FIX_ROUNDS = 2;
  let currentBundle = bundlePath;
  let scenesToCheck = sceneDataArray.map(s => s.sectionIndex);

  console.log(`[compiler] ── Pre-render validation: ${scenesToCheck.length} scene(s) ──`);

  for (let round = 0; round < MAX_FIX_ROUNDS; round++) {
    const failures = [];

    for (const idx of scenesToCheck) {
      const sceneData = sceneDataArray.find(s => s.sectionIndex === idx);
      if (!sceneData) continue;

      const errors = [];
      const clipId = `Scene${idx}`;

      try {
        const composition = await selectComposition({
          serveUrl: currentBundle,
          id: clipId,
          inputProps: {},
        });

        // Test at 2 frames: start and midpoint (exercises interpolation ranges)
        const midFrame = Math.min(
          Math.floor(sceneData.durationInFrames / 2),
          sceneData.durationInFrames - 1
        );
        const testFrames = [0, midFrame];

        for (const frame of testFrames) {
          const testOutput = path.join(
            tempDir || os.tmpdir(),
            `_validate_s${idx}_f${frame}.jpeg`
          );

          try {
            await renderStill({
              composition,
              serveUrl: currentBundle,
              output: testOutput,
              frame,
              imageFormat: "jpeg",
              logLevel: "error",
              overwrite: true,
              timeoutInMilliseconds: 15000,
              onBrowserLog: (log) => {
                const text = typeof log.text === "string" ? log.text : String(log.text);
                // SVG attribute browser warnings are cosmetic (e.g. negative radius,
                // bad transform syntax) — they don't crash the component, so skip them.
                const isSvgAttrWarning = /^Error:\s*<\w+>\s+attribute\b/.test(text);

                const isSceneError = !isSvgAttrWarning && (
                  /\bMODULE_ERROR\b|\bRENDER_ERROR\b/.test(text) ||
                  /\b(?:ReferenceError|TypeError|SyntaxError|RangeError)\b/.test(text) ||
                  (log.type === "error" && !/^Warning:/.test(text) && !/React does not recognize/.test(text) && !/^JSHandle@/.test(text))
                );

                if (isSceneError) {
                  errors.push(`[frame ${frame}] ${text.slice(0, 300)}`);
                }
              },
            });
          } finally {
            try { await fs.unlink(testOutput); } catch (_) {}
          }
        }
      } catch (err) {
        // renderStill itself threw — fatal error (module load failure, timeout, etc.)
        errors.push(`[fatal] ${(err.message || String(err)).slice(0, 300)}`);
      }

      // Deduplicate errors (same error can fire at multiple frames)
      const uniqueErrors = [...new Set(errors)];

      if (uniqueErrors.length > 0) {
        console.warn(`[compiler] ❌ Scene ${idx} FAILED (${uniqueErrors.length} error(s)):`);
        uniqueErrors.forEach(e => console.warn(`  ${e}`));
        failures.push({ sectionIndex: idx, errors: uniqueErrors });
      } else {
        console.log(`[compiler] ✅ Scene ${idx} passed`);
      }
    }

    if (failures.length === 0) {
      console.log(`[compiler] ✅ All scenes validated successfully!`);
      return currentBundle;
    }

    // ── Fix failed scenes ───────────────────────────────────────────────────
    console.log(`[compiler] 🔧 Fixing ${failures.length} scene(s) (round ${round + 1}/${MAX_FIX_ROUNDS})...`);
    let anyFixed = false;

    for (const { sectionIndex, errors } of failures) {
      const sceneData = sceneDataArray.find(s => s.sectionIndex === sectionIndex);
      if (!sceneData) continue;

      try {
        const fixedCode = await aiFixSceneCode(
          sectionIndex,
          sceneData.code,
          errors,
          sceneData.durationInFrames,
          sectionScripts[sectionIndex]
        );

        if (fixedCode) {
          // Re-process through full writeSceneFiles pipeline (sanitize → wrap → esbuild check)
          await writeSceneFiles(
            [{ sectionIndex, code: fixedCode, durationInFrames: sceneData.durationInFrames }],
            sectionScripts
          );
          // Update sceneData.code so the NEXT round fixes the already-improved code,
          // not the original broken version (this was a critical bug — round 2 was
          // always re-fixing the same original code and making the same mistakes).
          sceneData.code = fixedCode;
          console.log(`[compiler] Scene ${sectionIndex} rewritten with AI fix`);
          anyFixed = true;
        } else {
          console.warn(`[compiler] AI fix for scene ${sectionIndex} returned empty — using rescue fallback`);
          await replaceWithFallback(sectionIndex, sectionScripts[sectionIndex], sceneData.durationInFrames);
          anyFixed = true;
        }
      } catch (fixErr) {
        console.warn(`[compiler] AI fix for scene ${sectionIndex} threw: ${fixErr.message}`);
        await replaceWithFallback(sectionIndex, sectionScripts[sectionIndex], sceneData.durationInFrames);
        anyFixed = true;
      }
    }

    // ── Re-bundle after fixes ───────────────────────────────────────────────
    if (anyFixed) {
      console.log("[compiler] 📦 Re-bundling after fixes...");
      try { await fs.rm(currentBundle, { recursive: true, force: true }); } catch (_) {}
      currentBundle = await bundle({
        entryPoint: ENTRY_POINT,
        rootDir: REMOTION_DIR,
        enableCaching: false,
        webpackOverride: (config) => config,
      });
      console.log(`[compiler] Re-bundle ready: ${currentBundle}`);
    }

    // Next round: only recheck the scenes we just fixed
    scenesToCheck = failures.map(f => f.sectionIndex);
  }

  // ── Final safety net: replace persistent failures with rescue fallback ─────
  // Do one last validation pass on the scenes that were just fixed (round 2).
  // Any that STILL fail get replaced with nuclear fallback — no broken scenes
  // will ever reach the render loop.
  const finalFailures = [];
  for (const idx of scenesToCheck) {
    const sceneData = sceneDataArray.find(s => s.sectionIndex === idx);
    if (!sceneData) continue;

    const errors = [];
    const clipId = `Scene${idx}`;
    try {
      const composition = await selectComposition({
        serveUrl: currentBundle,
        id: clipId,
        inputProps: {},
      });
      await renderStill({
        composition,
        serveUrl: currentBundle,
        output: path.join(tempDir || os.tmpdir(), `_validate_final_s${idx}.jpeg`),
        frame: 0,
        imageFormat: "jpeg",
        logLevel: "error",
        overwrite: true,
        timeoutInMilliseconds: 15000,
        onBrowserLog: (log) => {
          const text = typeof log.text === "string" ? log.text : String(log.text);
          const isSvgAttrWarning = /^Error:\s*<\w+>\s+attribute\b/.test(text);
          if (!isSvgAttrWarning && (
              /MODULE_ERROR|RENDER_ERROR|ReferenceError|TypeError|SyntaxError|RangeError/.test(text) ||
              (log.type === "error" && !/^Warning:|React does not recognize|^JSHandle@/.test(text)))) {
            errors.push(text.slice(0, 200));
          }
        },
      });
    } catch (err) {
      errors.push((err.message || String(err)).slice(0, 200));
    }
    try { await fs.unlink(path.join(tempDir || os.tmpdir(), `_validate_final_s${idx}.jpeg`)); } catch (_) {}

    if (errors.length > 0) {
      console.warn(`[compiler] Scene ${idx} still broken after all fix rounds — replacing with rescue fallback`);
      finalFailures.push(idx);
      await replaceWithFallback(idx, sectionScripts[idx], sceneData.durationInFrames);
    } else {
      console.log(`[compiler] ✅ Scene ${idx} passed final validation`);
    }
  }

  // Re-bundle one last time if we replaced any scenes
  if (finalFailures.length > 0) {
    console.log(`[compiler] 📦 Final re-bundle after replacing ${finalFailures.length} persistent failure(s)...`);
    try { await fs.rm(currentBundle, { recursive: true, force: true }); } catch (_) {}
    currentBundle = await bundle({
      entryPoint: ENTRY_POINT,
      rootDir: REMOTION_DIR,
      enableCaching: false,
      webpackOverride: (config) => config,
    });
    console.log(`[compiler] ✅ Final bundle ready`);
  } else if (scenesToCheck.length > 0) {
    console.log(`[compiler] ✅ All scenes validated after fix rounds!`);
  }

  return currentBundle;
}

// ─── Main render function ──────────────────────────────────────────────────────

/**
 * Render a "detailed" video from AI-generated Remotion components.
 *
 * @param {object} opts
 * @param {Array}  opts.sceneDataArray    - [{sectionIndex, code, durationInFrames}]
 * @param {string[]} opts.audioFiles      - per-section audio file paths (same order)
 * @param {string[]} opts.sectionScripts  - raw section scripts (for fallback text)
 * @param {string}   opts.outputPath      - final MP4 output path
 * @param {string}   opts.tempDir         - temp directory for intermediate files
 */
async function renderDetailedVideo({ sceneDataArray, audioFiles, sectionScripts, outputPath, tempDir }) {
  await acquireRenderLock();
  let bundlePath = null;

  try {
    console.log("[remotion] writing scene files...");
    await writeSceneFiles(sceneDataArray, sectionScripts);
    await writeRootJsx(sceneDataArray);

    // ── Bundle ──────────────────────────────────────────────────────────────
    console.log("[remotion] bundling (this takes ~30-60s on first run)...");
    bundlePath = await bundle({
      entryPoint: ENTRY_POINT,
      rootDir: REMOTION_DIR,
      enableCaching: false, // always fresh for dynamic code
      webpackOverride: (config) => config,
    });
    console.log(`[remotion] bundle ready: ${bundlePath}`);

    // ── Pre-render scene compiler: validate each scene with test frames ─────
    bundlePath = await preValidateScenes(bundlePath, sceneDataArray, sectionScripts, tempDir);

    // ── Render each clip ────────────────────────────────────────────────────
    const muxedClipPaths = [];

    for (const { sectionIndex, durationInFrames } of sceneDataArray) {
      const clipId = `Scene${sectionIndex}`;
      const clipVideoPath = path.join(tempDir, `detailed_clip${sectionIndex}_video.mp4`);
      const clipMergedPath = path.join(tempDir, `detailed_clip${sectionIndex}_merged.mp4`);

      console.log(`[remotion] rendering clip ${sectionIndex + 1}/${sceneDataArray.length}: ${clipId} (${durationInFrames}f)`);

      let renderSuccess = false;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const chromiumOptions = {
            headless: true,
            args: [
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--disable-dev-shm-usage",
              "--disable-gpu",
              "--disable-extensions",
              "--font-render-hinting=none",
            ],
          };

          const composition = await selectComposition({
            serveUrl: bundlePath,
            id: clipId,
            inputProps: {},
            chromiumOptions,
          });

          await renderMedia({
            composition,
            serveUrl: bundlePath,
            codec: "h264",
            outputLocation: clipVideoPath,
            inputProps: {},
            muted: true, // audio added by FFmpeg below
            concurrency: 2,
            logLevel: "warn",
            timeoutInMilliseconds: 600000, // 10 min per clip
            overwrite: true,
            chromiumOptions,
          });

          renderSuccess = true;
          break;
        } catch (renderErr) {
          const isTransient = /Target closed|Protocol error|EPIPE|crashed/i.test(renderErr.message);
          console.warn(`[remotion] clip ${sectionIndex} attempt ${attempt + 1} render failed: ${renderErr.message.slice(0, 200)}`);

          if (attempt === 0 && isTransient) {
            // Transient browser crash — just retry with lower concurrency, no re-bundle needed
            console.log(`[remotion] transient error, retrying with lower concurrency...`);
            await new Promise((r) => setTimeout(r, 2000));
          } else if (attempt <= 1) {
            // Persistent failure — replace with fallback scene and re-bundle
            console.log(`[remotion] swapping scene ${sectionIndex} for fallback and re-bundling`);
            await replaceWithFallback(sectionIndex, sectionScripts[sectionIndex], durationInFrames);
            await writeRootJsx(sceneDataArray);
            if (bundlePath) {
              try { await fs.rm(bundlePath, { recursive: true, force: true }); } catch (_) {}
            }
            bundlePath = await bundle({
              entryPoint: ENTRY_POINT,
              rootDir: REMOTION_DIR,
              enableCaching: false,
              webpackOverride: (config) => config,
            });
          }
        }
      }

      if (!renderSuccess) {
        throw new Error(`[remotion] failed to render clip ${sectionIndex} after fallback`);
      }

      // ── Mux audio into the clip ──────────────────────────────────────────
      const audioPath = audioFiles[sectionIndex];
      if (audioPath && existsSync(audioPath)) {
        console.log(`[remotion] muxing audio for clip ${sectionIndex}...`);
        await muxVideoWithAudio(clipVideoPath, audioPath, clipMergedPath);
        muxedClipPaths.push(clipMergedPath);
      } else {
        console.warn(`[remotion] no audio for clip ${sectionIndex} — using video-only`);
        muxedClipPaths.push(clipVideoPath);
      }
    }

    // ── Concatenate all clips ────────────────────────────────────────────────
    console.log(`[remotion] concatenating ${muxedClipPaths.length} clips → ${outputPath}`);
    await concatClips(muxedClipPaths, outputPath, tempDir);
    console.log("[remotion] 🎬 detailed video render complete!");

  } finally {
    releaseRenderLock();

    // Clean up bundle dir (can be large)
    if (bundlePath) {
      fs.rm(bundlePath, { recursive: true, force: true }).catch(() => {});
    }

    // Clean up generated scene source files
    try {
      const files = await fs.readdir(SCENES_DIR);
      for (const f of files) {
        await fs.unlink(path.join(SCENES_DIR, f)).catch(() => {});
      }
    } catch (_) {}

    // Restore default Root.jsx placeholder
    const defaultRoot = `// Auto-generated placeholder - overwritten per render
import React from 'react';
import { Composition, AbsoluteFill } from 'remotion';

const Placeholder = () => (
  <AbsoluteFill style={{ background: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ color: '#fff', fontSize: 48, fontFamily: 'system-ui' }}>Ready</div>
  </AbsoluteFill>
);

export const RemotionRoot = () => (
  <>
    <Composition id="Placeholder" component={Placeholder} durationInFrames={90} fps={30} width={1920} height={1080} />
  </>
);
`;
    fs.writeFile(ROOT_FILE, defaultRoot, "utf8").catch(() => {});
  }
}

module.exports = { renderDetailedVideo, FPS };
