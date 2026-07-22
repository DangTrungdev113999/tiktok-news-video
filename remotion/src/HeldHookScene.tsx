import React from "react";
import type { CSSProperties } from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Video as MediaVideo } from "@remotion/media";
import type { AssetType } from "./spec-types";

/**
 * The top-half image for a HELD-HOOK scene (see spec-types' `heldHook`).
 *
 * While the branded hook card is pinned in the bottom half, the scene's own
 * image occupies the top region above it. This does NOT reuse <Scene>: Scene's
 * fit and motion math is written against `useVideoConfig()` (the full
 * 1080x1920 frame), so dropping it into a half-height box would place the
 * picture and its blur pad against the wrong dimensions. Here the fit is done
 * with plain CSS `object-fit` relative to THIS box, so it is correct at any
 * height the caller gives it.
 *
 * The author asked for the image FITTED, not cropped ("fit gọn, không cắt"),
 * so the foreground is `contain`; a scaled-up, blurred copy of the same image
 * fills the letterbox behind it (the same blur-pad idea Scene uses, just at
 * box scale). A slow zoom keeps it from reading as a frozen still.
 *
 * This renders OVER the real hook card. Its box background is transparent and
 * its bottom edge fades out (mask), so the image blends into the card's bloom
 * instead of meeting the orange at a hard line -- the same soft transition the
 * hook scene gets from the cover's own mask.
 *
 * `heightPx` is the top region's height in composition pixels -- set by the
 * caller to end above the card's badge.
 */
export interface HeldHookSceneProps {
  assetPath: string;
  assetType?: AssetType;
  heightPx: number;
  durationInFrames: number;
}

const BACKDROP_BLUR_PX = 26;
const BACKDROP_SCALE = 1.25;

export const HeldHookScene: React.FC<HeldHookSceneProps> = ({
  assetPath,
  assetType,
  heightPx,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();

  // Gentle Ken-Burns push so the held image is alive, not frozen. Kept small
  // (2%) because it sits under a static headline -- a big move would fight it.
  const zoom = interpolate(frame, [0, Math.max(durationInFrames, 1)], [1.0, 1.02], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const src = staticFile(assetPath);
  const isVideo = assetType === "video";

  const boxStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    width: 1080,
    height: heightPx,
    overflow: "hidden",
    // Fade the bottom edge so the image dissolves into the hook card's bloom
    // rather than ending on a hard rectangle line.
    WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 74%, transparent 100%)",
    maskImage: "linear-gradient(to bottom, black 0%, black 74%, transparent 100%)",
  };

  const backdropStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: `scale(${(BACKDROP_SCALE * zoom).toFixed(4)})`,
    transformOrigin: "center center",
    filter: `blur(${BACKDROP_BLUR_PX}px)`,
  };

  const foregroundStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    transform: `scale(${zoom.toFixed(4)})`,
    transformOrigin: "center center",
  };

  return (
    <AbsoluteFill>
      <div style={boxStyle}>
        {isVideo ? (
          <>
            <MediaVideo src={src} style={backdropStyle} objectFit="cover" loop muted />
            <MediaVideo src={src} style={foregroundStyle} objectFit="contain" loop muted />
          </>
        ) : (
          <>
            <Img src={src} style={backdropStyle} />
            <Img src={src} style={foregroundStyle} />
          </>
        )}
      </div>
    </AbsoluteFill>
  );
};
