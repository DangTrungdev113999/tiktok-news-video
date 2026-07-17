#!/usr/bin/env node
// scripts/build-spec.mjs
//
// THE INTEGRATION SEAM. Converts the outputs of the independently-built
// pieces (probe-asset.mjs, tts-elevenlabs.mjs / align-audio.mjs) into the
// exact VideoSpec/SceneSpec shape remotion/src/spec-types.ts defines, and
// applies the deterministic classification rules from
// knowledge/effect-catalog.md. This is the one file that must agree with
// all three contracts at once -- see the design spec's integration notes.
//
// Usage (import): import { buildSpec } from './build-spec.mjs'
// Usage (CLI, for manual testing): see scripts/smoke-test.mjs for a full
// worked example wiring probe-asset + tts-elevenlabs + build-spec + render.

import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { probeAsset } from './probe-asset.mjs';

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const DEFAULT_BGM_VOLUME = 0.25;

// Aspect-ratio thresholds from knowledge/effect-catalog.md.
const LANDSCAPE_RATIO = 1.2; // w/h >= this -> landscape
const PORTRAIT_RATIO = 1.2; // h/w >= this -> portrait
const SQUARE_MIN = 0.83; // 0.83 <= w/h < 1.2 -> square-ish

// A cover-fit center-crop that would need to discard more than this fraction
// of the image falls back to contain-blur-pad instead (design spec §F:
// "cropping would cut meaningful content"). Images: extreme panoramas only
// (a plain 16:9 photo is normal Ken-Burns material, NOT extreme). Video:
// much stricter -- cropping a talking head's face is unacceptable even at a
// moderate crop, so only near-9:16 clips get cover.
const IMAGE_EXTREME_CROP_FRACTION = 0.75;
const VIDEO_EXTREME_CROP_FRACTION = 0.15;

/**
 * Fraction of the asset's scaled extent that gets cut off by a CSS
 * `object-fit: cover` fit into the target frame ratio. This is the real
 * geometric crop loss (NOT a naive |ratio - target| deviation, which
 * doesn't correspond to any actual visible-content measure and would flag
 * ordinary 16:9 photos as "extreme" when fit into a 9:16 frame just because
 * the target itself is a narrow portrait ratio).
 *
 * Derivation: cover scale = max(frameW/imgW, frameH/imgH). Whichever axis
 * *doesn't* bind is where the overflow (crop) happens.
 * - ratioWH >= targetRatio -> binds on height, crop is horizontal,
 *   crop fraction = 1 - targetRatio/ratioWH.
 * - ratioWH <  targetRatio -> binds on width, crop is vertical,
 *   crop fraction = 1 - ratioWH/targetRatio.
 */
function coverCropFraction(ratioWH, targetRatio) {
  return ratioWH >= targetRatio ? 1 - targetRatio / ratioWH : 1 - ratioWH / targetRatio;
}

/**
 * Decide effect + direction + fit for one scene's asset, per
 * knowledge/effect-catalog.md. Pure function of (probe result, scene index)
 * -- no randomness, no external state, so classification is reproducible.
 *
 * @param {{type:'image'|'video', width:number, height:number, durationSec?:number}} probe
 * @param {number} sceneIndex - used only to alternate pan direction on
 *   consecutive landscape scenes (per the design spec's "direction
 *   alternates L<->R per scene index for rhythm" -- counted across
 *   landscape scenes specifically, tracked by the caller, not globally).
 * @param {number} landscapeOccurrenceIndex - how many landscape scenes have
 *   been seen so far (including this one), used for the alternation.
 * @returns {{effect:'pan'|'zoom'|'diagonal'|'passthrough', direction?:'left'|'right', fit:'cover'|'contain-blur-pad'}}
 */
export function classifyAsset(probe, landscapeOccurrenceIndex = 0) {
  const { type, width, height } = probe;
  const ratioWH = width / height;

  const targetRatio = WIDTH / HEIGHT;
  const cropFraction = coverCropFraction(ratioWH, targetRatio);

  if (type === 'video') {
    // Always contain-blur-pad unless the clip is already close to 9:16 --
    // cropping a talking head's face is unacceptable even at a moderate
    // crop, so this threshold is deliberately much stricter than images'.
    const fit = cropFraction > VIDEO_EXTREME_CROP_FRACTION ? 'contain-blur-pad' : 'cover';
    return { effect: 'passthrough', fit };
  }

  if (ratioWH >= LANDSCAPE_RATIO) {
    const direction = landscapeOccurrenceIndex % 2 === 0 ? 'left' : 'right';
    // Extreme panoramas would lose too much to a center-crop -> blur-pad.
    // A plain 16:9 photo (cropFraction ~0.68) is normal Ken-Burns material
    // and stays on cover; only genuine panoramas (ratioWH > ~2.25) cross
    // the 0.75 threshold.
    const fit = cropFraction > IMAGE_EXTREME_CROP_FRACTION ? 'contain-blur-pad' : 'cover';
    return { effect: 'pan', direction, fit };
  }

  if (ratioWH <= 1 / PORTRAIT_RATIO) {
    return { effect: 'zoom', fit: 'cover' };
  }

  if (ratioWH >= SQUARE_MIN && ratioWH < LANDSCAPE_RATIO) {
    return { effect: 'diagonal', direction: 'left', fit: 'cover' };
  }

  // Fallback for anything between the square-ish upper bound and the
  // portrait lower bound that the three ranges above didn't already catch
  // (shouldn't normally happen given the thresholds are contiguous, but
  // never silently fall through with no effect assigned).
  return { effect: 'zoom', fit: 'cover' };
}

/**
 * @param {object} args
 * @param {Array<{assetFilename: string, startSec: number, endSec: number}>} args.scenes
 *   One entry per scene, in order. `assetFilename` is relative to `assets/`
 *   (e.g. "hop-bao.jpg"). `startSec`/`endSec` come from tts-elevenlabs.mjs's
 *   or align-audio.mjs's `timings[]` (same shape from both).
 * @param {string} args.repoRoot - absolute path to the repo root.
 * @param {string} [args.narrationAudioPath] - path relative to repoRoot.
 * @param {string} [args.bgmAudioPath] - path relative to repoRoot.
 * @param {number} [args.bgmVolume] - defaults to 0.25 per the house spec.
 * @returns {Promise<import('../remotion/src/spec-types.js').VideoSpec>}
 */
export async function buildSpec({ scenes, repoRoot, narrationAudioPath, bgmAudioPath, bgmVolume }) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error('buildSpec requires a non-empty scenes[] array');
  }

  let landscapeCount = 0;
  const sceneSpecs = [];
  const missingAssets = [];

  for (const scene of scenes) {
    const assetAbsPath = path.resolve(repoRoot, 'assets', scene.assetFilename);
    let probe;
    try {
      probe = await probeAsset(assetAbsPath);
    } catch (err) {
      missingAssets.push(`${scene.assetFilename}: ${err.message}`);
      continue;
    }

    const isLandscapeImage = probe.type === 'image' && probe.width / probe.height >= LANDSCAPE_RATIO;
    if (isLandscapeImage) landscapeCount += 1;

    const { effect, direction, fit } = classifyAsset(probe, landscapeCount - (isLandscapeImage ? 1 : 0));

    const startFrame = Math.round(scene.startSec * FPS);
    const endFrame = Math.round(scene.endSec * FPS);
    const durationInFrames = Math.max(endFrame - startFrame, 1);

    sceneSpecs.push({
      assetPath: path.posix.join('assets', scene.assetFilename),
      assetType: probe.type,
      effect,
      ...(direction ? { direction } : {}),
      fit,
      startFrame,
      durationInFrames,
    });
  }

  if (missingAssets.length > 0) {
    throw new Error(
      `buildSpec: ${missingAssets.length} asset(s) could not be probed -- refusing to render a ` +
      `partially-broken video:\n${missingAssets.map((m) => `  - ${m}`).join('\n')}`
    );
  }

  /** @type {import('../remotion/src/spec-types.js').VideoSpec} */
  const spec = {
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    scenes: sceneSpecs,
  };
  if (narrationAudioPath) spec.narrationAudioPath = narrationAudioPath;
  if (bgmAudioPath) {
    spec.bgmAudioPath = bgmAudioPath;
    spec.bgmVolume = bgmVolume ?? DEFAULT_BGM_VOLUME;
  }
  return spec;
}

/**
 * Convenience wrapper: build the spec and write it to disk.
 * @param {Parameters<typeof buildSpec>[0]} args
 * @param {string} outPath
 */
export async function buildSpecToFile(args, outPath) {
  const spec = await buildSpec(args);
  await writeFile(outPath, JSON.stringify(spec, null, 2));
  return spec;
}
