/**
 * Shape of the spec.json file that drives a render.
 *
 * All path fields (`assetPath`, `narrationAudioPath`, `bgmAudioPath`) are
 * resolved relative to the REPO ROOT (the directory containing `assets/`,
 * `bgm-library/`, and `output/`) -- NOT relative to `remotion/`. The render
 * wrapper (`scripts/render.mjs`) passes `--public-dir=<repoRoot>` to the
 * Remotion CLI, and every component here wraps these paths in
 * `staticFile()`, so a path like `assets/photo.jpg` or
 * `output/2026-07-17_slug/narration.mp3` resolves correctly no matter where
 * the file physically lives in the repo.
 */

import type { CaptionOverrides } from "./layout";

export type AssetType = "image" | "video";

export type Effect = "pan" | "zoom" | "diagonal" | "passthrough" | "slide";

/**
 * A `slide_left_right` / `slide_right_left` traverse across the picture,
 * resolved from the tag's insets and anchor at build time. See
 * skills/tiktok-news-video/references/tags/slide-left-right.md.
 */
export interface SlideSpec {
  /** "x" = a left/right traverse, "y" = a top/bottom one. */
  axis: "x" | "y";
  /**
   * Normalised position along the travel axis where the frame starts, 0 = the
   * picture's leading edge, 1 = its trailing edge. `from > to` IS the reversed
   * variant -- there is deliberately no direction field, because two ways of
   * saying which way the move goes is one way too many.
   */
  from: number;
  /** Where the frame ends, same normalisation. */
  to: number;
  /**
   * Scale (against the file's own pixels) the sharp foreground is painted at.
   * Chosen at build time to leave a blur band on the axis PERPENDICULAR to
   * travel while still leaving enough overflow along it to traverse -- see
   * build-spec.mjs's slideForegroundScale. Shipped as a number rather than
   * recomputed here so the inset->position conversion and the render agree by
   * construction instead of by two implementations matching.
   */
  foregroundScale: number;
  /**
   * Point on the axis PERPENDICULAR to travel to bring toward the centre of
   * frame, normalised against the picture (`top 20%` -> 0.1, the centre of
   * that band). Omitted = stay centred, and then no zoom is applied at all.
   */
  anchorPos?: number;
  /**
   * Zoom held during an anchored slide. An anchor is unreachable without one:
   * there is no slack to shift into until the picture is enlarged. Applies to
   * the sharp foreground ONLY -- the blurred backdrop stays put, per the
   * author's rule "zoom dien ra trong anh thoi, dung zoom lop blur".
   */
  anchorScale?: number;
}

/**
 * How a shot BEGINS -- a distinct slot from the camera move that runs during
 * it. Both kinds below play over a blurred backdrop that is already on screen
 * when the shot starts, so the entrance reads as the picture arriving rather
 * than as the whole frame cutting.
 */
export interface EntranceSpec {
  /**
   * "slide_in": the picture flies in from one edge. "flip_book": it is revealed
   * along a diagonal fold running from the top-left corner to the bottom-right.
   */
  type: "slide_in" | "flip_book";
  /**
   * Edge the picture enters from, for "slide_in". Deliberately the side
   * OPPOSITE the traverse that follows.
   */
  fromSide?: "left" | "right" | "top" | "bottom";
  /** How long the entrance takes, in frames. */
  durationInFrames: number;
}

export type Direction = "left" | "right";

/**
 * Push/pull alternation for "zoom": "in" (100%->112%, the original default)
 * vs "out" (112%->100%, a pull-back). Ignored for other effects.
 */
export type ZoomVariant = "in" | "out";

export type Fit = "cover" | "contain-blur-pad";

/**
 * Where in the picture the camera should end up, resolved from a
 * `focus_object:` tag. The skill LOOKS AT the image while building spec.json
 * and writes these numbers down; the renderer only ever sees numbers, so the
 * render stays a pure function of the spec. See
 * skills/tiktok-news-video/references/tags/focus-object.md.
 */
export interface FocusPoint {
  /** 0 = left edge, 1 = right edge of the visible image. */
  x: number;
  /** 0 = top edge, 1 = bottom edge of the visible image. */
  y: number;
  /** Zoom factor at the peak of the push. ~1.12 loose, 1.3 tight -- clamped to 1.3. */
  scale: number;
  /**
   * Frame WITHIN THIS SHOT at which the push reaches `scale`, then holds.
   * Set when the author tied the focus to a spoken moment ('luc "Trung Dang"'):
   * the move lands exactly as the name is said. Omit to peak at the last frame
   * of the shot.
   */
  peakFrame?: number;
  /**
   * Why these numbers -- the line the skill reported in chat, e.g.
   * 'nguoi thu 3 tu trai -> ao vest xanh'. Never read by the renderer; it
   * exists so a saved spec.json still explains itself months later.
   */
  note?: string;
}

/**
 * How a shot ENDS. A quick push in the last fraction of a second, then a hard
 * cut -- the punctuation that keeps a feed video moving. Set on the LAST shot
 * of each screen (not every shot: a screen holding three images would
 * otherwise punch three times and read as a stutter) and never on the final
 * screen, where there is no cut to land on.
 */
export interface ExitSpec {
  type: "punch";
  /** How many frames before the end the push starts. */
  durationInFrames: number;
  /** Scale reached exactly at the cut. */
  scale: number;
}

export interface SceneSpec {
  /** Path relative to the repo root, e.g. "assets/hop-bao.jpg". */
  assetPath: string;
  assetType: AssetType;
  effect: Effect;
  /** Required for pan/diagonal (drift direction). Ignored for zoom/passthrough. */
  direction?: Direction;
  /** Only meaningful for effect "zoom" -- push/pull alternation. Defaults to "in". */
  zoomVariant?: ZoomVariant;
  /**
   * The ZOOMED end of a "zoom" effect, from a `zoom_in: 50%` / `zoom_out: 50%`
   * tag -- 1.5 for 50%. Means the same thing in both variants; `zoomVariant`
   * says which end of the shot it belongs to. Defaults to the house 1.2.
   */
  zoomTo?: number;
  /** Required for effect "slide". */
  slide?: SlideSpec;
  /** How this shot begins. Independent of the move that runs during it. */
  entrance?: EntranceSpec;
  /** How this shot ends. Present on the last shot of each screen but the last. */
  exit?: ExitSpec;
  fit: Fit;
  /**
   * Asset's natural pixel dimensions (from probe-asset.mjs's ffprobe read).
   * Required for "pan" -- the pan effect sizes the media element at its true
   * static cover-scale from these dimensions so it can translate across the
   * REAL crop overflow, instead of a synthetic zoom-derived one (see
   * Scene.tsx's PanMedia for why this distinction matters). Optional for
   * other effects, which don't need it.
   */
  assetWidth?: number;
  assetHeight?: number;
  /**
   * Present when the author tagged this asset with `focus_object:`. Overrides
   * `effect`/`zoomVariant` -- the shot becomes an aimed push toward this point
   * instead of whatever aspect ratio would have chosen.
   */
  /**
   * One entry per thing the author asked to focus on, in time order. Several
   * entries mean the camera travels between them within this one shot
   * ('focus_object: 1 luc "abc", 2 luc "xyz"'). Overrides `effect`/
   * `zoomVariant` -- the shot becomes an aimed move instead of whatever
   * aspect ratio would have chosen.
   */
  focus?: FocusPoint[];
  /**
   * Run the aimed move backwards: start close on the point and pull back off
   * it, instead of pushing in. Set by `zoom_out: 50%, target 1 ...`.
   */
  focusReverse?: boolean;
  /** Absolute frame (at the composition's fps) this scene's Sequence starts at. */
  startFrame: number;
  /** How many frames this scene's Sequence lasts. */
  durationInFrames: number;
  /**
   * True for the scene that gets the hook-card overlay (gradient panel +
   * brand logo + ALL-CAPS headline) instead of karaoke captions. At most one
   * scene (normally scene index 0) should set this.
   */
  isHook?: boolean;
  /** Headline text shown by the hook-card overlay. Only used when isHook is true. */
  hookHeadline?: string;
}

/** One karaoke-caption word, timed in absolute composition frames (not scene-local). */
export interface CaptionWord {
  text: string;
  startFrame: number;
  endFrame: number;
}

/** One on-screen caption line (a few words shown together, one highlighted at a time). */
export interface CaptionLine {
  words: CaptionWord[];
  startFrame: number;
  endFrame: number;
}

/**
 * One resolved brand kit for the hook-card overlay -- the skill picks a
 * single brand (from potentially several under $WORKSPACE_DIR/brand/) before
 * building spec.json, so this shape is always exactly one brand's data, not
 * a collection. See scripts/brand-kit.mjs and
 * docs/superpowers/specs/2026-07-18-multi-brand-kit-design.md.
 */
export interface BrandKit {
  /**
   * The hook scene's background, e.g. "brand/mat-vu-tac-quyen/hook-bg.jpg"
   * (.svg/.png/.webp also resolve). Null when the folder has none, in which
   * case HookCard draws the card from `badgeGradient` instead -- a brand
   * whose cover is drawn rather than photographed should not need a photo.
   */
  hookBgPath?: string | null;
  /**
   * The brand's mark inside the badge disc, e.g.
   * "brand/mat-vu-tac-quyen/logo.svg". Null when the folder has no logo file,
   * in which case HookCard draws a © glyph -- what every brand used to get
   * whether it suited the channel or not.
   */
  logoPath?: string | null;
  /**
   * Per-brand karaoke caption geometry, containing only the keys this brand
   * actually set. Merged over CAPTION by resolveCaption() in ./layout --
   * the defaults deliberately live in exactly one place.
   */
  caption?: CaptionOverrides | null;
  /**
   * The brand's own typeface, e.g. "brand/mat-vu-tac-quyen/font.woff2". Null
   * falls back to the house font. It applies to the headline, the badge and
   * the captions together -- never to one of them, which is the drift
   * remotion/src/layout.ts was written to prevent.
   */
  fontPath?: string | null;
  /** Ribbon badge text, e.g. "Mật Vụ Tác Quyền". */
  badgeLabel: string;
  /** 3-stop gradient for the badge background, e.g. ["#FF9A3D", "#FF6A00", "#F04E00"]. */
  badgeGradient: [string, string, string];
  /** The badge's boxShadow color, e.g. "rgba(120,40,0,0.4)". */
  badgeShadow: string;
  /** 3-stop embossed textShadow stack for the headline. */
  headlineShadow: [string, string, string];
  /** The headline's WebkitTextStroke color. */
  headlineStroke: string;
  /**
   * Whether this channel dates its posts. Read by scripts/build-spec.mjs to
   * decide whether to stamp `hookDate` -- the renderer never sees it.
   */
  hookDate?: boolean;
}

export interface VideoSpec {
  fps: number;
  width: number;
  height: number;
  /** Path relative to the repo root. Plays once, full length, from frame 0. */
  narrationAudioPath?: string;
  /** Path relative to the repo root. Loops under the whole video at bgmVolume. */
  bgmAudioPath?: string;
  /** 0..1, defaults to 0.25 (25%) per the house spec (no ducking). */
  bgmVolume?: number;
  scenes: SceneSpec[];
  /** Karaoke caption lines, flattened across all non-hook scenes, absolute-frame timed. */
  captions?: CaptionLine[];
  /** Present only when a scene has isHook: true. */
  brandKit?: BrandKit;
  /**
   * Publish date for the hook card's date plate, e.g. "22/07/2026", already
   * formatted by scripts/build-spec.mjs. Present only when the chosen brand
   * opted in with `"hookDate": true` -- absent is the normal case, and then
   * the card has no plate at all.
   */
  hookDate?: string;
  // Index signature: Remotion's <Composition> constrains props to
  // Record<string, unknown>; every field above is still concretely typed
  // for consumers, this only satisfies that generic constraint.
  [key: string]: unknown;
}
