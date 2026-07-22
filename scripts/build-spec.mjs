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
import { buildAssetIndex } from './resolve-asset.mjs';

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

  // EVERY image is blur-padded by default (2026-07-20, at the author's
  // direction: "cac anh toi can co blur o tren duoi hoac o trai phai, tuy ty
  // le"). The whole picture is shown at its natural contain size and the frame
  // is filled with a blurred copy, so the bands land top/bottom for a
  // landscape and left/right for a portrait -- decided by the ratio, not by a
  // threshold. Edge-to-edge is now strictly opt-in, via `fill_full_screen`.
  //
  // This replaced a crop-loss threshold that sent only extreme panoramas to
  // blur-pad. Nothing is lost by it: cropping to fill is the choice that
  // discards content, so making it the one you have to ASK for is the safer
  // default -- and it is what the house look actually is.
  const fit = 'contain-blur-pad';

  if (ratioWH >= LANDSCAPE_RATIO) {
    const direction = occurrence.landscape % 2 === 0 ? 'left' : 'right';
    return { effect: 'pan', direction, fit };
  }

  if (ratioWH <= 1 / PORTRAIT_RATIO) {
    // Push/pull alternation across consecutive portrait scenes.
    const zoomVariant = occurrence.portrait % 2 === 0 ? 'in' : 'out';
    return { effect: 'zoom', zoomVariant, fit };
  }

  if (ratioWH >= SQUARE_MIN && ratioWH < LANDSCAPE_RATIO) {
    // Alternate between the diagonal drift and a subtle rotate+zoom for
    // extra variety across consecutive square-ish scenes.
    const direction = occurrence.square % 4 < 2 ? 'left' : 'right';
    const effect = occurrence.square % 2 === 0 ? 'diagonal' : 'rotate';
    return { effect, direction, fit };
  }

  // Fallback for anything the three contiguous ranges above didn't catch --
  // never silently fall through with no effect assigned.
  return { effect: 'zoom', zoomVariant: 'in', fit };
}

// Karaoke caption chunking: how many words are shown together as ONE group.
//
// A group is allowed to wrap onto TWO rendered lines (Captions.tsx lays its
// words out with flex-wrap), so these bounds describe a whole group, not a
// single rendered row. Sizing (2026-07-20, see
// docs/superpowers/specs/2026-07-20-safe-zone-typography-design.md): the
// caption box is 1080 - 60 - 194 = 826px wide. At the original Oswald 700 /
// 54px that fit roughly 34 uppercase characters per rendered row -- ~68 over
// two rows -- and 52 left real slack for wide words and the word gap.
//
// The captions dropped to 38px on 2026-07-20, so ~48 characters now fit per
// row and a 52-character group mostly lands on ONE row instead of filling
// two. These bounds are deliberately NOT scaled up to match: they decide how
// many words sit on screen at once, which is reading RHYTHM, and the author
// asked for smaller text, not for more of it per group. Raising them is a
// separate decision with its own look.
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
 * @param {Array<{assetFilename?: string, assets?: Array<{filename: string, share?: number}>, startSec: number, endSec: number, isHook?: boolean, hookHeadline?: string, words?: Array<{text:string,startSec:number,endSec:number}>}>} args.scenes
 *   One entry per SCREEN, in order. A screen names its media either as
 *   `assetFilename` (the single-asset shorthand) or as `assets[]` when it
 *   holds several images/videos, each with an optional `share` (the author's
 *   `(30%)` token) -- see skills/.../references/tags/README.md. Filenames are
 *   relative to `assets/` (e.g. "hop-bao.jpg"). A multi-asset screen is
 *   flattened into one shot per asset before anything else runs, so
 *   `spec.scenes[]` may be longer than this array.
 *   `startSec`/`endSec` come from tts-elevenlabs.mjs's
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

/**
 * Accept either shorthand (`assetFilename: "a.jpg"`) or the multi-asset form
 * (`assets: [{filename, share}]`), and return the multi-asset form. A bare
 * string in `assets[]` is treated as `{filename}`.
 */
function normalizeAssets(screen) {
  if (Array.isArray(screen.assets) && screen.assets.length > 0) {
    return screen.assets.map((a) => (typeof a === 'string' ? { filename: a } : a));
  }
  if (screen.assetFilename) return [{ filename: screen.assetFilename }];
  throw new Error('buildSpec: a screen has neither assetFilename nor a non-empty assets[]');
}

/**
 * Turn each asset's optional `share` (the `(30%)` token) into a fraction of
 * the screen's duration. Returns fractions summing to exactly 1.
 *
 * - no share anywhere       -> even split
 * - a share on every asset  -> use them, normalised (so 30/70 and 3/7 agree)
 * - a share on some only    -> tagged take theirs, the rest split the remainder
 *
 * Shares that leave no remainder for the untagged assets (e.g. 60+50 on a
 * 3-asset screen) would otherwise produce zero-length shots, so untagged
 * assets fall back to an even share and the final normalisation scales
 * everything down together. The result is always renderable; the skill is
 * responsible for telling the user their numbers were adjusted.
 */
function resolveShareFractions(assets, warnings = []) {
  const n = assets.length;
  const given = assets.map((a) => (typeof a.share === 'number' && a.share > 0 ? a.share : null));
  const untaggedCount = given.filter((v) => v === null).length;

  let shares;
  if (untaggedCount === n) {
    shares = given.map(() => 1);
  } else if (untaggedCount === 0) {
    shares = given;
  } else {
    const remainder = 100 - given.reduce((sum, v) => sum + (v ?? 0), 0);
    const perUntagged = remainder > 0 ? remainder / untaggedCount : 100 / n;
    shares = given.map((v) => v ?? perUntagged);
  }

  const total = shares.reduce((sum, v) => sum + v, 0);
  if (untaggedCount < n && Math.abs(total - 100) > 0.01) {
    warnings.push(
      `shares on this screen total ${total}%, not 100% -- divided proportionally instead ` +
      `(${assets.map((a, i) => `${a.filename} ${(shares[i] / total * 100).toFixed(0)}%`).join(', ')})`
    );
  }
  return shares.map((v) => v / total);
}

/**
 * Convert a focus cue given in absolute audio seconds (`peakSec` -- the moment
 * the narration says the subject's name) into the shot-local frame the
 * renderer wants, and drop `peakSec` so only render-ready numbers ship.
 *
 * A peak needs run-up: the push has to be visibly travelling before it lands.
 * If the cue falls at or before the shot's own start, the peak is nudged in to
 * MIN_PEAK_LEAD_FRAMES so there is still a move to see rather than a still
 * frame that never animates. A cue past the end of the shot peaks at the end.
 *
 * BOTH of those are clamps over a cue that landed OUTSIDE its own shot, which
 * means the zoom no longer peaks on the word it was aimed at -- the one thing
 * this cue exists to do. The cut (`assets[].startSec`) and the peak
 * (`focus.peakSec`) are set independently by the skill, so they can disagree.
 * Clamping silently would hide exactly the failure the author would want to
 * know about, so every clamp is reported.
 */
const MIN_PEAK_LEAD_FRAMES = 6;
// Shortest gap between two focus targets in the same shot. Below this the
// camera snaps between subjects instead of travelling.
const MIN_TRANSIT_FRAMES = 12;

function resolveFocusPeaks(focus, startFrame, durationInFrames, filename, warnings) {
  const targets = Array.isArray(focus) ? focus : [focus];
  const lastFrame = Math.max(durationInFrames - 1, 1);

  const resolved = targets.map((target) => {
    const { peakSec, ...rest } = target;
    if (typeof peakSec !== 'number') return rest;

    const local = Math.round(peakSec * FPS) - startFrame;
    const label = targets.length > 1 ? `${filename} (${rest.note ?? 'focus'})` : filename;

    if (local < MIN_PEAK_LEAD_FRAMES) {
      warnings.push(
        `${label}: the focus cue at ${peakSec.toFixed(2)}s lands ` +
        `${((startFrame - Math.round(peakSec * FPS)) / FPS).toFixed(2)}s BEFORE this shot starts, ` +
        `so the zoom cannot peak on it -- cut to this asset earlier.`
      );
    } else if (local > lastFrame) {
      warnings.push(
        `${label}: the focus cue at ${peakSec.toFixed(2)}s lands after this shot ends, ` +
        `so the zoom peaks at the cut instead -- give this asset more of the screen.`
      );
    }
    return { ...rest, peakFrame: Math.min(Math.max(local, MIN_PEAK_LEAD_FRAMES), lastFrame) };
  });

  // Several targets with no cue at all can't be timed -- every move would
  // collapse onto the end of the shot. Multi-target exists FOR timing, so
  // this is an author error worth naming rather than quietly degrading.
  if (targets.length > 1 && resolved.every((t) => t.peakFrame === undefined)) {
    warnings.push(
      `${filename}: ${targets.length} focus targets but no cue on any of them -- ` +
      `the camera has nothing to time the moves against. Add a \`lúc "..."\` to each.`
    );
  }

  // Several targets in one shot must be in time order, and far enough apart to
  // travel between. Out-of-order cues mean the author listed the subjects in a
  // different order than the narration names them -- worth saying, because the
  // camera visits them in cue order regardless.
  for (let i = 1; i < resolved.length; i += 1) {
    const prev = resolved[i - 1].peakFrame ?? 0;
    const here = resolved[i].peakFrame ?? lastFrame;
    if (here <= prev) {
      warnings.push(
        `${filename}: focus target ${i + 1} is cued at or before target ${i} -- ` +
        `the moves were spread out to stay watchable, so they no longer land exactly on their words.`
      );
    }
    resolved[i].peakFrame = Math.min(Math.max(here, prev + MIN_TRANSIT_FRAMES), lastFrame);
  }

  return resolved;
}

// --- Motion tags: zoom_in / zoom_out / slide_left_right / slide_right_left ---
//
// The parser turns tag TEXT into numbers; this turns those numbers into the
// render-ready spec fields. Keeping the geometry here (rather than in the
// skill) means the two slide tags stay exact mirrors by construction instead
// of by two prompts agreeing with each other.

/** Bare `zoom_in` / `zoom_out` -- the house drift. */
const ZOOM_DEFAULT_AMOUNT = 0.2;
/** Past this a 1080-wide source is enlarged beyond its own pixels. */
const ZOOM_MAX_SCALE = 2.0;
/** A slide with less travel than this is a still frame that looks like a bug. */
const SLIDE_MIN_TRAVEL = 0.15;
// Zoom held during an anchored slide. An anchor is unreachable without one,
// and a FIXED zoom under-serves a strong ask: bringing a point at y=0.1 to the
// centre of a cover-fitted wide photo needs about scale 5 before the picture is
// tall enough to allow the shift, so at 1.3 the frame only travels ~29% of the
// way and the author's `top 20%` barely registers. Scaling the zoom with how
// far the anchor sits from centre spends more zoom exactly where more is
// needed. The ceiling matches focus_object's "tight" value -- past it the
// source pixels start to show.
const SLIDE_ANCHOR_SCALE_BASE = 1.15;
const SLIDE_ANCHOR_SCALE_PER_UNIT = 1.5;
const SLIDE_ANCHOR_SCALE_MAX = 1.6;

function slideAnchorScale(anchorY) {
  const distanceFromCentre = Math.abs(anchorY - 0.5);
  return Math.min(
    SLIDE_ANCHOR_SCALE_BASE + SLIDE_ANCHOR_SCALE_PER_UNIT * distanceFromCentre,
    SLIDE_ANCHOR_SCALE_MAX,
  );
}
/** Below this many pixels of overflow along the travel axis there is nothing to slide across. */
const SLIDE_MIN_OVERFLOW_PX = 40;
/**
 * How far past the frame a slide's picture is stretched along its travel axis.
 * The picture is painted as SMALL as it can be while still having this much to
 * travel over -- small painted size means big blur bands, so minimising the
 * scale is what maximises the band. (A fixed 10% band instead left a 3.6:1
 * photo with a 192px sliver that read as full-bleed, because the backdrop is a
 * blurred copy of the same picture and the colours match.)
 */
const SLIDE_TRAVEL_FILL = 1.5;
/** How long an entrance takes. Long enough to read, short enough not to cost the shot. */
const ENTRANCE_SEC = 0.75;
/**
 * When no scale can both overflow along the travel axis AND stay short across
 * it, the slide is enlarged past cover until it has at least this much of the
 * frame to travel over. Losing the blur band is much better than losing the
 * movement: a slide that cannot move is not a slide.
 */
const SLIDE_FALLBACK_FILL = 1.3;
// End-of-screen punch: a quick push into the cut, the punctuation that keeps a
// feed video moving. Set at the author's request ("cuoi moi screen cho 1 hieu
// ung chuyen canh don gian... tao nhip nhanh cho video").
// Lengthened twice on the author's word -- 0.25s -> 0.5s -> 0.8s -- each time
// for the same reason: it "phut cai", it snapped. Scale stayed at 1.08 through
// the second pass, so all the softening comes from spreading the SAME travel
// over more frames. Peak growth is now ~1.9px/frame against 9.5 at 0.25s.
// Anything shorter reads as a jump cut with a zoom stapled to it.
const PUNCH_SEC = 0.8;
const PUNCH_SCALE = 1.08;
/** Keeps an entrance-only shot from being frozen when no zoom was asked for. */
const ENTRANCE_IDLE_ZOOM = 1.08;

/**
 * Scale (against the file's own pixels) to paint a slide's sharp foreground at.
 *
 * Wants two things at once: enough overflow ALONG the travel axis to actually
 * traverse, and less than the frame ACROSS it so the blur band shows. Sizing
 * by the perpendicular axis gives both -- until the picture is too narrow for
 * the travel axis to overflow at all (a portrait asked to slide sideways), at
 * which point there is no scale that satisfies both and cover is the honest
 * fallback. `fill_full_screen` asks for cover directly.
 */
function slideForegroundScale(axis, probe, fillFullScreen) {
  const coverScale = Math.max(WIDTH / probe.width, HEIGHT / probe.height);
  if (fillFullScreen) return coverScale;

  const horizontal = axis !== 'y';
  // Smallest scale that still leaves something to travel over. Starting from
  // contain (the whole picture visible, biggest possible bands) and growing
  // only as far as the traverse needs keeps as much blur as the tag allows.
  const containScale = Math.min(WIDTH / probe.width, HEIGHT / probe.height);
  const needed = horizontal
    ? (WIDTH * SLIDE_TRAVEL_FILL) / probe.width
    : (HEIGHT * SLIDE_TRAVEL_FILL) / probe.height;
  return Math.max(containScale, needed);
}

/**
 * `zoom_in: 50%` / `zoom_out: 50%` -> the `zoom` effect with an explicit end.
 * `zoomTo` is the ZOOMED end in both variants; `zoomVariant` says which end of
 * the shot it belongs to, which is what makes the pair symmetrical.
 */
function resolveZoomTag(zoom, filename, warnings) {
  const amount = typeof zoom.amount === 'number' ? zoom.amount : ZOOM_DEFAULT_AMOUNT;
  let zoomTo = 1 + amount;
  if (zoomTo > ZOOM_MAX_SCALE) {
    warnings.push(
      `${filename}: zoom of ${Math.round(amount * 100)}% enlarges the picture past its own ` +
      `pixels and would look soft -- capped at ${Math.round((ZOOM_MAX_SCALE - 1) * 100)}%.`
    );
    zoomTo = ZOOM_MAX_SCALE;
  }
  return { effect: 'zoom', zoomVariant: zoom.variant === 'out' ? 'out' : 'in', zoomTo };
}

/**
 * `slide_left_right: 20% 20%, top 20%` -> the `slide` effect.
 *
 * The insets are always measured from the edge that END of the move is near,
 * so the same value produces the same framing in either direction. Resolving
 * them into absolute `from`/`to` positions here is what lets `spec.json` carry
 * no direction field at all -- `from > to` IS the right-to-left variant.
 *
 * Also forces `fit: 'cover'`: a slide must not travel past a blurred band, and
 * cover is what fills the axis of travel. See tags/slide-left-right.md.
 */
function resolveSlideTag(slide, probe, filename, fillFullScreen, warnings) {
  const axis = slide.direction === 'top_bottom' ? 'y' : 'x';
  const horizontal = axis === 'x';
  // Which end the travel starts at. `top_bottom` is the odd one out on
  // purpose: the author described it as "appears at centre, then drifts down",
  // so it starts halfway rather than at the picture's top edge.
  const forward = slide.direction !== 'right_left';
  const startsCentred = slide.direction === 'top_bottom';

  const startInset = slide.startInset ?? 0;
  const endInset = slide.endInset ?? 0;

  const anchorPos = typeof slide.anchorY === 'number' ? slide.anchorY : undefined;
  const anchorScale = anchorPos !== undefined ? slideAnchorScale(anchorPos) : undefined;

  const foregroundScale = slideForegroundScale(axis, probe, fillFullScreen);
  const paintedAlong = (horizontal ? probe.width : probe.height) * foregroundScale;
  const frameAlong = horizontal ? WIDTH : HEIGHT;

  // `from`/`to` index the TRAVERSABLE RANGE (0 = leading edges flush, 1 =
  // trailing edges flush), but the author's inset is a fraction of the
  // PICTURE. Those differ by exactly one frame extent: only
  // `painted - frame` of the picture is ever traversed, so a raw 0.2 would put
  // the frame edge at 0.2 x (1 - frame/painted) of the image -- always short of
  // what "start 20% in from the left" says. Converting here, where the
  // dimensions are, keeps the tag honest.
  const traversable = 1 - frameAlong / paintedAlong;
  const toRange = (inset) =>
    traversable > 0 ? Math.min(Math.max(inset / traversable, 0), 1) : 0;

  // Both insets eat into the SAME range, so they can ask for more than exists:
  // a 1.34:1 picture only traverses a third of its own width, which caps the
  // two insets at ~28% combined. Past that the naive from/to CROSS OVER, and
  // since `from > to` is how the reversed variant is expressed, a
  // `slide_left_right` silently starts travelling right-to-left. Clamping in
  // range space keeps the requested ratio between the two insets and, because
  // both ends are built from the same clamped pair, makes the direction fall
  // out of the arithmetic instead of being asserted separately.
  let r0 = toRange(startInset);
  let r1 = toRange(endInset);
  // Twice the floor, not the floor itself: clamping to exactly SLIDE_MIN_TRAVEL
  // lands on the wrong side of the `< SLIDE_MIN_TRAVEL` check below (floating
  // point alone is enough), which discards the insets entirely and slides the
  // full length -- the author asked for an inset move and would get the
  // opposite. Leaving room keeps a muted version of what they wrote.
  const budget = 1 - 2 * SLIDE_MIN_TRAVEL;
  if (r0 + r1 > budget) {
    const k = budget / (r0 + r1);
    warnings.push(
      `${filename}: insets of ${Math.round(startInset * 100)}%/${Math.round(endInset * 100)}% ` +
      `ask for more than this picture can traverse (it is ${probe.width}x${probe.height}, so at ` +
      `most ~${Math.round(traversable * 100)}% total) -- narrowed to ` +
      `${Math.round(r0 * k * traversable * 100)}%/${Math.round(r1 * k * traversable * 100)}%, ` +
      `so the shot moves less than asked.`
    );
    r0 *= k;
    r1 *= k;
  }

  let from;
  let to;
  if (startsCentred) {
    from = 0.5;
    to = 1;
  } else {
    from = forward ? r0 : 1 - r0;
    to = forward ? 1 - r1 : r1;
  }

  const overflowPx = paintedAlong - frameAlong;
  // Warn only when the traverse cost the band ENTIRELY -- growing the picture
  // to have somewhere to travel is normal and expected, losing the house look
  // is not.
  const paintedAcross = (horizontal ? probe.height : probe.width) * foregroundScale;
  const frameAcross = horizontal ? HEIGHT : WIDTH;
  if (!fillFullScreen && paintedAcross >= frameAcross) {
    warnings.push(
      `${filename} is ${probe.width}x${probe.height}, which is not long enough on the ` +
      `${horizontal ? 'horizontal' : 'vertical'} axis to slide across AND keep a blur band -- ` +
      `it fills the frame edge-to-edge instead, so it is cropped more than usual.`
    );
  }
  if (overflowPx < SLIDE_MIN_OVERFLOW_PX) {
    warnings.push(
      `${filename}: nothing to slide across even after enlarging -- the shot will barely move.`
    );
  } else if (Math.abs(to - from) < SLIDE_MIN_TRAVEL) {
    warnings.push(
      `${filename}: the slide insets leave only ${Math.round(Math.abs(to - from) * 100)}% to ` +
      `travel across, which would barely move -- sliding the full length instead.`
    );
    from = forward ? 0 : 1;
    to = forward ? 1 : 0;
  }

  return {
    effect: 'slide',
    slide: {
      axis,
      from,
      to,
      foregroundScale,
      ...(anchorPos !== undefined ? { anchorPos, anchorScale } : {}),
    },
  };
}

/**
 * How the shot BEGINS -- a slot of its own, separate from the move that runs
 * during it.
 *
 * A slide with no explicit entrance tag gets one for free: the picture flies in
 * from the side OPPOSITE the traverse, over a blur backdrop that is already on
 * screen, so arriving at a new screen reads as a transition rather than a cut.
 * `flip_book` claims the same slot, which is why the two are alternatives and
 * not a stack.
 */
function resolveEntrance(asset, slideSpec) {
  const frames = Math.round(ENTRANCE_SEC * FPS);
  if (asset.flipBook) return { type: 'flip_book', durationInFrames: frames };
  if (!slideSpec) return undefined;
  // "appears at centre then drifts" -- the author described this one's own
  // opening, so it does not also fly in.
  if (slideSpec.axis === 'y') return undefined;
  const fromSide = slideSpec.to > slideSpec.from ? 'right' : 'left';
  return { type: 'slide_in', fromSide, durationInFrames: frames };
}

/**
 * Everything an asset's tags override on top of `classifyAsset`'s automatic
 * choice. Returns the fields to spread over it.
 *
 * Precedence matches tags/README.md: focus_object > slide > zoom. The parser
 * already reports the conflict; this just has to agree with it. `focus` is
 * applied elsewhere (it needs the shot's frame window), so here it only means
 * "leave the automatic effect alone, the focus path will take over".
 */
function resolveAssetMotion(asset, probe, warnings) {
  const overrides = {};

  // --- fit slot -------------------------------------------------------------
  if (asset.fillFullScreen) overrides.fit = 'cover';

  // --- aim slot -------------------------------------------------------------
  // focus_object is the one genuine rival to a slide: both are the traverse,
  // and they cannot both own it. Everything else COMPOSES.
  if (asset.focus) {
    if (asset.slide) {
      warnings.push(
        `${asset.filename}: focus_object and a slide both decide where the camera goes -- ` +
        `used focus_object, ignored the slide.`
      );
    }
    return overrides;
  }

  // --- zoom slot ------------------------------------------------------------
  // Applied BEFORE the traverse so a slide can overwrite `effect` while
  // leaving zoomTo/zoomVariant in place: `zoom_in 20% | slide_left_right` is a
  // traverse that also closes in, not a conflict.
  if (asset.zoom) Object.assign(overrides, resolveZoomTag(asset.zoom, asset.filename, warnings));

  // --- traverse slot --------------------------------------------------------
  if (asset.slide) {
    Object.assign(
      overrides,
      resolveSlideTag(asset.slide, probe, asset.filename, asset.fillFullScreen, warnings),
    );
  } else if (asset.flipBook) {
    // An entrance with no traverse still needs the layered path (backdrop +
    // foreground + reveal), so it ships a DEGENERATE slide -- from === to, no
    // travel. One component then serves both cases instead of teaching the
    // cover and blur-pad paths about entrances too.
    // CONTAIN, not the slide's scale. slideForegroundScale inflates the
    // picture past the frame so a traverse has somewhere to travel -- but this
    // shot does not travel. Inheriting that made the picture wider than the
    // frame, so the flip's fold swept across the WHOLE frame and read as
    // turning the blur layer too, which is exactly what the author saw. At
    // contain the fold runs across the picture alone, with the blur band
    // sitting still around it.
    const containScale = Math.min(WIDTH / probe.width, HEIGHT / probe.height);
    const coverScale = Math.max(WIDTH / probe.width, HEIGHT / probe.height);
    overrides.effect = 'slide';
    overrides.slide = {
      axis: 'x',
      from: 0.5,
      to: 0.5,
      foregroundScale: asset.fillFullScreen ? coverScale : containScale,
    };
    if (overrides.zoomTo === undefined) {
      overrides.zoomTo = ENTRANCE_IDLE_ZOOM;
      overrides.zoomVariant = 'in';
    }
  }

  // --- entrance slot --------------------------------------------------------
  const entrance = resolveEntrance(asset, overrides.slide);
  if (entrance) overrides.entrance = entrance;

  return overrides;
}

/** Shortest shot worth cutting to. Below this the cut reads as a glitch. */
const MIN_SHOT_SEC = 0.5;

/**
 * Turn per-asset `startSec` pins into shot boundaries.
 *
 * This is the path that matters in practice. Authors rarely type `(30%)` --
 * they expect the image to change when the narration reaches what that image
 * shows. The skill resolves that at build time: narration is verbatim and
 * word-level timed, so it knows the second at which a name or subject is
 * spoken, and pins the asset there. Only numbers reach this function.
 *
 * The first asset always starts with the screen. Unpinned assets in between
 * spread evenly across the gap between their pinned neighbours. Pins are
 * clamped so shots stay in order and none falls below MIN_SHOT_SEC; if the
 * screen is too short to honour them at all, returns null so the caller falls
 * back to an even split.
 *
 * @returns {number[]|null} n+1 boundaries (b[0] = screen start, b[n] = screen end)
 */
function resolveShotBoundaries(screen, assets) {
  const n = assets.length;
  const pins = assets.map((a, i) =>
    i > 0 && typeof a.startSec === 'number' ? a.startSec : null
  );
  if (pins.every((v) => v === null)) return null;

  const b = [screen.startSec, ...pins.slice(1), screen.endSec];

  // Spread each run of unpinned boundaries evenly between its known neighbours.
  for (let i = 1; i < n; i += 1) {
    if (b[i] !== null) continue;
    let hi = i;
    while (b[hi] === null) hi += 1;
    const span = (b[hi] - b[i - 1]) / (hi - i + 1);
    for (let k = i; k < hi; k += 1) b[k] = b[k - 1] + span;
  }

  // Push forward, then pull back, so boundaries end up strictly increasing
  // with room for a real shot on both sides of every cut.
  for (let i = 1; i <= n; i += 1) b[i] = Math.max(b[i], b[i - 1] + MIN_SHOT_SEC);
  if (b[n] > screen.endSec) return null; // screen too short to honour the pins
  b[n] = screen.endSec;
  for (let i = n - 1; i >= 1; i -= 1) b[i] = Math.min(b[i], b[i + 1] - MIN_SHOT_SEC);
  if (b[1] <= b[0]) return null;

  return b;
}

/**
 * Flatten one screen (which may hold several images/videos) into one SHOT per
 * asset, each with its own time window. Everything downstream -- motion
 * classification, `<Sequence>`, `Scene.tsx` -- already works one asset at a
 * time, so "screen" is purely an authoring-input concept and is resolved away
 * here rather than reaching Remotion.
 *
 * Two invariants this must preserve:
 *
 * 1. **Contiguity.** Consecutive shots share the EXACT same boundary value
 *    (each shot's `endSec` is the next one's `startSec`, and the last shot
 *    lands exactly on the screen's own `endSec`). Frame rounding then can't
 *    open a 1-frame gap, which would render as a black flash. The following
 *    `closeTimingGaps` pass relies on this too.
 * 2. **Captions belong to the SCREEN, not the shot.** Karaoke captions track
 *    speech and don't care where an image changes, so `words` is attached to
 *    the FIRST shot only. Copying it onto every shot would emit each caption
 *    line once per asset -- a 2-asset screen would show doubled captions.
 *
 * `isHook`/`hookHeadline` ARE copied onto every shot of a hook screen: the
 * hook card is fully static, so it renders identically across a shot boundary
 * and the remount is invisible. Without this, a 2-asset hook screen would
 * drop the brand badge halfway through.
 */
function expandScreensIntoShots(screens, warnings = []) {
  const shots = [];
  for (const [screenIndex, screen] of screens.entries()) {
    const assets = normalizeAssets(screen);

    // Cut points come from the narration when the skill pinned them there,
    // otherwise from `(30%)` shares, otherwise an even split.
    let boundaries = resolveShotBoundaries(screen, assets);
    if (!boundaries) {
      const fractions = resolveShareFractions(assets, warnings);
      boundaries = [screen.startSec];
      let cursor = screen.startSec;
      const span = screen.endSec - screen.startSec;
      fractions.forEach((f, i) => {
        cursor = i === fractions.length - 1 ? screen.endSec : cursor + span * f;
        boundaries.push(cursor);
      });
    }

    assets.forEach((asset, i) => {
      const { assets: _assets, assetFilename: _assetFilename, words, ...rest } = screen;
      shots.push({
        ...rest,
        assetFilename: asset.filename,
        // `zoom_in: 50%, target 1 trong anh_1_des.jpg` is an AIMED zoom, which
        // is the focus mechanism with a single point -- the skill resolves the
        // marker to coordinates the same way, so it reuses that path rather
        // than growing a second one. The percentage becomes the point's scale.
        ...(asset.focus
          ? { focus: asset.focus }
          : asset.zoom && asset.zoom.aim
            ? {
                focus: [{ ...asset.zoom.aim, scale: 1 + (asset.zoom.amount ?? ZOOM_DEFAULT_AMOUNT) }],
                // zoom_out starts close on the marker and pulls back off it.
                ...(asset.zoom.variant === 'out' ? { focusReverse: true } : {}),
              }
            : {}),
        // Motion tags ride along per-asset; they are resolved against the
        // probe (a slide needs the picture's real dimensions) further down.
        ...(asset.fillFullScreen ? { fillFullScreen: true } : {}),
        ...(asset.zoom ? { zoom: asset.zoom } : {}),
        ...(asset.zoom && asset.zoom.aim && asset.zoom.variant === 'out' ? { focusReverse: true } : {}),
        ...(asset.slide ? { slide: asset.slide } : {}),
        ...(asset.flipBook ? { flipBook: true } : {}),
        startSec: boundaries[i],
        endSec: boundaries[i + 1],
        ...(i === 0 && words ? { words } : {}),
        // The punch belongs to the SCREEN, so it goes on that screen's last
        // shot only -- a screen holding three images would otherwise punch
        // three times and read as a stutter. The final screen gets none:
        // there is no cut for it to land on, and ending mid-push looks like
        // the video was clipped.
        ...(i === assets.length - 1 && screenIndex < screens.length - 1
          ? { isScreenEnd: true }
          : {}),
      });
    });
  }
  return shots;
}

export async function buildSpec({ scenes, workspaceDir, narrationAudioPath, bgmAudioPath, bgmVolume, brandKit }) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error('buildSpec requires a non-empty scenes[] array');
  }
  // Non-fatal problems the SKILL must report to the user. Never read by the
  // renderer -- these are things that still produce a video, but not the video
  // the author asked for.
  const warnings = [];

  // Screens in -> shots out. One screen may hold several assets; everything
  // below this line works one asset at a time.
  scenes = closeTimingGaps(expandScreensIntoShots(scenes, warnings));

  const occurrence = { landscape: 0, portrait: 0, square: 0 };
  const sceneSpecs = [];
  const missingAssets = [];
  const captionLines = [];

  // What the author typed -> a real path under assets/. Resolved ONCE, here,
  // and written back onto the scene, so the probe below and the `assetPath`
  // that lands in spec.json cannot disagree. See references/asset-naming.md.
  const assetIndex = await buildAssetIndex(workspaceDir);

  for (const scene of scenes) {
    const resolved = assetIndex.resolve(scene.assetFilename);
    if (resolved.error) {
      missingAssets.push(resolved.error);
      continue;
    }
    scene.assetFilename = resolved.path;

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
    // alternation at index 0 (left/in/diagonal). A focused shot doesn't take
    // its turn in the rotation at all -- its movement is aimed, not chosen by
    // aspect ratio, so letting it bump the counter would flip the next
    // portrait's push/pull for no visible reason.
    const occurrenceForThisScene = { ...occurrence };
    const hasMotionTag = Boolean(scene.focus || scene.slide || scene.zoom || scene.flipBook);
    if (probe.type === 'image' && !hasMotionTag) {
      const ratioWH = probe.width / probe.height;
      if (ratioWH >= LANDSCAPE_RATIO) occurrence.landscape += 1;
      else if (ratioWH <= 1 / PORTRAIT_RATIO) occurrence.portrait += 1;
      else if (ratioWH >= SQUARE_MIN && ratioWH < LANDSCAPE_RATIO) occurrence.square += 1;
    }

    // Automatic classification first, then whatever the author's tags override.
    // A tag changes which parameters Scene.tsx receives -- it never adds a
    // bespoke rendering path (see tags/README.md).
    const { effect, direction, zoomVariant, fit, zoomTo, slide, entrance } = {
      ...classifyAsset(probe, occurrenceForThisScene),
      ...resolveAssetMotion(
        {
          filename: scene.assetFilename,
          focus: scene.focus,
          fillFullScreen: scene.fillFullScreen,
          zoom: scene.zoom,
          slide: scene.slide,
          flipBook: scene.flipBook,
        },
        probe,
        warnings,
      ),
    };

    const startFrame = Math.round(scene.startSec * FPS);
    const endFrame = Math.round(scene.endSec * FPS);
    const durationInFrames = Math.max(endFrame - startFrame, 1);

    sceneSpecs.push({
      assetPath: path.posix.join('assets', scene.assetFilename),
      assetType: probe.type,
      effect,
      ...(direction ? { direction } : {}),
      ...(zoomVariant ? { zoomVariant } : {}),
      ...(zoomTo !== undefined ? { zoomTo } : {}),
      ...(slide ? { slide } : {}),
      ...(entrance ? { entrance } : {}),
      ...(scene.isScreenEnd
        ? {
            exit: {
              type: 'punch',
              durationInFrames: Math.min(
                Math.round(PUNCH_SEC * FPS),
                Math.max(durationInFrames - 1, 1),
              ),
              scale: PUNCH_SCALE,
            },
          }
        : {}),
      fit,
      assetWidth: probe.width,
      assetHeight: probe.height,
      ...(scene.focus
        ? { focus: resolveFocusPeaks(scene.focus, startFrame, durationInFrames, scene.assetFilename, warnings) }
        : {}),
      ...(scene.focusReverse ? { focusReverse: true } : {}),
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
  // Force forward slashes on the way in. These two fields go straight to
  // Remotion's `staticFile()`, which is a URL builder and treats a backslash
  // as a literal character, not a separator -- so a Windows caller that built
  // them with path.relative() (the natural choice, and what smoke-test.mjs
  // modelled) would ship `output\run\narration.mp3` and render silently
  // without audio. Normalising HERE covers every caller at once, and matches
  // what scene assets already get from path.posix.join() above.
  const toPosix = (p) => String(p).split(path.sep).join('/');
  if (narrationAudioPath) spec.narrationAudioPath = toPosix(narrationAudioPath);
  if (bgmAudioPath) {
    spec.bgmAudioPath = toPosix(bgmAudioPath);
    spec.bgmVolume = bgmVolume ?? DEFAULT_BGM_VOLUME;
  }
  if (captionLines.length > 0) spec.captions = captionLines;
  if (warnings.length > 0) spec.warnings = warnings;
  if (sceneSpecs.some((s) => s.isHook)) {
    if (!brandKit) {
      throw new Error('buildSpec: a scene has isHook: true but no brandKit was provided (resolve one via scripts/brand-kit.mjs first).');
    }
    // A brandKit is not just brand.json. `getBrand()` adds `slug` and
    // `hookBgPath` after checking the background file is readable; hand
    // buildSpec the raw JSON instead and every field here is present except
    // the one the renderer dereferences.
    //
    // Without this check the run reached Remotion and died at frame 5 with
    // "undefined was passed to staticFile()" -- a message naming neither the
    // field nor the file, thrown from inside React, AFTER the ElevenLabs call
    // had already been paid for. Everything that can abort a run belongs
    // before the paid step; this one was arriving three steps late.
    // `slug` is the sentinel, and it has to be: it is the one field getBrand()
    // always adds and brand.json never contains. hookBgPath used to be checked
    // here, but it is optional now -- a brand may legitimately have no cover
    // art, so its absence no longer proves anything about how the kit was
    // loaded.
    for (const field of ['slug', 'badgeLabel', 'displayName']) {
      if (!brandKit[field]) {
        throw new Error(
          `buildSpec: brandKit is missing "${field}". Load it with getBrand(slug) from ` +
            `scripts/brand-kit.mjs -- reading brand/<slug>/brand.json directly skips the ` +
            `fields that file does not contain.`,
        );
      }
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
