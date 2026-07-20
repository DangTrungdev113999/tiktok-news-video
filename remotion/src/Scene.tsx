import React from "react";
import type { CSSProperties } from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Video as MediaVideo } from "@remotion/media";
import type { AssetType, Direction, Effect, Fit, FocusPoint, ZoomVariant } from "./spec-types";

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
  /** From a `focus_object:` tag. When present it replaces the effect with an aimed push. */
  focus?: FocusPoint;
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
 * That ideal is usually unreachable, so the translate is clamped to what the
 * picture can actually give on each axis: at most half of however much the
 * drawn image overflows the frame at the current scale. The subject ends up
 * large and as centred as the picture allows, and the image edge never drifts
 * inside the frame.
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
  focus: FocusPoint,
  frame: number,
  durationInFrames: number,
  drawnW: number,
  drawnH: number,
  frameW: number,
  frameH: number,
): string {
  const endFrame = Math.max(durationInFrames - 1, 1);
  const targetScale = Math.max(focus.scale, 1);
  const scale = interpolate(frame, [0, endFrame], [1, targetScale], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: MOTION_EASING,
  });

  const clampToPaintedOverflow = (desiredPx: number, painted: number, frameExtent: number) => {
    const maxPx = (Math.max(painted * scale - frameExtent, 0) / 2) * OVERFLOW_SAFETY;
    return Math.max(Math.min(desiredPx, maxPx), -maxPx);
  };

  const x = clampToPaintedOverflow(-scale * (focus.x - 0.5) * drawnW, drawnW, frameW);
  const y = clampToPaintedOverflow(-scale * (focus.y - 0.5) * drawnH, drawnH, frameH);

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
function computeTransform(
  effect: Effect,
  direction: Direction,
  zoomVariant: ZoomVariant,
  frame: number,
  durationInFrames: number,
  width: number,
  height: number,
  clampToOverflow: boolean,
): string {
  // Last frame index used as the end of the interpolation range. Guard
  // against durationInFrames <= 1 to avoid a degenerate [0, 0] range.
  const endFrame = Math.max(durationInFrames - 1, 1);
  const sign = direction === "left" ? 1 : -1;
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: MOTION_EASING } as const;

  if (effect === "zoom") {
    // "in" (default): push, 100%->112%. "out": pull, 112%->100% -- push/pull
    // alternation across consecutive portrait scenes (see build-spec.mjs).
    const [from, to] = zoomVariant === "out" ? [ZOOM_END, 1] : [1, ZOOM_END];
    const scale = interpolate(frame, [0, endFrame], [from, to], clamp);
    return `scale(${scale})`;
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

const CoverMedia: React.FC<{
  assetPath: string;
  assetType: AssetType;
  effect: Effect;
  direction: Direction;
  zoomVariant: ZoomVariant;
  assetWidth?: number;
  assetHeight?: number;
  focus?: FocusPoint;
  durationInFrames: number;
}> = ({ assetPath, assetType, effect, direction, zoomVariant, assetWidth, assetHeight, focus, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // An aimed push outranks the aspect-ratio-chosen effect, including pan.
  if (!focus && effect === "pan" && assetWidth && assetHeight) {
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

  const transform = focus
    ? computeFocusTransform(focus, frame, durationInFrames, paintedW, paintedH, width, height)
    : computeTransform(effect, direction, zoomVariant, frame, durationInFrames, width, height, true);
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
  focus?: FocusPoint;
  assetWidth?: number;
  assetHeight?: number;
  durationInFrames: number;
}> = ({ assetPath, assetType, effect, direction, zoomVariant, focus, assetWidth, assetHeight, durationInFrames }) => {
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

  const transform = focus
    ? computeFocusTransform(focus, frame, durationInFrames, paintedW, paintedH, width, height)
    : effect === "passthrough"
      ? "none"
      : computeTransform(effect, direction, zoomVariant, frame, durationInFrames, width, height, false);
  const src = staticFile(assetPath);
  const isVideo = assetType === "video";

  const backdropStyle: CSSProperties = {
    ...FULL_BLEED_STYLE,
    transform: `scale(${BLUR_PAD_BACKDROP_SCALE})`,
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
  durationInFrames,
}) => {
  const resolvedDirection: Direction = direction ?? "left";
  const resolvedZoomVariant: ZoomVariant = zoomVariant ?? "in";

  if (fit === "contain-blur-pad") {
    return (
      <ContainBlurPad
        assetPath={assetPath}
        assetType={assetType}
        effect={effect}
        direction={resolvedDirection}
        zoomVariant={resolvedZoomVariant}
        focus={focus}
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
      durationInFrames={durationInFrames}
    />
  );
};
