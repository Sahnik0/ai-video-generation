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
const { renderMedia, selectComposition } = require("@remotion/renderer");
const ffmpegStatic = require("ffmpeg-static");
const { spawn } = require("child_process");
const esbuild = require("esbuild");

const REMOTION_DIR = path.resolve(__dirname, "../../remotion");
const SCENES_DIR = path.join(REMOTION_DIR, "src", "scenes");
const ROOT_FILE = path.join(REMOTION_DIR, "src", "Root.jsx");
const ENTRY_POINT = path.join(REMOTION_DIR, "src", "index.jsx");
const FPS = 30;

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

  for (const { sectionIndex, code, durationInFrames } of sceneDataArray) {
    const inner = `_SceneInner${sectionIndex}`;
    const cls = `_EB${sectionIndex}`;
    const exported = `Scene${sectionIndex}`;

    // ── 1. Separate import lines from body ──────────────────────────────────
    const lines = code.split("\n");
    const importLines = [];
    const bodyLines = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^import\s+/.test(trimmed)) {
        // Deduplicate: don't add the same import twice
        if (!importLines.some((l) => l.trim() === trimmed)) {
          importLines.push(line);
        }
      } else {
        bodyLines.push(line);
      }
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

    // ── 3. const/let Scene → var Scene (var allows re-declaration) ──────────
    body = body.replace(/\b(const|let)\s+Scene\b/g, "var Scene");

    // ── 4. function Scene( → var Scene = function( ─────────────────────────
    body = body.replace(/\bfunction\s+Scene\s*\(/g, "var Scene = function(");

    // ── 5. Wrap in IIFE ─────────────────────────────────────────────────────
    const wrappedCode = `${importLines.join("\n")}

// ── AI scene code (wrapped in IIFE for scope isolation) ─────────────────────
const ${inner} = (() => {
${body}
  return typeof Scene !== 'undefined' ? Scene : () => React.createElement('div', { style: { width:'100%', height:'100%', background:'#0a0a0f', display:'flex', alignItems:'center', justifyContent:'center' } }, React.createElement('div', { style: { color:'#fff', fontSize:48, fontFamily:'system-ui' } }, 'Scene ${sectionIndex}'));
})();

// ── Error boundary (DO NOT EDIT) ────────────────────────────────────────────
class ${cls} extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: String(e && e.message ? e.message : e) }; }
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
      loader: "jsx",
      jsx: "automatic",
      target: "es2020",
    });
    return null; // valid
  } catch (err) {
    // Extract just the first error message (esbuild provides rich detail)
    const firstLine = (err.message || String(err)).split("\n")[0];
    return firstLine.slice(0, 300);
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
 * Replace a failed scene with a simple fallback so the bundle doesn't crash.
 */
async function replaceWithFallback(sectionIndex, sectionText, durationInFrames) {
  const safeText = (sectionText || "").replace(/`/g, "'").replace(/\\/g, "\\\\").slice(0, 250);

  const fallback = `import React from 'react';
import { useCurrentFrame, interpolate, AbsoluteFill, useVideoConfig } from 'remotion';

export const Scene${sectionIndex} = () => {
  const frame = useCurrentFrame();
  const { durationInFrames: dur } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, 25], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [dur - 20, dur], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = fadeIn * fadeOut;
  const slideY = interpolate(frame, [0, 30], [50, 0], { extrapolateRight: 'clamp' });
  const barW = interpolate(frame, [10, Math.min(90, dur - 10)], [0, 1200], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: 'linear-gradient(135deg,#0a0a0f,#1a1a2e)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '100px' }}>
      <div style={{ position: 'absolute', width: barW, height: 6, background: 'linear-gradient(90deg,#6366f1,#06b6d4)', borderRadius: 99, top: '42%', opacity }} />
      <div style={{ opacity, transform: \`translateY(\${slideY}px)\`, color: '#fff', fontSize: '58px', fontWeight: 700, textAlign: 'center', lineHeight: 1.5, maxWidth: '1480px', fontFamily: 'system-ui,-apple-system,sans-serif' }}>
        ${"`"}${safeText}${"`"}
      </div>
    </AbsoluteFill>
  );
};
export default Scene${sectionIndex};
`;

  await fs.writeFile(path.join(SCENES_DIR, `Scene${sectionIndex}.jsx`), fallback, "utf8");
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

    // ── Render each clip ────────────────────────────────────────────────────
    const muxedClipPaths = [];

    for (const { sectionIndex, durationInFrames } of sceneDataArray) {
      const clipId = `Scene${sectionIndex}`;
      const clipVideoPath = path.join(tempDir, `detailed_clip${sectionIndex}_video.mp4`);
      const clipMergedPath = path.join(tempDir, `detailed_clip${sectionIndex}_merged.mp4`);

      console.log(`[remotion] rendering clip ${sectionIndex + 1}/${sceneDataArray.length}: ${clipId} (${durationInFrames}f)`);

      let renderSuccess = false;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const composition = await selectComposition({
            serveUrl: bundlePath,
            id: clipId,
            inputProps: {},
          });

          await renderMedia({
            composition,
            serveUrl: bundlePath,
            codec: "h264",
            outputLocation: clipVideoPath,
            inputProps: {},
            muted: true, // audio added by FFmpeg below
            concurrency: 4,
            logLevel: "warn",
            timeoutInMilliseconds: 600000, // 10 min per clip
            overwrite: true,
          });

          renderSuccess = true;
          break;
        } catch (renderErr) {
          console.warn(`[remotion] clip ${sectionIndex} attempt ${attempt + 1} render failed: ${renderErr.message}`);
          if (attempt === 0) {
            // Replace with fallback scene and re-bundle only this scene
            console.log(`[remotion] swapping scene ${sectionIndex} for fallback and re-bundling`);
            await replaceWithFallback(sectionIndex, sectionScripts[sectionIndex], durationInFrames);
            await writeRootJsx(sceneDataArray); // update Root.jsx (unchanged, just re-write)
            // Re-bundle with fallback
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
