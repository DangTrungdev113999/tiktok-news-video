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

export type AssetType = "image" | "video";

export type Effect = "pan" | "zoom" | "diagonal" | "rotate" | "passthrough";

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
  /** Zoom factor at the peak of the push. ~1.15 loose, ~1.6 tight. */
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

export interface SceneSpec {
  /** Path relative to the repo root, e.g. "assets/hop-bao.jpg". */
  assetPath: string;
  assetType: AssetType;
  effect: Effect;
  /** Required for pan/diagonal/rotate (drift/spin direction). Ignored for zoom/passthrough. */
  direction?: Direction;
  /** Only meaningful for effect "zoom" -- push/pull alternation. Defaults to "in". */
  zoomVariant?: ZoomVariant;
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
  focus?: FocusPoint;
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
  /** Path relative to the repo root, e.g. "brand/mat-vu-tac-quyen/hook-bg.jpg". */
  hookBgPath: string;
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
  // Index signature: Remotion's <Composition> constrains props to
  // Record<string, unknown>; every field above is still concretely typed
  // for consumers, this only satisfies that generic constraint.
  [key: string]: unknown;
}
