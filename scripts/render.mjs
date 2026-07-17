#!/usr/bin/env node
/**
 * Thin wrapper: spec.json path + output .mp4 path -> a real rendered MP4.
 *
 * Usage:
 *   node scripts/render.mjs <spec.json> <output.mp4> <workspaceDir>
 *
 * What it does:
 *   1. Validates the spec.json exists, parses, and checks every referenced
 *      asset (scene assets + narration + bgm) actually exists on disk before
 *      spending any time rendering (per design doc section I: "never renders
 *      a partially-broken video").
 *   2. Shells out to `npx remotion render` inside `remotion/` (resolved from
 *      THIS SCRIPT's own location -- the plugin's code -- since that's
 *      unaffected by where the user's data lives), passing the spec.json
 *      straight through as --props (it doubles as Remotion's inputProps) and
 *      pointing --public-dir at <workspaceDir> so that
 *      `staticFile('assets/x.jpg')`, `staticFile('bgm-library/x.mp3')`, and
 *      `staticFile('output/<slug>/narration.mp3')` all resolve correctly no
 *      matter which of those three directories a given path lives under.
 *
 * <workspaceDir> is a separate argument from this script's own code
 * location on purpose: an installed plugin's code lives in a version-pinned
 * cache directory that gets replaced on every update (see
 * scripts/workspace.mjs), but the user's assets/output must survive
 * updates, so they live in a stable folder the user chose during init.
 *
 * All paths inside spec.json (assetPath, narrationAudioPath, bgmAudioPath)
 * must be relative to <workspaceDir>, e.g. "assets/hop-bao.jpg" or
 * "output/2026-07-17_gia-vang-tang/narration.mp3".
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const codeRoot = path.resolve(__dirname, "..");
const remotionDir = path.join(codeRoot, "remotion");
const compositionId = "MainVideo";

function fail(message) {
  console.error(`[render] ${message}`);
  process.exit(1);
}

const [, , specArgRaw, outputArgRaw, workspaceDirRaw] = process.argv;

if (!specArgRaw || !outputArgRaw || !workspaceDirRaw) {
  fail("Usage: node scripts/render.mjs <spec.json> <output.mp4> <workspaceDir>");
}

const specPath = path.resolve(process.cwd(), specArgRaw);
const outputPath = path.resolve(process.cwd(), outputArgRaw);
const workspaceDir = path.resolve(process.cwd(), workspaceDirRaw);

if (!fs.existsSync(specPath)) {
  fail(`Spec file not found: ${specPath}`);
}

let spec;
try {
  spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
} catch (err) {
  fail(`Failed to parse spec JSON at ${specPath}: ${err.message}`);
}

if (!Array.isArray(spec.scenes) || spec.scenes.length === 0) {
  fail("spec.json has no scenes[] -- nothing to render.");
}

const missing = [];
const checkRelPath = (relPath) => {
  const abs = path.resolve(workspaceDir, relPath);
  if (!fs.existsSync(abs)) missing.push(relPath);
};

for (const scene of spec.scenes) {
  if (!scene.assetPath) {
    fail(`Scene is missing assetPath: ${JSON.stringify(scene)}`);
  }
  checkRelPath(scene.assetPath);
}
if (spec.narrationAudioPath) checkRelPath(spec.narrationAudioPath);
if (spec.bgmAudioPath) checkRelPath(spec.bgmAudioPath);

if (missing.length > 0) {
  console.error("[render] Missing asset file(s) referenced by spec.json (resolved against workspace dir):");
  for (const m of missing) console.error(`  - ${m}`);
  fail("Aborting: fix spec.json or add the missing files before rendering.");
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

// On Windows, `npx` is a shim resolved as `npx.cmd`; spawning the bare
// "npx" without a shell throws ENOENT there. Keep shell:false (safe
// arg-passing for paths with spaces) and just pick the right binary name.
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

const args = [
  "remotion",
  "render",
  "src/index.ts",
  compositionId,
  outputPath,
  `--props=${specPath}`,
  `--public-dir=${workspaceDir}`,
];

console.log(`[render] code root:  ${codeRoot}`);
console.log(`[render] workspace:  ${workspaceDir}`);
console.log(`[render] spec:       ${specPath}`);
console.log(`[render] output:     ${outputPath}`);
console.log(`[render] > ${npxCmd} ${args.join(" ")}`);
console.log(`[render] (cwd: ${remotionDir})`);

const child = spawn(npxCmd, args, {
  cwd: remotionDir,
  stdio: "inherit",
  env: process.env,
});

child.on("error", (err) => {
  fail(`Failed to spawn npx: ${err.message}`);
});

child.on("exit", (code) => {
  if (code === 0) {
    console.log(`[render] done -> ${outputPath}`);
  }
  process.exit(code ?? 1);
});
