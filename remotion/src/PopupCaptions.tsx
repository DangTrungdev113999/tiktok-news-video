import React from "react";
import type { CSSProperties } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { CaptionLine } from "./spec-types";
import { BRAND_FONT_FAMILY, resolveCaption } from "./layout";
import type { CaptionOverrides } from "./layout";
import { findActiveLine } from "./Captions";

/**
 * The "popup" karaoke look: small 2-3 word groups (grouped by
 * build-spec.mjs's chunkWordsIntoPopupCaptionLines), one on screen at a time,
 * cutting straight to the next group -- no group-level fade/scale-in, by
 * request (2026-07-22). Shares CAPTION geometry (position/size/brand
 * overrides) with Captions.tsx via the same resolveCaption() -- only the
 * per-word highlight rule differs.
 *
 * Highlight is momentary, not cumulative: exactly the word currently being
 * spoken (frame inside its own [startFrame, endFrame)) is gold and scaled up;
 * every other word in the group -- including ones already spoken -- reads
 * plain white. This is the deliberate difference from Captions.tsx's
 * read-and-stays-gold rule.
 */
export interface PopupCaptionsProps {
  lines: CaptionLine[];
  caption?: CaptionOverrides | null;
  fontFamily?: string;
}

/** How far in/out the CURRENT word scales relative to its neighbours. */
const ACTIVE_WORD_SCALE = 1.12;

export const PopupCaptions: React.FC<PopupCaptionsProps> = ({ lines, caption, fontFamily }) => {
  const frame = useCurrentFrame();
  const c = resolveCaption(caption);
  const active = findActiveLine(lines, frame);
  if (!active) return null;

  const outerStyle: CSSProperties = {
    position: "absolute",
    left: c.left,
    right: c.rightInset,
    bottom: c.bottomInset,
    display: "flex",
    justifyContent: "center",
  };

  const innerStyle: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "flex-end",
    columnGap: c.wordGap,
    rowGap: 0,
    maxWidth: "100%",
  };

  const wordBaseStyle: CSSProperties = {
    fontFamily: fontFamily ?? BRAND_FONT_FAMILY,
    fontWeight: 700,
    fontSize: c.fontSize,
    lineHeight: c.lineHeight,
    textTransform: "uppercase",
    WebkitTextStroke: "6px rgba(0,0,0,0.85)",
    paintOrder: "stroke fill" as CSSProperties["paintOrder"],
    textShadow: "0 2px 10px rgba(0,0,0,0.45)",
    display: "inline-block",
  };

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={outerStyle}>
        <div style={innerStyle}>
          {active.words.map((w, i) => {
            const isActive = frame >= w.startFrame && frame < w.endFrame;
            return (
              <span
                key={`${w.startFrame}-${i}`}
                style={{
                  ...wordBaseStyle,
                  color: isActive ? c.readColor : c.unreadColor,
                  transform: isActive ? `scale(${ACTIVE_WORD_SCALE})` : "scale(1)",
                }}
              >
                {w.text}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
