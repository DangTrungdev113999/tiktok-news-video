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

export type Effect = "pan" | "zoom" | "diagonal" | "passthrough";

export type Direction = "left" | "right";

export type Fit = "cover" | "contain-blur-pad";

export interface SceneSpec {
  /** Path relative to the repo root, e.g. "assets/hop-bao.jpg". */
  assetPath: string;
  assetType: AssetType;
  effect: Effect;
  /** Required for pan/diagonal (drift direction). Ignored for zoom/passthrough. */
  direction?: Direction;
  fit: Fit;
  /** Absolute frame (at the composition's fps) this scene's Sequence starts at. */
  startFrame: number;
  /** How many frames this scene's Sequence lasts. */
  durationInFrames: number;
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
}
