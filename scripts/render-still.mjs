#!/usr/bin/env node
// scripts/render-still.mjs
//
// Render ONE frame to a PNG. This is the fast loop behind SKILL.md's "verify
// by pixels, not by preview" rule -- checking a caption position or a hook
// card costs a second here instead of a full encode.
//
// It exists as a script because the reference file used to hand the agent a
// POSIX shell one-liner:
//
//     cd $CODE_ROOT/remotion && npx remotion still ... --props=<spec> \
//       --public-dir=$WORKSPACE_DIR --frame=<n>
//
// Three things in those two lines break on Windows: `$VAR` expansion (cmd
// wants %VAR%, PowerShell wants $env:VAR), `&&` chaining (not valid in cmd),
// and the trailing `\` continuation (PowerShell uses a backtick). An agent
// copying it verbatim -- which is the entire point of a reference file --
// fails, and the mandatory pixel check quietly stops happening.
//
//   node scripts/render-still.mjs <spec.json> <out.png> <workspaceDir> <frame>

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const codeRoot = path.resolve(__dirname, "..");
const remotionDir = path.join(codeRoot, "remotion");

function fail(msg) {
  console.error(`[still] ${msg}`);
  process.exit(1);
}

const [specArg, outArg, workspaceArg, frameArg] = process.argv.slice(2);
if (!specArg || !outArg || !workspaceArg || frameArg === undefined) {
  fail("Usage: node scripts/render-still.mjs <spec.json> <out.png> <workspaceDir> <frame>");
}

const specPath = path.resolve(specArg);
const outputPath = path.resolve(outArg);
const workspaceDir = path.resolve(workspaceArg);
const frame = Number(frameArg);

if (!fs.existsSync(specPath)) fail(`spec not found: ${specPath}`);
if (!fs.existsSync(workspaceDir)) fail(`workspace dir not found: ${workspaceDir}`);
if (!Number.isInteger(frame) || frame < 0) fail(`frame must be a non-negative integer, got "${frameArg}"`);

// Same reasoning as render.mjs: spawn Node on the CLI entry rather than `npx`.
// On Windows `npx.cmd` needs a shell, and a shell mangles paths containing
// spaces. See render.mjs for the full explanation.
const cliEntry = path.join(remotionDir, "node_modules", "@remotion", "cli", "remotion-cli.js");
if (!fs.existsSync(cliEntry)) {
  fail(
    `Remotion is not installed in ${remotionDir}.\n` +
    `  Run the init skill (tiktok-news-video-init) first. Answer "N" when it asks whether\n` +
    `  to reconfigure -- your saved key, voice and pace are kept.`
  );
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const args = [
  cliEntry,
  "still",
  "src/index.ts",
  "MainVideo",
  outputPath,
  `--props=${specPath}`,
  `--public-dir=${workspaceDir}`,
  `--frame=${frame}`,
];

console.log(`[still] frame ${frame} -> ${outputPath}`);

const child = spawn(process.execPath, args, { cwd: remotionDir, stdio: "inherit", env: process.env });
child.on("error", (err) => fail(`Failed to spawn the Remotion CLI: ${err.message}`));
child.on("exit", (code) => {
  if (code === 0) console.log(`[still] done -> ${outputPath}`);
  else fail(`Remotion exited with code ${code}`);
});
