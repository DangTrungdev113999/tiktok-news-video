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
 * Decide effect + direction + zoomVariant + fit for one scene's asset, per
 * knowledge/effect-catalog.md. Pure function of (probe result, per-class
 * occurrence index) -- no randomness, no external state, so classification
 * is reproducible. Each class (landscape/portrait/square) alternates its own
 * variant across consecutive scenes of that SAME class (rhythm, not a
 * global scene counter), so e.g. two portraits back-to-back get push then
 * pull, not two pushes in a row.
 *
 * @param {{type:'image'|'video', width:number, height:number, durationSec?:number}} probe
 * @param {object} occurrence - how many scenes of each class have been seen
 *   so far (including this one), tracked by the caller.
 * @param {number} occurrence.landscape
 * @param {number} occurrence.portrait
 * @param {number} occurrence.square
 * @returns {{effect:'pan'|'zoom'|'diagonal'|'rotate'|'passthrough', direction?:'left'|'right', zoomVariant?:'in'|'out', fit:'cover'|'contain-blur-pad'}}
 */
export function classifyAsset(probe, occurrence = { landscape: 0, portrait: 0, square: 0 }) {
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
    const direction = occurrence.landscape % 2 === 0 ? 'left' : 'right';
    // Extreme panoramas would lose too much to a center-crop -> blur-pad.
    // A plain 16:9 photo (cropFraction ~0.68) is normal Ken-Burns material
    // and stays on cover; only genuine panoramas (ratioWH > ~2.25) cross
    // the 0.75 threshold.
    const fit = cropFraction > IMAGE_EXTREME_CROP_FRACTION ? 'contain-blur-pad' : 'cover';
    return { effect: 'pan', direction, fit };
  }

  if (ratioWH <= 1 / PORTRAIT_RATIO) {
    // Push/pull alternation across consecutive portrait scenes.
    const zoomVariant = occurrence.portrait % 2 === 0 ? 'in' : 'out';
    return { effect: 'zoom', zoomVariant, fit: 'cover' };
  }

  if (ratioWH >= SQUARE_MIN && ratioWH < LANDSCAPE_RATIO) {
    // Alternate between the diagonal drift and a subtle rotate+zoom for
    // extra variety across consecutive square-ish scenes.
    const direction = occurrence.square % 4 < 2 ? 'left' : 'right';
    const effect = occurrence.square % 2 === 0 ? 'diagonal' : 'rotate';
    return { effect, direction, fit: 'cover' };
  }

  // Fallback for anything between the square-ish upper bound and the
  // portrait lower bound that the three ranges above didn't already catch
  // (shouldn't normally happen given the thresholds are contiguous, but
  // never silently fall through with no effect assigned).
  return { effect: 'zoom', zoomVariant: 'in', fit: 'cover' };
}

// Karaoke caption chunking: how many words are shown together as ONE group.
//
// A group is allowed to wrap onto TWO rendered lines (Captions.tsx lays its
// words out with flex-wrap), so these bounds describe a whole group, not a
// single rendered row. Sizing (2026-07-20, see
// docs/superpowers/specs/2026-07-20-safe-zone-typography-design.md): the
// caption box is 1080 - 60 - 194 = 826px wide at Oswald 700 / 54px, which
// fits roughly 34 uppercase characters per rendered row -- so ~68 characters
// over two rows. 52 leaves real slack for wide words and the 18px word gap
// rather than betting on the estimate.
const CAPTION_MAX_WORDS_PER_LINE = 9;
const CAPTION_MAX_CHARS_PER_LINE = 52;

/**
 * Group a scene's word-level timing into short on-screen caption lines
 * (never longer than CAPTION_MAX_WORDS_PER_LINE words or
 * CAPTION_MAX_CHARS_PER_LINE characters), converting seconds to absolute
 * composition frames. Words are absolute-to-audio seconds (see
 * tts-elevenlabs.mjs / align-audio.mjs's `words` output) -- since the
 * narration track always plays from frame 0, `startSec * fps` IS the
 * absolute frame, independent of any gap-closing applied to the scene's own
 * Sequence duration.
 * @param {Array<{text:string, startSec:number, endSec:number}>} words
 * @returns {import('../remotion/src/spec-types.js').CaptionLine[]}
 */
function chunkWordsIntoCaptionLines(words) {
  const lines = [];
  let current = [];
  let currentChars = 0;

  for (const w of words) {
    const wouldOverflow =
      current.length >= CAPTION_MAX_WORDS_PER_LINE ||
      (current.length > 0 && currentChars + 1 + w.text.length > CAPTION_MAX_CHARS_PER_LINE);
    if (current.length > 0 && wouldOverflow) {
      lines.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(w);
    currentChars += (current.length > 1 ? 1 : 0) + w.text.length;
  }
  if (current.length > 0) lines.push(current);

  return lines.map((lineWords) => ({
    words: lineWords.map((w) => ({
      text: w.text,
      startFrame: Math.round(w.startSec * FPS),
      endFrame: Math.round(w.endSec * FPS),
    })),
    startFrame: Math.round(lineWords[0].startSec * FPS),
    endFrame: Math.round(lineWords[lineWords.length - 1].endSec * FPS),
  }));
}

/**
 * @param {object} args
 * @param {Array<{assetFilename: string, startSec: number, endSec: number, isHook?: boolean, hookHeadline?: string, words?: Array<{text:string,startSec:number,endSec:number}>}>} args.scenes
 *   One entry per scene, in order. `assetFilename` is relative to `assets/`
 *   (e.g. "hop-bao.jpg"). `startSec`/`endSec` come from tts-elevenlabs.mjs's
 *   or align-audio.mjs's `timings[]` (same shape from both). `words` (same
 *   source's `words[i]`) drives karaoke captions -- omit or pass `isHook:
 *   true` to exclude a scene (normally the hook/cover scene) from captions.
 * @param {string} args.workspaceDir - absolute path to the user's workspace
 *   folder (holds assets/, bgm-library/, output/ -- NOT the plugin's own
 *   code directory, which may live in a version-pinned plugin cache that
 *   gets discarded on update; see scripts/workspace.mjs).
 * @param {string} [args.narrationAudioPath] - path relative to workspaceDir.
 * @param {string} [args.bgmAudioPath] - path relative to workspaceDir.
 * @param {number} [args.bgmVolume] - defaults to 0.25 per the house spec.
 * @param {import('../remotion/src/spec-types.js').BrandKit} [args.brandKit] -
 *   required if any scene sets isHook: true (the hook-card overlay needs it).
 * @returns {Promise<import('../remotion/src/spec-types.js').VideoSpec>}
 */
/**
 * Extend each scene's `endSec` to the next scene's `startSec`, closing the
 * small natural-speech-pause gaps real TTS/alignment timing leaves between
 * scenes (unlike mock mode's naive even-split, which never produces gaps).
 * Necessary because each scene renders as a Remotion `<Sequence from=
 * startFrame durationInFrames=...>` -- any frame range not covered by a
 * Sequence renders as a black flash (bare AbsoluteFill background). Only the
 * last scene keeps its own `endSec`. `words[]` (if present) is passed
 * through untouched -- captions must track real speech, not the extended
 * hold.
 */
function closeTimingGaps(scenes) {
  return scenes.map((scene, i) => ({
    ...scene,
    endSec: i < scenes.length - 1 ? scenes[i + 1].startSec : scene.endSec,
  }));
}

export async function buildSpec({ scenes, workspaceDir, narrationAudioPath, bgmAudioPath, bgmVolume, brandKit }) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error('buildSpec requires a non-empty scenes[] array');
  }
  scenes = closeTimingGaps(scenes);

  const occurrence = { landscape: 0, portrait: 0, square: 0 };
  const sceneSpecs = [];
  const missingAssets = [];
  const captionLines = [];

  for (const scene of scenes) {
    const assetAbsPath = path.resolve(workspaceDir, 'assets', scene.assetFilename);
    let probe;
    try {
      probe = await probeAsset(assetAbsPath);
    } catch (err) {
      missingAssets.push(`${scene.assetFilename}: ${err.message}`);
      continue;
    }

    // Snapshot the 0-based occurrence index for this scene's class BEFORE
    // bumping the counter, so the first occurrence of each class starts its
    // alternation at index 0 (left/in/diagonal).
    const occurrenceForThisScene = { ...occurrence };
    if (probe.type === 'image') {
      const ratioWH = probe.width / probe.height;
      if (ratioWH >= LANDSCAPE_RATIO) occurrence.landscape += 1;
      else if (ratioWH <= 1 / PORTRAIT_RATIO) occurrence.portrait += 1;
      else if (ratioWH >= SQUARE_MIN && ratioWH < LANDSCAPE_RATIO) occurrence.square += 1;
    }

    const { effect, direction, zoomVariant, fit } = classifyAsset(probe, occurrenceForThisScene);

    const startFrame = Math.round(scene.startSec * FPS);
    const endFrame = Math.round(scene.endSec * FPS);
    const durationInFrames = Math.max(endFrame - startFrame, 1);

    sceneSpecs.push({
      assetPath: path.posix.join('assets', scene.assetFilename),
      assetType: probe.type,
      effect,
      ...(direction ? { direction } : {}),
      ...(zoomVariant ? { zoomVariant } : {}),
      fit,
      assetWidth: probe.width,
      assetHeight: probe.height,
      startFrame,
      durationInFrames,
      ...(scene.isHook ? { isHook: true, hookHeadline: scene.hookHeadline } : {}),
    });

    // Karaoke captions: every scene EXCEPT the hook scene (it gets the
    // hook-card overlay with its own static headline instead).
    if (!scene.isHook && Array.isArray(scene.words) && scene.words.length > 0) {
      captionLines.push(...chunkWordsIntoCaptionLines(scene.words));
    }
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
  if (captionLines.length > 0) spec.captions = captionLines;
  if (sceneSpecs.some((s) => s.isHook)) {
    if (!brandKit) {
      throw new Error('buildSpec: a scene has isHook: true but no brandKit was provided (resolve one via scripts/brand-kit.mjs first).');
    }
    spec.brandKit = brandKit;
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
