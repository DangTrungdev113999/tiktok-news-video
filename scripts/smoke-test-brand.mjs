#!/usr/bin/env node
// scripts/smoke-test-brand.mjs
//
// Proves a brand kit's OWN FILES survive the trip from a folder on disk to
// pixels -- on whatever platform this runs on.
//
// The general smoke test (smoke-test.mjs) never touches $WORKSPACE_DIR/brand/:
// it carries its own inline brand kit. So every brand-folder feature (logo,
// hook background, caption geometry, typeface) had exactly zero automated
// coverage, and the one platform that matters most is the one none of it was
// developed on. The specific Windows hazards this exists to catch:
//
//   - path.join() on Windows yields backslashes. These paths end up in
//     spec.json and are handed to staticFile(), which builds a URL, where a
//     backslash is a literal character rather than a separator. The asset
//     then fails to load SILENTLY -- the video renders, just without it.
//     This exact bug has shipped from this repo twice before.
//   - cancelRender() on a bad font has to actually fail the render process,
//     not merely log. A brand font that quietly falls back produces a video
//     in the wrong typeface with a zero exit code.
//
// Everything is created under a throwaway slug and removed afterwards, so it
// never appears in the real brand picker.
//
// Usage: node scripts/smoke-test-brand.mjs

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getWorkspaceDir } from './workspace.mjs';
import { getBrand } from './brand-kit.mjs';
import { buildSpecToFile } from './build-spec.mjs';
import { binaryPath } from './ffmpeg-path.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const codeRoot = path.resolve(__dirname, '..');
const remotionDir = path.join(codeRoot, 'remotion');
const cliEntry = path.join(remotionDir, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');

const SLUG = '_ci-brand-smoke';
const WS = getWorkspaceDir();
const brandDir = path.join(WS, 'brand', SLUG);
const assetDir = path.join(WS, 'assets', SLUG);
const outDir = path.join(WS, 'output', SLUG);

/** A caption position far below TikTok's safe zone -- build-spec must clamp it. */
const OUT_OF_ZONE_BOTTOM_INSET = 40;
const CLAMPED_BOTTOM_INSET = 291;

const log = (m) => console.log(`[brand-smoke] ${m}`);
function fail(m) {
  console.error(`[brand-smoke] FAIL -- ${m}`);
  cleanup();
  process.exit(1);
}

/**
 * A real font file from the host OS. Not bundled: shipping a typeface in this
 * repo would be a licensing decision, and any font with a Latin alphabet
 * proves the loading path equally well.
 */
function findSystemFont() {
  const candidates = [
    'C:\\Windows\\Fonts\\arialbd.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial Black.ttf',
    '/System/Library/Fonts/Supplemental/Georgia Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function cleanup() {
  for (const dir of [brandDir, assetDir, outDir]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeBrandFolder(fontSource) {
  fs.mkdirSync(brandDir, { recursive: true });
  fs.writeFileSync(
    path.join(brandDir, 'brand.json'),
    JSON.stringify(
      {
        displayName: 'CI Brand Smoke',
        badgeLabel: 'CI Brand Smoke',
        badgeGradient: ['#5B8DEF', '#3B5BDB', '#1E3A8A'],
        badgeShadow: 'rgba(20,40,120,0.42)',
        headlineShadow: ['#2B4BC4', '#22409E', '#1A3480'],
        headlineStroke: 'rgba(10,25,80,0.35)',
        caption: { fontSize: 46, bottomInset: OUT_OF_ZONE_BOTTOM_INSET },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(brandDir, 'logo.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="34" fill="none" stroke="#1E3A8A" stroke-width="12"/>
</svg>\n`,
  );
  fs.writeFileSync(
    path.join(brandDir, 'hook-bg.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#EAF1FF"/><stop offset="100%" stop-color="#3B5BDB"/>
  </linearGradient></defs>
  <rect width="1080" height="1920" fill="url(#g)"/>
</svg>\n`,
  );
  if (fontSource) fs.copyFileSync(fontSource, path.join(brandDir, 'font.ttf'));
}

/** One flat-colour frame, so the render has something to put on screen. */
function writeAsset() {
  fs.mkdirSync(assetDir, { recursive: true });
  const file = path.join(assetDir, 'anh_1.png');
  const r = spawnSync(
    binaryPath('ffmpeg'),
    ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=1080x1920', '-frames:v', '1', file],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) fail(`could not create a test asset with ffmpeg: ${r.stderr || r.error}`);
  return file;
}

function renderStill(specPath, outPath) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [cliEntry, 'still', 'src/index.ts', 'MainVideo', outPath, `--props=${specPath}`, `--public-dir=${WS}`, '--frame=2'],
      { cwd: remotionDir, stdio: 'pipe' },
    );
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

// ---------------------------------------------------------------------------

if (!fs.existsSync(cliEntry)) {
  console.error(`[brand-smoke] Remotion is not installed in ${remotionDir}. Run the init skill first.`);
  process.exit(1);
}

cleanup();
const fontSource = findSystemFont();
if (fontSource) log(`font under test: ${fontSource}`);
else log('NOTE: no system font found -- the typeface assertions are SKIPPED on this machine.');

writeBrandFolder(fontSource);
writeAsset();
fs.mkdirSync(outDir, { recursive: true });

// --- 1. The brand folder resolves, and its paths are URL-shaped ------------
const brandKit = await getBrand(SLUG, WS);
for (const field of ['logoPath', 'hookBgPath', ...(fontSource ? ['fontPath'] : [])]) {
  if (!brandKit[field]) fail(`getBrand did not resolve ${field}`);
  // The load-bearing assertion on Windows. A backslash here does not throw;
  // it produces a URL that quietly 404s and an asset that never appears.
  if (String(brandKit[field]).includes('\\')) {
    fail(`${field} contains a backslash (staticFile builds a URL): ${brandKit[field]}`);
  }
}
log(`resolved: logo=${brandKit.logoPath} bg=${brandKit.hookBgPath} font=${brandKit.fontPath}`);

// --- 2. An out-of-zone caption is clamped, and says so --------------------
const specPath = path.join(outDir, 'spec.json');
const spec = await buildSpecToFile(
  {
    scenes: [
      { assetFilename: `${SLUG}/anh_1.png`, startSec: 0, endSec: 2, isHook: true, hookHeadline: 'Khung hook thử.' },
      {
        assetFilename: `${SLUG}/anh_1.png`,
        startSec: 2,
        endSec: 4,
        words: [
          { text: 'MỘT', startSec: 2, endSec: 2.6 },
          { text: 'HAI', startSec: 2.6, endSec: 3.2 },
        ],
      },
    ],
    workspaceDir: WS,
    brandKit,
  },
  specPath,
);

if (spec.brandKit.caption?.bottomInset !== CLAMPED_BOTTOM_INSET) {
  fail(`caption.bottomInset should have been clamped to ${CLAMPED_BOTTOM_INSET}, got ${spec.brandKit.caption?.bottomInset}`);
}
if (!(spec.warnings ?? []).some((w) => w.includes('caption.bottomInset'))) {
  fail('the clamp happened without a warning -- a silent clamp is the bug this guards against');
}
log(`clamped ${OUT_OF_ZONE_BOTTOM_INSET} -> ${CLAMPED_BOTTOM_INSET}, with a warning`);

// --- 3. It renders ---------------------------------------------------------
const stillPath = path.join(outDir, 'still.png');
const ok = await renderStill(specPath, stillPath);
if (ok.code !== 0) fail(`the render failed (exit ${ok.code}):\n${ok.stderr}`);
if (!fs.existsSync(stillPath)) fail('the render reported success but wrote no file');
const bytes = fs.statSync(stillPath).size;
if (bytes < 10_000) fail(`the still is only ${bytes} bytes -- it is unlikely to contain a rendered frame`);
log(`rendered a still from the brand's own files (${Math.round(bytes / 1024)} KB)`);

// --- 4. A broken font FAILS the render, it does not fall back -------------
if (fontSource) {
  fs.writeFileSync(path.join(brandDir, 'font.ttf'), 'this is not a font');
  const broken = await renderStill(specPath, path.join(outDir, 'broken.png'));
  if (broken.code === 0) {
    fail('a corrupt brand font rendered successfully -- the video would ship in the wrong typeface');
  }
  if (!broken.stderr.includes('brand font')) {
    fail(`the render failed, but not with the brand-font message:\n${broken.stderr}`);
  }
  log('a corrupt font stops the render instead of silently falling back');
}

cleanup();
log('PASS -- a brand kit\'s logo, background, caption geometry and typeface all survive to pixels.');
