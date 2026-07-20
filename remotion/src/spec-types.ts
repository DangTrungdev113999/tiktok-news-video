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
