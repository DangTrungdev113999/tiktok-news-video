import React from "react";
import type { CSSProperties } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { CaptionLine } from "./spec-types";
import { BRAND_FONT_FAMILY, CAPTION } from "./layout";

/**
 * ONE global karaoke-caption overlay, rendered outside any per-scene
 * <Sequence> so it can track real speech timing (absolute composition
 * frames, from build-spec.mjs's chunking) independent of a scene's own
 * Sequence duration -- gap-closed scene holds must never shift a caption.
 *
 * Not rendered at all for the hook scene: its words are simply never added
 * to `lines` (build-spec.mjs skips any scene with isHook: true), so there is
 * nothing to find/render during that scene's frame range.
 *
 * Style: cumulative read-highlight, not a per-word pop. A word turns (and
 * stays) gold the moment its own speech starts and never reverts -- so at
 * any instant, every word spoken so far in the line reads gold and every
 * word still to come reads white. No scale/zoom on the active word.
 *
 * 2026-07-20: the type is now Oswald 700 at the same size as the hook
 * headline (shared via ./layout, replacing a standalone Inter 64px), and a
 * caption group may wrap onto TWO lines instead of being forced into one.
 * The block also moved up out of TikTok's covered bottom band -- at the old
 * `bottom: 260` the captions rendered underneath TikTok's own UI on a real
 * phone.
 */
export interface CaptionsProps {
  lines: CaptionLine[];
}

function findActiveLine(lines: CaptionLine[], frame: number): CaptionLine | null {
  // Lines are built in ascending, non-overlapping frame order -- a linear
  // scan is plenty fast at the per-video line counts this plugin produces.
  for (const line of lines) {
    if (frame >= line.startFrame && frame < line.endFrame) return line;
  }
  return null;
}

// Bottom-anchored so a two-line group grows UPWARD; the bottom edge (and so
// the clearance from TikTok's covered band) stays constant either way.
const outerStyle: CSSProperties = {
  position: "absolute",
  left: CAPTION.left,
  right: CAPTION.rightInset,
  bottom: CAPTION.bottomInset,
  display: "flex",
  justifyContent: "center",
};

const innerStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "center",
  alignItems: "flex-end",
  columnGap: CAPTION.wordGap,
  rowGap: 0,
  maxWidth: "100%",
};

const wordBaseStyle: CSSProperties = {
  fontFamily: BRAND_FONT_FAMILY,
  fontWeight: 700,
  fontSize: CAPTION.fontSize,
  lineHeight: CAPTION.lineHeight,
  textTransform: "uppercase",
  WebkitTextStroke: "6px rgba(0,0,0,0.85)",
  paintOrder: "stroke fill" as CSSProperties["paintOrder"],
  textShadow: "0 2px 10px rgba(0,0,0,0.45)",
  display: "inline-block",
};

export const Captions: React.FC<CaptionsProps> = ({ lines }) => {
  const frame = useCurrentFrame();
  const active = findActiveLine(lines, frame);
  if (!active) return null;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={outerStyle}>
        <div style={innerStyle}>
          {active.words.map((w, i) => {
            const isRead = frame >= w.startFrame;
            return (
              <span
                key={`${w.startFrame}-${i}`}
                style={{
                  ...wordBaseStyle,
                  color: isRead ? CAPTION.readColor : CAPTION.unreadColor,
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
