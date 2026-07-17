import React from "react";
import type { CSSProperties } from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Video as MediaVideo } from "@remotion/media";
import type { AssetType, Direction, Effect, Fit } from "./spec-types";

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
  fit: Fit;
  durationInFrames: number;
}

const PAN_DRIFT_PCT = 0.06; // +/-6% of frame width
const PAN_ZOOM_END = 1.08;

const ZOOM_END = 1.12;

const DIAGONAL_DRIFT_X_PCT = 0.04; // +/-4% of frame width
const DIAGONAL_DRIFT_Y_PCT = 0.04; // +/-4% of frame height
const DIAGONAL_ZOOM_END = 1.06;

const BLUR_PAD_BACKDROP_SCALE = 1.3;
const BLUR_PAD_BLUR_PX = 40;

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
 * Computes the CSS transform for a given effect at a given local frame.
 * Pure function of (effect, direction, frame, durationInFrames, width, height) --
 * no randomness, no external state.
 *
 * `clampToOverflow` should be true when the media is laid out with
 * `object-fit: cover` (there IS a hard crop edge to respect) and false when
 * laid out with `object-fit: contain` over its own blurred backdrop (any
 * drift just reveals more backdrop, never black -- no clamp needed).
 */
function computeTransform(
  effect: Effect,
  direction: Direction,
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
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  if (effect === "zoom") {
    const scale = interpolate(frame, [0, endFrame], [1, ZOOM_END], clamp);
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

  // passthrough: native playback, no synthetic motion added.
  return "none";
}

const FULL_BLEED_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

const CoverMedia: React.FC<{
  assetPath: string;
  assetType: AssetType;
  effect: Effect;
  direction: Direction;
  durationInFrames: number;
}> = ({ assetPath, assetType, effect, direction, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  // true: this media is object-fit: cover, so there is a real crop edge --
  // clamp translate to the overflow actually available.
  const transform = computeTransform(effect, direction, frame, durationInFrames, width, height, true);
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
  durationInFrames: number;
}> = ({ assetPath, assetType, effect, direction, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  // false: the foreground here is object-fit: contain over its own blurred
  // backdrop, so drift never exposes black -- only more backdrop. No clamp
  // needed.
  const transform =
    effect === "passthrough"
      ? "none"
      : computeTransform(effect, direction, frame, durationInFrames, width, height, false);
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

export const Scene: React.FC<SceneProps> = ({ assetPath, assetType, effect, direction, fit, durationInFrames }) => {
  const resolvedDirection: Direction = direction ?? "left";

  if (fit === "contain-blur-pad") {
    return (
      <ContainBlurPad
        assetPath={assetPath}
        assetType={assetType}
        effect={effect}
        direction={resolvedDirection}
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
      durationInFrames={durationInFrames}
    />
  );
};
