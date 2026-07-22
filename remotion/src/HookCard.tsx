import React from "react";
import type { CSSProperties } from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import type { BrandKit } from "./spec-types";
import { BADGE, BRAND_FONT_FAMILY, DATEPLATE, HEADLINE, fitHeadlineFontSize } from "./layout";

/**
 * "#RRGGBB" + alpha -> "rgba(r,g,b,a)".
 *
 * Needed because every accent below is derived from the brand's OWN
 * badgeGradient rather than from new brand.json keys, and CSS cannot fade a
 * hex string. Deriving instead of adding keys is the point: a new required
 * colour would leave every brand folder already in the field looking broken
 * until someone edited it.
 *
 * Non-hex input (a brand writing "orange", or an 8-digit hex) is returned
 * unchanged rather than throwing -- a wrong-looking tint is a far better
 * failure than a hook card that will not render.
 */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

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
 * It is OPTIONAL. A brand folder with no hook-bg file gets the same masked
 * card filled from `badgeGradient` instead. The file used to be required,
 * which forced two assumptions on every channel that nobody had agreed to:
 * that its cover is a photograph, and that a hook-screen asset is a
 * precondition for the brand existing at all.
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
  /** Resolved by MainVideo so every text overlay shares one family. */
  fontFamily?: string;
  /**
   * Publish date, already formatted ("22/07/2026"). Absent is the normal
   * case: only a brand that set `"hookDate": true` gets the plate.
   */
  hookDate?: string;
}

// Tinted region ~ bottom half of the frame: fully transparent through 44%,
// ramps to fully opaque by 60%, solid from there to the bottom.
const bgMaskStyle: CSSProperties = {
  WebkitMaskImage:
    "linear-gradient(to bottom, transparent 0%, transparent 44%, rgba(0,0,0,0.4) 52%, black 60%, black 100%)",
  maskImage:
    "linear-gradient(to bottom, transparent 0%, transparent 44%, rgba(0,0,0,0.4) 52%, black 60%, black 100%)",
};

export const HookCard: React.FC<HookCardProps> = ({ headline, brandKit, fontFamily, hookDate }) => {
  // Long headlines step down a size rather than growing another line into
  // the badge above them -- see fitHeadlineFontSize.
  const headlineFontSize = fitHeadlineFontSize(headline);

  // The brand's brightest stop. Everything that has to READ as "this
  // channel's colour" -- the chip's keyline, its clock, its date -- is this
  // one value, so a brand changes its whole hook row by editing badgeGradient
  // and nothing else.
  const accent = brandKit.badgeGradient[0];
  const ink = brandKit.badgeGradient[2];

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
    // Four shadows doing four jobs: the brand's own drop shadow, a coloured
    // bloom that makes the ribbon glow against a dark card, a top inner
    // highlight and a bottom inner shade. The last two are what turn a flat
    // swatch into a lit object.
    boxShadow: [
      `0 14px 28px ${brandKit.badgeShadow}`,
      `0 0 52px ${withAlpha(accent, 0.34)}`,
      "inset 0 2px 0 rgba(255,255,255,0.42)",
      "inset 0 -3px 0 rgba(0,0,0,0.22)",
    ].join(", "),
    // Clips the gloss sheet and the skewed tail to the pill's own silhouette.
    overflow: "hidden",
  };

  /** Broadcast gloss: a hard light/shade break just above the middle. */
  const glossStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.09) 45%, rgba(255,255,255,0) 46%, rgba(0,0,0,0.16) 100%)",
  };

  /** Skewed tail at the ribbon's end -- the detail that reads as "channel ID". */
  const tailStyle: CSSProperties = {
    alignSelf: "stretch",
    width: 46,
    marginLeft: 8,
    display: "flex",
    gap: 7,
    transform: "skewX(-16deg)",
    position: "relative",
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
    fontFamily: fontFamily ?? BRAND_FONT_FAMILY,
    fontWeight: 700,
    fontSize: Math.round(BADGE.iconSize * 0.56),
    lineHeight: 1,
    color: brandKit.badgeGradient[2],
    // Sits ON the ribbon rather than being a hole cut in it.
    boxShadow: `0 4px 10px ${withAlpha(ink, 0.45)}`,
    // Above the gloss sheet.
    position: "relative",
  };

  const badgeLabelStyle: CSSProperties = {
    fontFamily: fontFamily ?? BRAND_FONT_FAMILY,
    fontWeight: 700,
    fontSize: BADGE.fontSize,
    letterSpacing: BADGE.letterSpacing,
    color: "#FFFFFF",
    textTransform: "uppercase",
    textShadow: "0 2px 0 rgba(0,0,0,0.26)",
    whiteSpace: "nowrap",
    position: "relative",
  };

  // --- the date plate -----------------------------------------------------
  // Mirrors the badge across the frame: same top, same height, opposite
  // anchor. Dark where the badge is bright, so the pair reads as one row.
  //
  // Bare white type -- no plate, no keyline, no icon. It went through a clock
  // icon plus a time plus a boxed second line before landing here; each of
  // those was furniture around one fact. Legibility over an arbitrary
  // photograph now comes from the shadow stack instead of from a box, which
  // is the same trick the headline uses two hundred pixels below.
  const dateStyle: CSSProperties = {
    position: "absolute",
    top: DATEPLATE.top,
    right: DATEPLATE.rightInset,
    height: DATEPLATE.height,
    display: "flex",
    alignItems: "center",
    fontFamily: fontFamily ?? BRAND_FONT_FAMILY,
    fontWeight: 700,
    fontSize: DATEPLATE.fontSize,
    lineHeight: 1,
    letterSpacing: DATEPLATE.letterSpacing,
    color: "#FFFFFF",
    textShadow: `0 2px 0 ${withAlpha(ink, 0.55)}, 0 4px 18px rgba(0,0,0,0.55)`,
    whiteSpace: "nowrap",
  };

  // Bottom-anchored: grows upward as the headline gets longer, so it can
  // never push down into TikTok's covered band. See HEADLINE.bottomInset.
  const headlineStyle: CSSProperties = {
    position: "absolute",
    bottom: HEADLINE.bottomInset,
    left: HEADLINE.left,
    right: HEADLINE.rightInset,
    fontFamily: fontFamily ?? BRAND_FONT_FAMILY,
    fontWeight: 700,
    fontSize: headlineFontSize,
    lineHeight: HEADLINE.lineHeight,
    letterSpacing: 0.4,
    // Pure white, not the cream it used to be. On an orange card a cream
    // headline reads as pale orange -- the card had no white in it anywhere,
    // so the type had nothing to sit against. White is the one value the
    // brand palette does not contain, which is exactly why it pops.
    color: "#FFFFFF",
    WebkitTextStroke: `${HEADLINE.strokeWidth}px ${brandKit.headlineStroke}`,
    // Without this Chrome paints the stroke ON TOP of the fill, so a wider
    // outline eats the letterform inward and the type just looks blurrier
    // rather than more separated -- which is exactly what happened at 2.6px.
    // Painting stroke first and fill over it puts the whole width OUTSIDE
    // the glyph, so the outline can be heavy and the letters stay crisp.
    paintOrder: "stroke fill",
    textShadow: [
      `0 3px 0 ${brandKit.headlineShadow[0]}`,
      `0 6px 0 ${brandKit.headlineShadow[1]}`,
      `0 9px 0 ${brandKit.headlineShadow[2]}`,
      "0 16px 30px rgba(50,16,0,0.55)",
    ].join(", "),
    textTransform: "uppercase",
  };

  return (
    <AbsoluteFill>
      {brandKit.hookBgPath ? (
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
      ) : (
        // No cover art in the brand folder: draw the card from the brand's own
        // gradient. Same mask, so it blooms out of the photo the same way --
        // what changes is only what fills the card, not where it sits.
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(to bottom, ${brandKit.badgeGradient[0]} 0%, ${brandKit.badgeGradient[1]} 100%)`,
            ...bgMaskStyle,
          }}
        />
      )}
      <div style={badgeStyle}>
        <div style={glossStyle} />
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
        <div style={tailStyle}>
          {[0.5, 0.3, 0.16].map((opacity) => (
            <div key={opacity} style={{ flex: 1, background: `rgba(255,255,255,${opacity})` }} />
          ))}
        </div>
      </div>

      {hookDate ? <div style={dateStyle}>{hookDate}</div> : null}

      <div style={headlineStyle}>{headline}</div>
    </AbsoluteFill>
  );
};
