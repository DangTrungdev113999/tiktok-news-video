import React from "react";
import type { CSSProperties } from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Video as MediaVideo } from "@remotion/media";
import type { AssetType, Direction, Effect, EntranceSpec, Fit, FocusPoint, SlideSpec, ZoomVariant } from "./spec-types";

/**
 * ONE parametric scene component -- no bespoke-per-scene code.
 * All motion is pure math over the local frame number (via useCurrentFrame(),
 * which Remotion automatically offsets to be relative to the enclosing
 * <Sequence>), so it is fully deterministic across renders.
 *
 * See knowledge/effect-catalog.md for the authoritative spec this implements.
 */
export interface SceneProps {
  assetPath: string;
  assetType: AssetType;
  effect: Effect;
  direction?: Direction;
  zoomVariant?: ZoomVariant;
  fit: Fit;
  /** Asset's natural pixel dimensions -- required for "pan" to compute its true crop overflow (see PanMedia). */
  assetWidth?: number;
  assetHeight?: number;
  /** From a `focus_object:` tag -- one entry per subject, in time order. Replaces the effect with an aimed move. */
  focus?: FocusPoint[];
  /** The ZOOMED end of a "zoom" effect, from `zoom_in: 50%` / `zoom_out: 50%`. Defaults to ZOOM_END. */
  zoomTo?: number;
  /** Required for effect "slide" -- see LayeredMedia. */
  slide?: SlideSpec;
  /** How the shot begins -- a separate slot from the move that runs during it. */
  entrance?: EntranceSpec;
  durationInFrames: number;
}

// Legacy fallback only (used when assetWidth/assetHeight aren't present in an
// older spec.json) -- see PanMedia below for the real, geometry-driven pan.
const PAN_DRIFT_PCT = 0.06; // +/-6% of frame width
const PAN_ZOOM_END = 1.08;

// Real pan traversal: what fraction of the asset's TRUE cover-crop overflow
// (computed from its natural dimensions, not a synthetic zoom-derived one) to
// actually drift across. See PanMedia's doc comment for why this replaced
// the old clampToAxisOverflow-bounded approach.
const PAN_TRAVERSAL_FRACTION = 0.92;
// Small extra push on top of the drift, purely cosmetic (the drift itself
// carries the amplitude now, so this stays modest).
const PAN_EXTRA_ZOOM_END = 1.06;

const ZOOM_END = 1.2;
// Enlarging a 1080-wide source past this shows its own pixels on a phone.
const ZOOM_MAX = 2.0;

// A slide reads as a steady traverse, so neither MOTION_EASING (a hard
// ease-out: ~93% done by halfway, so the move appears to arrive at once and
// then crawl) nor a linear ramp (starts and stops dead, mechanical). This
// symmetric ease-in-out holds an even pace through the middle, which is where
// the eye is actually reading the picture.
const SLIDE_EASING = Easing.bezier(0.33, 0, 0.67, 1);
// Fraction of the shot the anchor push takes before it holds.
const SLIDE_ANCHOR_RAMP = 0.25;
// Travelling the FULL overflow puts the image edge exactly on the frame edge;
// exact in real arithmetic, a subpixel gamble after rounding. This backs off
// by an invisible amount so no edge can ever creep in.
const SLIDE_TRAVERSAL_SAFETY = 0.98;

// A picture flying in should feel like it ARRIVES: most of the travel early,
// then a settle. The house ease-out is exactly that curve.
const SLIDE_IN_EASING = Easing.bezier(0.22, 1, 0.36, 1);
// A page turn is the opposite shape. Under the ease-out above it is ~93% done
// by the halfway point, so at a 0.6s entrance the fold has swept past before
// the eye finds it and the whole gesture reads as a hard cut. This ease-in-out
// keeps the fold travelling across the middle of its run, where it is seen.
const FLIP_BOOK_EASING = Easing.bezier(0.45, 0, 0.55, 1);

/**
 * The `flip_book` reveal: the picture is uncovered along a straight fold
 * running from the top-left corner toward the bottom-right, like a page being
 * turned back. `t` runs 0 (nothing shown) to 1 (fully shown).
 *
 * The fold is the line `x/W + y/H = 2t`, so the revealed region is a triangle
 * growing out of the top-left corner until it passes the centre, then a
 * pentagon closing on the bottom-right. Expressed as clip-path percentages,
 * which lets one polygon serve any frame size.
 */
function flipBookClipPath(t: number): string {
  const u = Math.min(Math.max(t, 0), 1) * 2;
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
  if (u <= 1) {
    return `polygon(0% 0%, ${pct(u)} 0%, 0% ${pct(u)})`;
  }
  const v = u - 1;
  return `polygon(0% 0%, 100% 0%, 100% ${pct(v)}, ${pct(v)} 100%, 0% 100%)`;
}

/** Dark crease painted along the fold so it reads as a turning page, not a wipe. */
const FLIP_BOOK_CREASE = "rgba(0,0,0,0.45)";

const DIAGONAL_DRIFT_X_PCT = 0.05; // +/-5% of frame width
const DIAGONAL_DRIFT_Y_PCT = 0.05; // +/-5% of frame height
const DIAGONAL_ZOOM_END = 1.08;

// Rotating a cover-filled frame exposes corners unless the zoom compensates.
// For a w x h frame rotated by theta, the minimum safe scale is
// cos(theta) + (h/w)*sin(theta) (derived for the 1080x1920 frame: ~1.092 at
// 3deg). 1.15 leaves a real margin over that.
const ROTATE_DEG = 3; // 0 -> +/-3 degrees (monotonic, not oscillating -- see below)
const ROTATE_ZOOM_END = 1.15;

const BLUR_PAD_BACKDROP_SCALE = 1.3;
const BLUR_PAD_BLUR_PX = 40;

// Cinematic ease-out curve (fast start, settles gently) instead of a
// mechanical linear ramp -- applied to every effect's interpolate() call.
const MOTION_EASING = Easing.bezier(0.22, 1, 0.36, 1);

// Focus pushes use a gentler ease-in-out instead: a move that has to land on
// a spoken word must still be visibly travelling as the word arrives. See
// computeFocusTransform.
const FOCUS_EASING = Easing.bezier(0.4, 0, 0.2, 1);

// Travelling between two focus targets further apart than this (normalised
// distance across the picture) eases the zoom back on the way, so the move
// reads as a camera repositioning rather than a whip-pan.
const TRANSIT_RELIEF_DISTANCE = 0.18;
const TRANSIT_RELIEF_SCALE = 0.82;

// Safety factor applied to the theoretical max crop overflow before letting
// translate use it (leaves a little margin for rounding/anti-aliasing).
const OVERFLOW_SAFETY = 0.85;

/**
 * `object-fit: cover` only leaves crop overflow on ONE axis for any image
 * whose aspect ratio is on the same side of the 1080x1920 frame ratio as the
 * "square-ish" class (0.83-1.2) always is: cover matches height, so there is
 * ~zero vertical margin AT SCALE 1. A drift that assumes generous margin on
 * both axes (as a naive "+/-4% of width/height" would) blows past that
 * margin and exposes a black band from the AbsoluteFill behind it -- worst
 * at frame 0, where scale is still 1 and overflow is still 0.
 *
 * Fix: clamp translate on a given axis to the crop overflow actually
 * available AT THE CURRENT SCALE on that axis. This is a no-op for
 * landscape/pan (huge horizontal overflow there) and only bites for the
 * square-ish/diagonal case, where it prevents ever exceeding the real crop
 * margin -- still a pure function of frame, still deterministic.
 */
function clampToAxisOverflow(desiredPx: number, scale: number, dimension: number): number {
  const overflowPx = Math.max(scale - 1, 0) * (dimension / 2) * OVERFLOW_SAFETY;
  return Math.max(Math.min(desiredPx, overflowPx), -overflowPx);
}

/**
 * An aimed push toward a `focus_object` point, instead of the generic
 * centre-out zoom.
 *
 * Why translate rather than `transform-origin`: scaling ABOUT the focus point
 * only makes the subject bigger where they already are -- someone standing at
 * the left edge stays at the left edge. To actually bring them to the middle
 * of frame you have to move the image. So origin stays `center center` and
 * the framing is done by translate:
 *
 *   a point at normalised position p lands at 0.5 + s*(p - 0.5) + t/size,
 *   so t = -s*(p - 0.5)*size puts it dead centre.
 *
 * That ideal is usually unreachable, so the translate is clamped to what can
 * move without uncovering the frame (see clampToCoverableOverflow below). The
 * subject ends up large and as centred as the picture allows, and no edge --
 * blurred sliver or black band -- ever drifts into view.
 *
 * `drawnW`/`drawnH` are the size the image is actually PAINTED at, which is
 * not the frame size and not the file's pixel size:
 *   - cover      -> file dimensions x max(frameW/w, frameH/h)  (>= frame, one axis equal)
 *   - blur-pad   -> file dimensions x min(frameW/w, frameH/h)  (<= frame, one axis equal)
 * Using them for both the aim and the clamp is what makes one formula serve
 * both layouts. focus.x/y are normalised against the picture, so they must be
 * multiplied by the painted size -- against the frame size instead, a
 * blur-padded shot aims past its subject by the letterbox margin, and the
 * clamp lets the image edge slide into view (a blurred sliver down one side).
 * An axis whose painted extent doesn't exceed the frame gets no translate at
 * all, which is what keeps blur-pad's bands even.
 *
 * Starts at scale 1 so the shot establishes context before closing in, which
 * is what makes the move read as deliberate rather than as a crop.
 *
 * Pure function of its arguments -- the vision that produced `focus` ran at
 * BUILD time, not here.
 */
function computeFocusTransform(
  focus: FocusPoint[],
  frame: number,
  durationInFrames: number,
  drawnW: number,
  drawnH: number,
  frameW: number,
  frameH: number,
): string {
  const endFrame = Math.max(durationInFrames - 1, 1);

  // Keyframes: start wide on the first subject, then land on each target in
  // turn. Each move ENDS on its own cue frame and holds until the next one
  // starts travelling, so every subject is at rest exactly as they're named.
  const stops: Array<{ f: number; x: number; y: number; s: number }> = [
    { f: 0, x: focus[0].x, y: focus[0].y, s: 1 },
  ];

  focus.forEach((t, i) => {
    const f = Math.min(Math.max(t.peakFrame ?? endFrame, 1), endFrame);
    const prev = focus[i - 1];

    // Travelling between two distant subjects at full zoom is a whip-pan, and
    // it reads as a jolt. A real camera pulls back, glides across, pushes
    // back in. This inserts that relief beat at the midpoint -- only when the
    // subjects are actually far apart, so two faces side by side still get a
    // simple, direct move.
    if (prev && Math.hypot(t.x - prev.x, t.y - prev.y) > TRANSIT_RELIEF_DISTANCE) {
      stops.push({
        f: (stops[stops.length - 1].f + f) / 2,
        x: (prev.x + t.x) / 2,
        y: (prev.y + t.y) / 2,
        s: Math.max(Math.min(prev.scale, t.scale) * TRANSIT_RELIEF_SCALE, 1),
      });
    }

    stops.push({ f, x: t.x, y: t.y, s: Math.max(t.scale, 1) });
  });

  // interpolate() requires a strictly increasing input range; cues that land
  // on the same frame (or out of order) would otherwise throw mid-render.
  for (let i = 1; i < stops.length; i += 1) {
    if (stops[i].f <= stops[i - 1].f) stops[i].f = stops[i - 1].f + 1;
  }

  // NOT the house MOTION_EASING here. That curve is a hard ease-out: it is
  // ~93% of the way there by the halfway point, which is right for an ambient
  // Ken-Burns drift but wrong for a move that has to LAND on a word -- the eye
  // reads the arrival a third of the way in and the cue passes unmarked. This
  // gentler ease-in-out keeps the travel spread across the run-up so the
  // arrival coincides with the beat, and makes each leg of a multi-target
  // move ease out of one subject and into the next instead of jerking.
  const ramp = {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: FOCUS_EASING,
  } as const;

  const frames = stops.map((k) => k.f);
  const scale = interpolate(frame, frames, stops.map((k) => k.s), ramp);

  // The AIM is interpolated too, not just the zoom. Interpolating the focus
  // point and deriving the transform from it (rather than interpolating two
  // finished transforms) is what keeps the subject glued to the middle of the
  // travel instead of sliding through it.
  const focusX = interpolate(frame, frames, stops.map((k) => k.x), ramp);
  const focusY = interpolate(frame, frames, stops.map((k) => k.y), ramp);

  // What may move is bounded by whichever is SMALLER: the painted picture or
  // the element box that clips it.
  //   blur-pad -> painted < frame, the picture itself runs out first
  //   cover    -> the element is only frame-sized (width/height: 100%) and
  //               clips the overflow, so the frame runs out first
  // Taking the painted size in the cover case permits a translate past the
  // point where a frame-sized element still covers the frame, and the
  // AbsoluteFill behind it shows as a black band down one edge. Verified: it
  // did exactly that before this min().
  const clampToCoverableOverflow = (desiredPx: number, painted: number, frameExtent: number) => {
    const movable = Math.min(painted, frameExtent);
    const maxPx = (Math.max(movable * scale - frameExtent, 0) / 2) * OVERFLOW_SAFETY;
    return Math.max(Math.min(desiredPx, maxPx), -maxPx);
  };

  const x = clampToCoverableOverflow(-scale * (focusX - 0.5) * drawnW, drawnW, frameW);
  const y = clampToCoverableOverflow(-scale * (focusY - 0.5) * drawnH, drawnH, frameH);

  return `translate(${x}px, ${y}px) scale(${scale})`;
}

/**
 * Computes the CSS transform for a given effect at a given local frame.
 * Pure function of (effect, direction, zoomVariant, frame, durationInFrames,
 * width, height) -- no randomness, no external state. Every ramp uses
 * MOTION_EASING (ease-out) instead of a linear interpolation for a more
 * cinematic, less mechanical feel.
 *
 * `clampToOverflow` should be true when the media is laid out with
 * `object-fit: cover` (there IS a hard crop edge to respect) and false when
 * laid out with `object-fit: contain` over its own blurred backdrop (any
 * drift just reveals more backdrop, never black -- no clamp needed).
 */
/**
 * The scale a "zoom" effect is at on this frame. Split out of
 * `computeTransform` so the blurred backdrop can be driven by the SAME number
 * the foreground uses -- the author's rule is that zoom_in/zoom_out move the
 * blur layer too ("ca zoom_in va zoom_out se deu tac dong ca phan blur do"),
 * and a backdrop left at a fixed scale while the picture grows reads as the
 * photo sliding off its own background.
 */
function computeZoomScale(
  zoomVariant: ZoomVariant,
  frame: number,
  durationInFrames: number,
  zoomTo: number = ZOOM_END,
): number {
  const endFrame = Math.max(durationInFrames - 1, 1);
  const end = Math.min(Math.max(zoomTo, 1), ZOOM_MAX);
  const [from, to] = zoomVariant === "out" ? [end, 1] : [1, end];
  return interpolate(frame, [0, endFrame], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: MOTION_EASING,
  });
}

function computeTransform(
  effect: Effect,
  direction: Direction,
  zoomVariant: ZoomVariant,
  frame: number,
  durationInFrames: number,
  width: number,
  height: number,
  clampToOverflow: boolean,
  zoomTo: number = ZOOM_END,
): string {
  // Last frame index used as the end of the interpolation range. Guard
  // against durationInFrames <= 1 to avoid a degenerate [0, 0] range.
  const endFrame = Math.max(durationInFrames - 1, 1);
  const sign = direction === "left" ? 1 : -1;
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: MOTION_EASING } as const;

  if (effect === "zoom") {
    // "in" (default): push, 100%->112%. "out": pull, 112%->100% -- push/pull
    // alternation across consecutive portrait scenes (see build-spec.mjs).
    // `zoomTo` is the ZOOMED end in both variants; zoomVariant only says
    // which end of the shot it belongs to. That is what makes `zoom_in: 50%`
    // and `zoom_out: 50%` a symmetrical pair rather than a coincidence.
    return `scale(${computeZoomScale(zoomVariant, frame, durationInFrames, zoomTo)})`;
  }

  if (effect === "pan") {
    const scale = interpolate(frame, [0, endFrame], [1, PAN_ZOOM_END], clamp);
    const driftPx = width * PAN_DRIFT_PCT;
    const desiredX = interpolate(frame, [0, endFrame], [sign * driftPx, -sign * driftPx], clamp);
    const x = clampToOverflow ? clampToAxisOverflow(desiredX, scale, width) : desiredX;
    return `translate(${x}px, 0px) scale(${scale})`;
  }

  if (effect === "diagonal") {
    const scale = interpolate(frame, [0, endFrame], [1, DIAGONAL_ZOOM_END], clamp);
    const driftX = width * DIAGONAL_DRIFT_X_PCT;
    const driftY = height * DIAGONAL_DRIFT_Y_PCT;
    const desiredX = interpolate(frame, [0, endFrame], [sign * driftX, -sign * driftX], clamp);
    const desiredY = interpolate(frame, [0, endFrame], [sign * driftY, -sign * driftY], clamp);
    const x = clampToOverflow ? clampToAxisOverflow(desiredX, scale, width) : desiredX;
    const y = clampToOverflow ? clampToAxisOverflow(desiredY, scale, height) : desiredY;
    return `translate(${x}px, ${y}px) scale(${scale})`;
  }

  if (effect === "rotate") {
    // Monotonic 0 -> +/-ROTATE_DEG together with 1 -> ROTATE_ZOOM_END (NOT
    // an oscillating +/- like pan/diagonal): the zoom must already be large
    // enough to cover the frame at whatever angle is reached so far, and
    // that only holds if both start together at (0deg, scale 1) and grow
    // in lockstep -- see the ROTATE_ZOOM_END derivation above.
    const scale = interpolate(frame, [0, endFrame], [1, ROTATE_ZOOM_END], clamp);
    const deg = interpolate(frame, [0, endFrame], [0, sign * ROTATE_DEG], clamp);
    // Scale first, then rotate (CSS applies right-to-left) -- matches the
    // geometry the ROTATE_ZOOM_END safety margin was derived against.
    return `rotate(${deg}deg) scale(${scale})`;
  }

  // passthrough: native playback, no synthetic motion added.
  return "none";
}

const FULL_BLEED_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

/**
 * Real Ken Burns pan: sizes the image at its true STATIC cover scale (the
 * scale that makes it exactly touch the frame on the binding axis, computed
 * from its actual natural dimensions -- e.g. a 16:9 photo binds on height,
 * so it's genuinely ~1.78x wider than the 1080px frame). That real width is
 * where the pan traverses; a small extra zoom rides on top for a cosmetic
 * push, but the drift itself is untouched by that zoom, so the traversal
 * range stays true to the source image and doesn't shrink to fit whatever
 * the zoom's own overflow happens to be.
 *
 * (Why this replaced the old approach: `clampToAxisOverflow` bounds translate
 * by the overflow a GIVEN SCALE creates on a 100%-sized element -- at
 * PAN_ZOOM_END=1.08 that's only ~3.4% of frame width, regardless of how wide
 * the source image actually is. That's the right clamp for square-ish
 * diagonal/rotate, where real cover overflow genuinely is near-zero -- but
 * for a landscape photo with ~68% real crop overflow, it left almost all of
 * that overflow unused. Sizing the element at its own true cover scale up
 * front removes that mismatch entirely.)
 */
const PanMedia: React.FC<{
  assetPath: string;
  assetType: AssetType;
  direction: Direction;
  assetWidth: number;
  assetHeight: number;
  durationInFrames: number;
}> = ({ assetPath, assetType, direction, assetWidth, assetHeight, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const endFrame = Math.max(durationInFrames - 1, 1);
  const sign = direction === "left" ? 1 : -1;
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: MOTION_EASING } as const;

  const coverScale0 = Math.max(width / assetWidth, height / assetHeight);
  const scaledW0 = assetWidth * coverScale0;
  const scaledH0 = assetHeight * coverScale0;
  const overflowX0 = Math.max(scaledW0 - width, 0);
  const maxOffsetX = (overflowX0 / 2) * PAN_TRAVERSAL_FRACTION;

  const scale = interpolate(frame, [0, endFrame], [1, PAN_EXTRA_ZOOM_END], clamp);
  const x = interpolate(frame, [0, endFrame], [sign * maxOffsetX, -sign * maxOffsetX], clamp);

  const style: CSSProperties = {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: scaledW0,
    height: scaledH0,
    marginLeft: -scaledW0 / 2,
    marginTop: -scaledH0 / 2,
    transform: `translate(${x}px, 0px) scale(${scale})`,
    transformOrigin: "center center",
    objectFit: "cover",
  };

  const src = staticFile(assetPath);
  if (assetType === "video") {
    return <MediaVideo src={src} style={style} objectFit="cover" loop muted />;
  }
  return <Img src={src} style={style} />;
};

/**
 * A slide traverse: a sharp foreground travelling across a STATIONARY blurred
 * backdrop, optionally arriving via an entrance.
 *
 * WHY THIS IS NOT A `computeTransform` BRANCH (most effects are):
 * `computeTransform`'s output lands on a frame-sized element with
 * `object-fit: cover`. That element CLIPS the cropped-off sides -- the extra
 * image content is not in the box, so translating the box does not reveal it,
 * it drags the AbsoluteFill behind into view as a black band down one edge.
 * That happened, was measured, and was fixed once already; the clamp that now
 * prevents it bounds travel to `(scale - 1) * dimension / 2`, a few percent of
 * frame width -- nowhere near a traverse. So, exactly as `PanMedia` does, this
 * sizes the media element at real painted dimensions and translates across it.
 *
 * THE LAYER MODEL. The backdrop is its own layer and does NOT move with the
 * foreground:
 *   - along the travel axis the foreground is wider than the frame, so no band
 *     is ever slid past ("lia sang phai thi phan blur ben trai cung phai mat di")
 *   - across the perpendicular axis it is deliberately SHORTER, so the familiar
 *     blur band shows there
 *   - an anchor's zoom enlarges the foreground only, leaving the backdrop put
 *     ("zoom dien ra trong anh thoi, dung zoom lop blur")
 * `foregroundScale` is chosen at build time to satisfy both, and is shipped
 * rather than recomputed so the inset->position conversion and the render agree
 * by construction.
 *
 * Pure function of the local frame -- no randomness, no external state.
 */
const LayeredMedia: React.FC<{
  assetPath: string;
  assetType: AssetType;
  slide: SlideSpec;
  entrance?: EntranceSpec;
  zoomTo?: number;
  zoomVariant?: ZoomVariant;
  assetWidth: number;
  assetHeight: number;
  durationInFrames: number;
}> = ({ assetPath, assetType, slide, entrance, zoomTo, zoomVariant, assetWidth, assetHeight, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const endFrame = Math.max(durationInFrames - 1, 1);
  const horizontal = slide.axis !== "y";

  const paintedW = assetWidth * slide.foregroundScale;
  const paintedH = assetHeight * slide.foregroundScale;

  // An anchor is unreachable without a zoom: there is no slack to shift into
  // until the picture is enlarged. The push opens the shot and then holds,
  // leaving the rest of the run to the travel itself.
  const hasAnchor = typeof slide.anchorPos === "number";
  const anchorZoom = hasAnchor
    ? interpolate(
        frame,
        [0, Math.max(endFrame * SLIDE_ANCHOR_RAMP, 1)],
        [1, Math.max(slide.anchorScale ?? 1.3, 1)],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: MOTION_EASING },
      )
    : 1;
  // A zoom tag COMPOSES with a slide instead of conflicting with it -- the
  // author writes `zoom_in 20% | slide_left_right` meaning a traverse that also
  // closes in. The two ramps multiply: the anchor push opens the shot, the zoom
  // runs its whole length.
  const tagZoom =
    zoomTo !== undefined ? computeZoomScale(zoomVariant ?? "in", frame, durationInFrames, zoomTo) : 1;
  const scale = anchorZoom * tagZoom;

  // Position of the frame along the picture: 0 = leading edges flush,
  // 1 = trailing edges flush.
  const p = interpolate(frame, [0, endFrame], [slide.from, slide.to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: SLIDE_EASING,
  });

  const overflow = (painted: number, frameExtent: number) =>
    (Math.max(painted * scale - frameExtent, 0) / 2) * SLIDE_TRAVERSAL_SAFETY;

  // p = 0 must show the LEADING side of the picture, which means translating
  // the element the other way -- hence (1 - 2p), running +max -> -max.
  const travel = overflow(horizontal ? paintedW : paintedH, horizontal ? width : height) * (1 - 2 * p);

  // The anchor acts on the axis PERPENDICULAR to travel.
  const crossMax = overflow(horizontal ? paintedH : paintedW, horizontal ? height : width);
  const crossDesired = hasAnchor
    ? -scale * (slide.anchorPos! - 0.5) * (horizontal ? paintedH : paintedW)
    : 0;
  const cross = Math.max(Math.min(crossDesired, crossMax), -crossMax);

  let x = horizontal ? travel : cross;
  let y = horizontal ? cross : travel;

  // The entrance rides ON TOP of the resting position, so the picture arrives
  // where the traverse wants to begin instead of snapping there afterwards.
  // The backdrop is untouched -- it is already on screen when the shot starts.
  let clipPath: string | undefined;
  let creaseT: number | undefined;
  if (entrance) {
    const t = interpolate(frame, [0, Math.max(entrance.durationInFrames, 1)], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: entrance.type === "flip_book" ? FLIP_BOOK_EASING : SLIDE_IN_EASING,
    });
    if (entrance.type === "slide_in") {
      // Position that just clears the frame: half the picture plus half the
      // frame from centre.
      const clearance = horizontal ? (width + paintedW) / 2 : (height + paintedH) / 2;
      const sign = entrance.fromSide === "right" || entrance.fromSide === "bottom" ? 1 : -1;
      // Interpolate BETWEEN the off-frame position and where the traverse wants
      // to begin -- do not add an offset on top of it. The traverse already
      // starts with the picture pushed hard to one side, so adding pushed it
      // twice as far and it spent most of the entrance out of sight entirely.
      // (Measured: nothing but backdrop for the first third of the shot.)
      const rest = horizontal ? x : y;
      const arrived = rest + (1 - t) * (sign * clearance - rest);
      if (horizontal) x = arrived;
      else y = arrived;
    } else {
      clipPath = flipBookClipPath(t);
      if (t < 1) creaseT = t;
    }
  }

  const src = staticFile(assetPath);
  const backdropStyle: CSSProperties = {
    ...FULL_BLEED_STYLE,
    transform: `scale(${BLUR_PAD_BACKDROP_SCALE})`,
    transformOrigin: "center center",
    filter: `blur(${BLUR_PAD_BLUR_PX}px)`,
  };
  const foregroundStyle: CSSProperties = {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: paintedW,
    height: paintedH,
    marginLeft: -paintedW / 2,
    marginTop: -paintedH / 2,
    transform: `translate(${x}px, ${y}px) scale(${scale})`,
    transformOrigin: "center center",
    objectFit: "cover",
    ...(clipPath ? { clipPath } : {}),
  };

  const isVideo = assetType === "video";
  return (
    <AbsoluteFill>
      {isVideo ? (
        <MediaVideo src={src} style={backdropStyle} objectFit="cover" loop muted />
      ) : (
        <Img src={src} style={{ ...backdropStyle, objectFit: "cover" }} />
      )}
      {isVideo ? (
        <MediaVideo src={src} style={foregroundStyle} objectFit="cover" loop muted />
      ) : (
        <Img src={src} style={foregroundStyle} />
      )}
      {creaseT !== undefined ? (
        <AbsoluteFill
          style={{
            clipPath: flipBookClipPath(creaseT),
            // 135deg runs top-left -> bottom-right, the same axis the fold
            // sweeps along, so the dark band sits exactly on the moving edge.
            background: `linear-gradient(135deg, transparent ${(creaseT * 100 - 7).toFixed(2)}%, ${FLIP_BOOK_CREASE} ${(creaseT * 100).toFixed(2)}%, transparent ${(creaseT * 100 + 1).toFixed(2)}%)`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

const CoverMedia: React.FC<{
  assetPath: string;
  assetType: AssetType;
  effect: Effect;
  direction: Direction;
  zoomVariant: ZoomVariant;
  assetWidth?: number;
  assetHeight?: number;
  focus?: FocusPoint[];
  zoomTo?: number;
  durationInFrames: number;
}> = ({ assetPath, assetType, effect, direction, zoomVariant, assetWidth, assetHeight, focus, zoomTo, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // An aimed push outranks the aspect-ratio-chosen effect, including pan.
  const hasFocus = focus && focus.length > 0;

  if (!hasFocus && effect === "pan" && assetWidth && assetHeight) {
    return (
      <PanMedia
        assetPath={assetPath}
        assetType={assetType}
        direction={direction}
        assetWidth={assetWidth}
        assetHeight={assetHeight}
        durationInFrames={durationInFrames}
      />
    );
  }

  // true: this media is object-fit: cover, so there is a real crop edge --
  // clamp translate to the overflow actually available.
  // Painted size under object-fit: cover -- >= the frame on both axes, equal
  // on one. Falls back to the frame itself when dimensions are unknown
  // (video), which is the cover box minus the off-frame overflow.
  const coverScale =
    assetWidth && assetHeight ? Math.max(width / assetWidth, height / assetHeight) : 0;
  const paintedW = coverScale ? assetWidth! * coverScale : width;
  const paintedH = coverScale ? assetHeight! * coverScale : height;

  const transform = hasFocus
    ? computeFocusTransform(focus!, frame, durationInFrames, paintedW, paintedH, width, height)
    : computeTransform(effect, direction, zoomVariant, frame, durationInFrames, width, height, true, zoomTo);
  const src = staticFile(assetPath);

  const style: CSSProperties = {
    ...FULL_BLEED_STYLE,
    transform,
    transformOrigin: "center center",
  };

  if (assetType === "video") {
    // loop: fills the remaining Sequence duration if the source clip is
    // shorter. If the source clip is longer than the Sequence's
    // durationInFrames, the enclosing <Sequence> clips playback for us --
    // i.e. "trim if longer" falls out of normal Sequence semantics.
    // objectFit is a dedicated prop on @remotion/media's <Video> (not part
    // of `style`) -- passing it via style logs a deprecation warning.
    // muted: this plugin's audio model is narration + BGM only (see design
    // spec §D/§E) -- a source video's own embedded audio (ambient noise,
    // interview room tone) is not one of the two intentional audio layers,
    // so it's muted by default rather than leaking under the narration.
    return <MediaVideo src={src} style={style} objectFit="cover" loop muted />;
  }

  return <Img src={src} style={{ ...style, objectFit: "cover" }} />;
};

const ContainBlurPad: React.FC<{
  assetPath: string;
  assetType: AssetType;
  effect: Effect;
  direction: Direction;
  zoomVariant: ZoomVariant;
  focus?: FocusPoint[];
  zoomTo?: number;
  assetWidth?: number;
  assetHeight?: number;
  durationInFrames: number;
}> = ({ assetPath, assetType, effect, direction, zoomVariant, focus, zoomTo, assetWidth, assetHeight, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  // false: the foreground here is object-fit: contain over its own blurred
  // backdrop, so drift never exposes black -- only more backdrop. No clamp
  // needed.
  // Painted size under object-fit: contain -- <= the frame on both axes, so
  // the letterbox bands this layout exists to produce are part of the
  // geometry the focus math has to respect.
  const containScale =
    assetWidth && assetHeight ? Math.min(width / assetWidth, height / assetHeight) : 0;
  const paintedW = containScale ? assetWidth! * containScale : width;
  const paintedH = containScale ? assetHeight! * containScale : height;

  const transform = focus && focus.length > 0
    ? computeFocusTransform(focus, frame, durationInFrames, paintedW, paintedH, width, height)
    : effect === "passthrough"
      ? "none"
      : computeTransform(effect, direction, zoomVariant, frame, durationInFrames, width, height, false, zoomTo);
  const src = staticFile(assetPath);
  const isVideo = assetType === "video";

  // The blur layer zooms WITH a zoom_in/zoom_out (but not with anything else:
  // pan/diagonal/rotate drift the picture over a backdrop that stays put, and
  // an aimed focus push deliberately leaves it alone too).
  const backdropZoom =
    effect === "zoom" && !(focus && focus.length > 0)
      ? computeZoomScale(zoomVariant, frame, durationInFrames, zoomTo)
      : 1;

  const backdropStyle: CSSProperties = {
    ...FULL_BLEED_STYLE,
    transform: `scale(${BLUR_PAD_BACKDROP_SCALE * backdropZoom})`,
    transformOrigin: "center center",
    filter: `blur(${BLUR_PAD_BLUR_PX}px)`,
  };

  const foregroundStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    transform,
    transformOrigin: "center center",
  };

  return (
    <AbsoluteFill>
      {isVideo ? (
        <MediaVideo src={src} style={backdropStyle} objectFit="cover" loop muted />
      ) : (
        <Img src={src} style={{ ...backdropStyle, objectFit: "cover" }} />
      )}
      <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        {isVideo ? (
          <MediaVideo src={src} style={foregroundStyle} objectFit="contain" loop muted />
        ) : (
          <Img src={src} style={{ ...foregroundStyle, objectFit: "contain" }} />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Scene: React.FC<SceneProps> = ({
  assetPath,
  assetType,
  effect,
  direction,
  zoomVariant,
  fit,
  assetWidth,
  assetHeight,
  focus,
  zoomTo,
  slide,
  entrance,
  durationInFrames,
}) => {
  const resolvedDirection: Direction = direction ?? "left";
  const resolvedZoomVariant: ZoomVariant = zoomVariant ?? "in";
  const hasFocus = focus !== undefined && focus.length > 0;

  // A slide ignores `fit` on purpose: it sizes the picture to cover the frame
  // on its axis of travel, which is what keeps a blurred band from being slid
  // past. Falls through to the normal paths without dimensions (an older
  // spec.json, or a video we couldn't probe), which degrade rather than break.
  // `focus` still outranks it, matching the precedence in tags/README.md.
  // `slide` present is the signal for the layered path, not `effect` -- an
  // entrance-only shot (flip_book with no traverse) ships a degenerate slide
  // (from === to) so one component serves both, rather than teaching the cover
  // and blur-pad paths about entrances as well.
  if (slide && assetWidth && assetHeight && !hasFocus) {
    return (
      <LayeredMedia
        assetPath={assetPath}
        assetType={assetType}
        slide={slide}
        entrance={entrance}
        zoomTo={zoomTo}
        zoomVariant={zoomVariant}
        assetWidth={assetWidth}
        assetHeight={assetHeight}
        durationInFrames={durationInFrames}
      />
    );
  }

  if (fit === "contain-blur-pad") {
    return (
      <ContainBlurPad
        assetPath={assetPath}
        assetType={assetType}
        effect={effect}
        direction={resolvedDirection}
        zoomVariant={resolvedZoomVariant}
        focus={focus}
        zoomTo={zoomTo}
        assetWidth={assetWidth}
        assetHeight={assetHeight}
        durationInFrames={durationInFrames}
      />
    );
  }

  return (
    <CoverMedia
      assetPath={assetPath}
      assetType={assetType}
      effect={effect}
      direction={resolvedDirection}
      zoomVariant={resolvedZoomVariant}
      assetWidth={assetWidth}
      assetHeight={assetHeight}
      focus={focus}
      zoomTo={zoomTo}
      durationInFrames={durationInFrames}
    />
  );
};
