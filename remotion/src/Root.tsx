import React from "react";
import { Composition } from "remotion";
import type { CalculateMetadataFunction } from "remotion";
import { MainVideo } from "./MainVideo";
import type { VideoSpec } from "./spec-types";

const DEFAULT_FPS = 30;
const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;

// Shown in Remotion Studio when no --props spec.json is supplied. A real
// render always passes a real spec.json via `scripts/render.mjs` / `--props`.
const defaultSpec: VideoSpec = {
  fps: DEFAULT_FPS,
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  scenes: [
    {
      assetPath: "",
      assetType: "image",
      effect: "zoom",
      fit: "cover",
      startFrame: 0,
      durationInFrames: 90,
    },
  ],
};

// Duration/fps/width/height are all computed from the input spec.json
// (passed as inputProps via `--props`), not hardcoded on the <Composition>.
const calculateMetadata: CalculateMetadataFunction<VideoSpec> = ({ props }) => {
  const fps = props.fps ?? DEFAULT_FPS;
  const width = props.width ?? DEFAULT_WIDTH;
  const height = props.height ?? DEFAULT_HEIGHT;
  const lastFrame = props.scenes.reduce(
    (max, scene) => Math.max(max, scene.startFrame + scene.durationInFrames),
    0,
  );

  return {
    durationInFrames: Math.max(lastFrame, 1),
    fps,
    width,
    height,
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="MainVideo"
      component={MainVideo}
      durationInFrames={90}
      fps={DEFAULT_FPS}
      width={DEFAULT_WIDTH}
      height={DEFAULT_HEIGHT}
      defaultProps={defaultSpec}
      calculateMetadata={calculateMetadata}
    />
  );
};
