import { loadFont } from "@remotion/google-fonts/Oswald";

/**
 * ONE shared source of truth for the video's typography and for every
 * on-screen text position, so the hook card and the karaoke captions can
 * never drift apart again (they used to load two different families --
 * Baloo2 for the hook, Inter for the captions -- which read as two unrelated
 * videos stitched together).
 *
 * Every number below is in the composition's own 1080x1920 pixel space and
 * was MEASURED off reference frames rather than eyeballed:
 *
 *  - `docs/superpowers/specs/2026-07-20-safe-zone-typography-design.md` records
 *    the measurement method and the raw numbers.
 *  - The TikTok safe zone came from the user's `safe-zone.jpg` overlay
 *    (720x1280, scaled 1.5x to this frame).
 *  - The badge/headline proportions came from a theanh28 reference frame and
 *    from the user's own approved 2026-07-18 render.
 */

// Oswald: a tall, genuinely condensed grotesque -- the "kiểu đứng" news look
// the reference frames use. Weight 700 only; the vietnamese subset is
// required (this pipeline's narration is Vietnamese, and Baloo2/Inter were
// previously carrying the diacritics).
const { fontFamily } = loadFont("normal", {
  weights: ["700"],
  subsets: ["vietnamese", "latin"],
});

export const BRAND_FONT_FAMILY = fontFamily;

/**
 * TikTok's own UI chrome (caption text, the right-hand like/comment/share
 * column, the progress bar) is drawn OVER the video during playback. Anything
 * we render outside this box is liable to be covered up on a real phone --
 * which is exactly what was wrong with the previous layout: the hook headline
 * sat at y1262-1500+ and the captions at y~1660, both inside the covered
 * band.
 *
 * Measured from safe-zone.jpg: the safe region is inset 51px on the left and
 * runs from y247 to y1629. Its right edge is 1026 above y862 but tightens to
 * 886 below that, where the action-button column starts.
 */
export const SAFE = {
  top: 247,
  bottom: 1629,
  left: 51,
  /** Right edge below y=862, where TikTok's action-button column begins. */
  rightBelowButtons: 886,
  /** Right edge above y=862 (no button column up there). */
  rightAboveButtons: 1026,
  /** y at which the right edge tightens from `rightAboveButtons`. */
  buttonColumnTop: 862,
} as const;

/** Flush-left ribbon badge on the hook card (brand name + logo mark). */
export const BADGE = {
  /**
   * Sits ON the photo, clear ABOVE the gradient-card transition.
   *
   * Was 1185 -- level with the transition -- until 2026-07-20, when the author
   * marked the target with a red line on a render. Measured off that
   * screenshot: the line lands at y1125, so the badge's BOTTOM (top + height)
   * has to clear it. 1030 + 90 = 1120, five pixels above.
   *
   * HEADLINE.bottomInset moved by the SAME 155px. Both must travel together:
   * the headline grows upward from its bottom edge, and the clearance between
   * a worst-case 5-line headline and this badge is only ~20px. Move one
   * without the other and a long hook overlaps the badge.
   */
  top: 1030,
  height: 90,
  /**
   * Deliberately large: the reference badge insets its logo mark ~93px from
   * the frame's left edge so the mark lines up with the headline's left edge
   * (see HEADLINE.left) instead of hugging the screen edge.
   */
  paddingLeft: 93,
  paddingRight: 52,
  iconSize: 62,
  /** Space between the logo mark and the brand name. */
  gap: 14,
  fontSize: 44,
  letterSpacing: 0.8,
} as const;

/**
 * The hook headline. Anchored by its BOTTOM edge, not its top: a headline is
 * user-supplied narration text of unpredictable length, and a top-anchored
 * block grows DOWNWARD into the covered band the moment it needs a 4th line.
 * Anchoring the bottom makes it grow upward instead, so the block is safe at
 * any length while still landing exactly where the reference puts it for the
 * typical 3-line headline (top 1360, bottom 1577).
 */
export const HEADLINE = {
  left: 96,
  /** 1080 - 194 = 886 = SAFE.rightBelowButtons -- clears the button column. */
  rightInset: 194,
  /**
   * 1920 - 498 = 1422: bottom edge. Raised 155px on 2026-07-20 in lockstep
   * with BADGE.top (read its comment for why they cannot move independently).
   * Still comfortably above SAFE.bottom, and the 5-line worst case now tops
   * out at y1140 against a badge bottom of 1120 -- the same ~20px clearance
   * the old pair had.
   */
  bottomInset: 498,
  fontSize: 54,
  lineHeight: 1.34,
  /** Step down through these if the text would need more than `maxLines`. */
  fontSizeSteps: [54, 48, 44],
  /**
   * 3, matching the reference frames. This is a budget, not a hard clamp:
   * a headline too long even at the smallest step still renders, growing
   * upward (the block is bottom-anchored) rather than down into TikTok's
   * covered band.
   *
   * Measured headroom: a 177-character headline steps down to 44px and
   * renders FIVE lines, topping out at y1295 -- still 20px clear of the
   * badge's bottom edge (1185 + 90 = 1275). Beyond roughly 210 characters a
   * sixth line would start overlapping the badge. That is far past any
   * sensible spoken hook (the headline is scene 1's narration line), so it
   * is documented rather than defended against.
   */
  maxLines: 3,
} as const;

/**
 * Karaoke captions: same FAMILY as the headline (that rule is the whole point
 * of this file), but no longer the same size -- the author asked for 30% less
 * on 2026-07-20 and the headline kept its own.
 */
export const CAPTION = {
  left: 60,
  rightInset: 194,
  /** 1920 - 350 = 1570 bottom edge -- above SAFE.bottom (1629). */
  bottomInset: 350,
  /** 54 x 0.7. The headline stays at 54; only the captions shrank. */
  fontSize: 38,
  lineHeight: 1.34,
  /**
   * Horizontal space between words on the same line.
   *
   * Scaled WITH the font (18 x 0.7), and that is the load-bearing half of the
   * change. A fixed 18px against a 30%-smaller glyph reads as 43% more air
   * between words -- which is what "letter spacing too wide" actually was.
   * Measured across four candidate families: the word gaps looked identical in
   * all of them, because the gap never depended on the family at all.
   */
  wordGap: 12,
  readColor: "#FFD24C",
  unreadColor: "#FFFFFF",
} as const;

/** The subset of CAPTION a brand may override in its brand.json. */
export type CaptionOverrides = Partial<
  Pick<
    typeof CAPTION,
    "left" | "rightInset" | "bottomInset" | "fontSize" | "lineHeight" | "wordGap"
  >
>;

/**
 * Merge a brand's caption overrides over the house defaults.
 *
 * The merge lives HERE, and the defaults live only in CAPTION above, because
 * the node side (scripts/brand-kit.mjs) passes through nothing but the keys a
 * brand actually set. If it filled in defaults instead, every later change to
 * CAPTION would silently disagree with a stale copy over there -- and the
 * disagreement would surface only as a video that looks slightly wrong.
 *
 * Positions arriving here have already been clamped to TikTok's safe zone by
 * build-spec.mjs, which also emits the warning. This function does not
 * re-check: two clamp sites means two places to disagree about the floor.
 */
export function resolveCaption(overrides?: CaptionOverrides | null) {
  return { ...CAPTION, ...(overrides ?? {}) };
}

/**
 * Average advance width of one uppercase Oswald-700 glyph (spaces included),
 * as a fraction of the font size. Used ONLY by `fitHeadlineFontSize`.
 *
 * MEASURED, not guessed: two rendered headline rows at fontSize 54 came out
 * at 754px / 29 chars = 0.481em and 706px / 27 chars = 0.484em. Rounded UP to
 * 0.50 on purpose -- an over-wide estimate under-counts how many characters
 * fit per line, so it over-counts lines and errs toward shrinking a size
 * early. Under-estimating would be the dangerous direction: the block is
 * bottom-anchored, so an un-shrunk headline grows UPWARD toward the badge.
 */
const AVG_UPPERCASE_CHAR_EM = 0.5;

/**
 * Pick the largest headline font size (from HEADLINE.fontSizeSteps) whose
 * estimated line count fits HEADLINE.maxLines. Pure function of the string --
 * no DOM measurement, no state -- so it stays render-deterministic like the
 * rest of this project's motion math.
 */
export function fitHeadlineFontSize(headline: string): number {
  const availableWidth = 1080 - HEADLINE.left - HEADLINE.rightInset;
  const steps = HEADLINE.fontSizeSteps;

  for (const size of steps) {
    const charsPerLine = Math.max(
      Math.floor(availableWidth / (size * AVG_UPPERCASE_CHAR_EM)),
      1,
    );
    const estimatedLines = Math.ceil(headline.length / charsPerLine);
    if (estimatedLines <= HEADLINE.maxLines) return size;
  }
  return steps[steps.length - 1];
}
