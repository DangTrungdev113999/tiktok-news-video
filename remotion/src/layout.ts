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
  /** Sits at the photo -> gradient-card transition, per the approved render. */
  top: 1185,
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
  /** 1920 - 343 = 1577: bottom edge, comfortably above SAFE.bottom. */
  bottomInset: 343,
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

/** Karaoke captions: same family and same size as the headline, by design. */
export const CAPTION = {
  left: 60,
  rightInset: 194,
  /** 1920 - 350 = 1570 bottom edge -- above SAFE.bottom (1629). */
  bottomInset: 350,
  fontSize: 54,
  lineHeight: 1.34,
  /** Horizontal space between words on the same line. */
  wordGap: 18,
  readColor: "#FFD24C",
  unreadColor: "#FFFFFF",
} as const;

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
