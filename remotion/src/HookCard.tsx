import React from "react";
import type { CSSProperties } from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { loadFont } from "@remotion/google-fonts/Baloo2";
import type { BrandKit } from "./spec-types";

/**
 * Overlay rendered ONLY on top of the hook/cover scene (spec.scenes[i].isHook)
 * -- a bottom-anchored gradient card (brand asset) + a coded brand badge +
 * an ALL-CAPS headline, so the hook scene doubles as a strong static
 * "thumbnail" frame the same way a punchy feed-preview card does.
 * Deliberately does NOT render any host-app UI chrome (search bar, play
 * button, progress bar) -- those belong to whatever app plays the finished
 * video back, not to the video itself.
 *
 * `hookBgPath` (720x1280, exactly 9:16) is rendered at FULL FRAME size (no
 * cropping needed -- its aspect already matches 1080x1920) with a CSS mask
 * gradient fading its own top edge to transparent. That mask, layered on top
 * of the asset's own baked-in cream->orange gradient, is what makes the card
 * bloom out of the photo instead of meeting it at a hard rectangle edge. The
 * mask is tuned so the tinted region covers roughly the bottom HALF of the
 * frame, not more (2026-07-18: was too tall, pushed the whole transition
 * down).
 *
 * The brand badge is coded here rather than compositing a flat logo image --
 * a flush-left ribbon (flat left edge, rounded right end) reads more
 * intentional than a floating pill. Badge text and every color below come
 * from the resolved BrandKit (one brand folder's brand.json, see
 * scripts/brand-kit.mjs) so each channel can look genuinely different, not
 * just show a different background photo.
 */
export interface HookCardProps {
  headline: string;
  brandKit: BrandKit;
}

const { fontFamily: headlineFont } = loadFont("normal", { weights: ["800"], subsets: ["vietnamese", "latin"] });

// Tinted region ~ bottom half of the frame: fully transparent through 44%,
// ramps to fully opaque by 60%, solid from there to the bottom.
const bgMaskStyle: CSSProperties = {
  WebkitMaskImage:
    "linear-gradient(to bottom, transparent 0%, transparent 44%, rgba(0,0,0,0.4) 52%, black 60%, black 100%)",
  maskImage:
    "linear-gradient(to bottom, transparent 0%, transparent 44%, rgba(0,0,0,0.4) 52%, black 60%, black 100%)",
};

const badgeIconStyle: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: "50%",
  border: "3px solid rgba(255,255,255,0.92)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

export const HookCard: React.FC<HookCardProps> = ({ headline, brandKit }) => {
  const badgeStyle: CSSProperties = {
    position: "absolute",
    top: 1132,
    left: 0,
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "16px 34px 16px 24px",
    background: `linear-gradient(135deg, ${brandKit.badgeGradient[0]} 0%, ${brandKit.badgeGradient[1]} 55%, ${brandKit.badgeGradient[2]} 100%)`,
    borderRadius: "0 999px 999px 0",
    boxShadow: `0 14px 28px ${brandKit.badgeShadow}`,
  };

  const badgeLabelStyle: CSSProperties = {
    fontFamily: headlineFont,
    fontWeight: 800,
    fontSize: 30,
    letterSpacing: 0.8,
    color: "#FFFFFF",
    textTransform: "uppercase",
    textShadow: "0 2px 0 rgba(0,0,0,0.18)",
    whiteSpace: "nowrap",
  };

  const headlineBaseStyle: CSSProperties = {
    position: "absolute",
    top: 1262,
    left: 48,
    right: 60,
    fontFamily: headlineFont,
    fontWeight: 800,
    fontSize: 74,
    lineHeight: 1.36,
    letterSpacing: 0.4,
    color: "#FFF8EC",
    WebkitTextStroke: `1.5px ${brandKit.headlineStroke}`,
    textShadow: [
      `0 2px 0 ${brandKit.headlineShadow[0]}`,
      `0 4px 0 ${brandKit.headlineShadow[1]}`,
      `0 6px 0 ${brandKit.headlineShadow[2]}`,
      "0 12px 22px rgba(60,20,0,0.45)",
    ].join(", "),
    textTransform: "uppercase",
  };

  return (
    <AbsoluteFill>
      <Img
        src={staticFile(brandKit.hookBgPath)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          ...bgMaskStyle,
        }}
      />
      <div style={badgeStyle}>
        <div style={badgeIconStyle}>
          <span style={{ color: "#FFFFFF", fontWeight: 800, fontSize: 20, fontFamily: headlineFont }}>©</span>
        </div>
        <span style={badgeLabelStyle}>{brandKit.badgeLabel}</span>
      </div>
      <div style={headlineBaseStyle}>{headline}</div>
    </AbsoluteFill>
  );
};
