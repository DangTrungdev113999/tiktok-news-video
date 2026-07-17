#!/usr/bin/env node
/**
 * End-to-end smoke test (design spec §I): exercises the REAL pipeline path
 * -- probe-asset -> classify -> tts-elevenlabs (mock mode) -> build-spec ->
 * render -- using assets living under `assets/` like a real run would, not
 * hand-placed Remotion fixtures. This is what actually proves the seam
 * between the three independently-built pieces works, not just that each
 * piece works in isolation.
 *
 * Usage: node scripts/smoke-test.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { synthesizeScript } from './tts-elevenlabs.mjs';
import { saveBgm } from './bgm-library.mjs';
import { buildSpecToFile } from './build-spec.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SMOKE_ASSETS_DIR = path.join(REPO_ROOT, 'assets', '_smoke-test');
const SMOKE_OUT_DIR = path.join(REPO_ROOT, 'output', '_smoke-test');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${result.status}`);
  }
}

function ffprobeJson(filePath) {
  const result = spawnSync('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ]);
  if (result.status !== 0) {
    throw new Error(`ffprobe failed on ${filePath}: ${result.stderr.toString()}`);
  }
  return JSON.parse(result.stdout.toString());
}

async function generateFixtures() {
  await mkdir(SMOKE_ASSETS_DIR, { recursive: true });
  const landscape = path.join(SMOKE_ASSETS_DIR, 'landscape.png');
  const portrait = path.join(SMOKE_ASSETS_DIR, 'portrait.png');
  const square = path.join(SMOKE_ASSETS_DIR, 'square.png');
  const clip = path.join(SMOKE_ASSETS_DIR, 'clip.mp4');

  if (!existsSync(landscape)) {
    run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=steelblue:s=1920x1080', '-frames:v', '1', landscape]);
  }
  if (!existsSync(portrait)) {
    run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=indianred:s=1080x1920', '-frames:v', '1', portrait]);
  }
  if (!existsSync(square)) {
    run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=seagreen:s=1080x1080', '-frames:v', '1', square]);
  }
  if (!existsSync(clip)) {
    // 1280x720 (16:9) -- deliberately NOT 9:16, to exercise the
    // contain-blur-pad path for video per classifyAsset's crop-loss check.
    run('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=4',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip,
    ]);
  }
  return {
    landscape: '_smoke-test/landscape.png',
    portrait: '_smoke-test/portrait.png',
    square: '_smoke-test/square.png',
    clip: '_smoke-test/clip.mp4',
  };
}

async function generateBgmFixture() {
  const tmpBgm = path.join(SMOKE_OUT_DIR, '_bgm-source.mp3');
  await mkdir(SMOKE_OUT_DIR, { recursive: true });
  if (!existsSync(tmpBgm)) {
    run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=20', tmpBgm]);
  }
  // Explicit workspaceDir=REPO_ROOT: smoke-test is self-contained and must
  // not depend on (or pollute) the real user-configured workspace.
  const { destPath } = await saveBgm(tmpBgm, '_smoke-test-bgm', REPO_ROOT);
  return path.relative(REPO_ROOT, destPath);
}

async function main() {
  console.log('[smoke-test] Generating synthetic fixtures under assets/_smoke-test/ ...');
  const fixtures = await generateFixtures();

  console.log('[smoke-test] Saving a synthetic BGM track via bgm-library.mjs ...');
  const bgmAudioPath = await generateBgmFixture();

  const scenesInput = [
    { text: 'Cảnh mở đầu, ảnh ngang.', assetFilename: fixtures.landscape },
    { text: 'Cảnh thứ hai, ảnh chân dung, đẩy vào.', assetFilename: fixtures.portrait },
    { text: 'Cảnh thứ ba, ảnh vuông, diagonal.', assetFilename: fixtures.square },
    { text: 'Cảnh thứ tư, ảnh chân dung, kéo ra.', assetFilename: fixtures.portrait },
    { text: 'Cảnh thứ năm, ảnh vuông, xoay nhẹ.', assetFilename: fixtures.square },
    { text: 'Cảnh cuối, video giữ nguyên.', assetFilename: fixtures.clip },
  ];

  console.log('[smoke-test] Synthesizing narration (mock mode -- no live ElevenLabs key needed) ...');
  const narrationOutPath = path.join(SMOKE_OUT_DIR, 'narration.mp3');
  const { timings, mode } = await synthesizeScript(scenesInput, {
    outAudioPath: narrationOutPath,
    mock: true,
  });
  console.log(`[smoke-test] TTS mode: ${mode}, ${timings.length} scene timings derived.`);

  const scenesForSpec = scenesInput.map((s, i) => ({
    assetFilename: s.assetFilename,
    startSec: timings[i].startSec,
    endSec: timings[i].endSec,
  }));

  const specPath = path.join(SMOKE_OUT_DIR, 'spec.json');
  console.log('[smoke-test] Building spec.json via build-spec.mjs (the real integration seam) ...');
  await buildSpecToFile(
    {
      scenes: scenesForSpec,
      workspaceDir: REPO_ROOT,
      narrationAudioPath: path.relative(REPO_ROOT, narrationOutPath),
      bgmAudioPath,
      bgmVolume: 0.25,
    },
    specPath
  );

  const outputMp4 = path.join(SMOKE_OUT_DIR, 'smoke-test.mp4');
  console.log('[smoke-test] Rendering via scripts/render.mjs ...');
  await new Promise((resolve, reject) => {
    const child = spawn('node', ['scripts/render.mjs', specPath, outputMp4, REPO_ROOT], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`render exited ${code}`))));
  });

  console.log('[smoke-test] Verifying output with ffprobe ...');
  const probe = ffprobeJson(outputMp4);
  const videoStream = probe.streams.find((s) => s.codec_type === 'video');
  const duration = Number(probe.format?.duration);

  console.log(`[smoke-test] Output: ${outputMp4}`);
  console.log(`[smoke-test]   resolution: ${videoStream.width}x${videoStream.height}`);
  console.log(`[smoke-test]   fps: ${videoStream.avg_frame_rate}`);
  console.log(`[smoke-test]   duration: ${duration.toFixed(2)}s`);

  if (videoStream.width !== 1080 || videoStream.height !== 1920) {
    throw new Error(`Expected 1080x1920, got ${videoStream.width}x${videoStream.height}`);
  }
  if (!(duration > 0)) {
    throw new Error('Rendered file has no measurable duration.');
  }

  console.log('[smoke-test] PASS -- full pipeline (probe -> classify -> TTS -> build-spec -> render) works end-to-end.');
}

main().catch((err) => {
  console.error(`[smoke-test] FAILED: ${err.message}`);
  process.exit(1);
});
