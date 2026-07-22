import React from "react";
import type { CSSProperties } from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import type { BrandKit } from "./spec-types";
import { BADGE, BRAND_FONT_FAMILY, HEADLINE, fitHeadlineFontSize } from "./layout";

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
 * bloom out of the photo instead of meeting it at a hard rectangle edge.
 *
 * The brand badge is coded here rather than compositing a flat logo image --
 * a flush-left ribbon (flat left edge, rounded right end) reads more
 * intentional than a floating pill. Badge text and every color below come
 * from the resolved BrandKit (one brand folder's brand.json, see
 * scripts/brand-kit.mjs) so each channel can look genuinely different.
 *
 * 2026-07-20: every position and size here now comes from `./layout` (see
 * that file for the measurements behind them) instead of being tuned by eye
 * in this component. Two things changed visibly: the type is Oswald 700
 * (shared with the captions, replacing Baloo2) and the whole badge+headline
 * stack moved up out of TikTok's covered bottom band.
 */
export interface HookCardProps {
  headline: string;
  brandKit: BrandKit;
}

// Tinted region ~ bottom half of the frame: fully transparent through 44%,
// ramps to fully opaque by 60%, solid from there to the bottom.
const bgMaskStyle: CSSProperties = {
  WebkitMaskImage:
    "linear-gradient(to bottom, transparent 0%, transparent 44%, rgba(0,0,0,0.4) 52%, black 60%, black 100%)",
  maskImage:
    "linear-gradient(to bottom, transparent 0%, transparent 44%, rgba(0,0,0,0.4) 52%, black 60%, black 100%)",
};

export const HookCard: React.FC<HookCardProps> = ({ headline, brandKit }) => {
  // Long headlines step down a size rather than growing another line into
  // the badge above them -- see fitHeadlineFontSize.
  const headlineFontSize = fitHeadlineFontSize(headline);

  const badgeStyle: CSSProperties = {
    position: "absolute",
    top: BADGE.top,
    left: 0,
    height: BADGE.height,
    display: "flex",
    alignItems: "center",
    gap: BADGE.gap,
    paddingLeft: BADGE.paddingLeft,
    paddingRight: BADGE.paddingRight,
    background: `linear-gradient(135deg, ${brandKit.badgeGradient[0]} 0%, ${brandKit.badgeGradient[1]} 55%, ${brandKit.badgeGradient[2]} 100%)`,
    borderRadius: "0 999px 999px 0",
    boxShadow: `0 14px 28px ${brandKit.badgeShadow}`,
  };

  // Solid white disc with the brand's darkest gradient stop as the mark,
  // matching the reference badge (the previous outlined-circle mark read as
  // an afterthought at this size).
  //
  // The disc holds the brand's own logo.svg when its folder has one. The `©`
  // below is the fallback, not the design: it used to be hardcoded, which put
  // a copyright symbol on every channel regardless of what the channel was
  // about. Colors below only apply to that fallback glyph.
  const badgeIconStyle: CSSProperties = {
    width: BADGE.iconSize,
    height: BADGE.iconSize,
    borderRadius: "50%",
    background: "#FFFFFF",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontFamily: BRAND_FONT_FAMILY,
    fontWeight: 700,
    fontSize: Math.round(BADGE.iconSize * 0.56),
    lineHeight: 1,
    color: brandKit.badgeGradient[2],
  };

  const badgeLabelStyle: CSSProperties = {
    fontFamily: BRAND_FONT_FAMILY,
    fontWeight: 700,
    fontSize: BADGE.fontSize,
    letterSpacing: BADGE.letterSpacing,
    color: "#FFFFFF",
    textTransform: "uppercase",
    textShadow: "0 2px 0 rgba(0,0,0,0.18)",
    whiteSpace: "nowrap",
  };

  // Bottom-anchored: grows upward as the headline gets longer, so it can
  // never push down into TikTok's covered band. See HEADLINE.bottomInset.
  const headlineStyle: CSSProperties = {
    position: "absolute",
    bottom: HEADLINE.bottomInset,
    left: HEADLINE.left,
    right: HEADLINE.rightInset,
    fontFamily: BRAND_FONT_FAMILY,
    fontWeight: 700,
    fontSize: headlineFontSize,
    lineHeight: HEADLINE.lineHeight,
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
          {brandKit.logoPath ? (
            // Inset so the mark sits inside the disc rather than touching its
            // rim, and `contain` so a wide or tall logo keeps its proportions
            // instead of being squashed to a square.
            <Img
              src={staticFile(brandKit.logoPath)}
              style={{
                width: "78%",
                height: "78%",
                objectFit: "contain",
              }}
            />
          ) : (
            "©"
          )}
        </div>
        <span style={badgeLabelStyle}>{brandKit.badgeLabel}</span>
      </div>
      <div style={headlineStyle}>{headline}</div>
    </AbsoluteFill>
  );
};
