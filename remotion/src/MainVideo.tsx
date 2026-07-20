import React from "react";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { Audio as MediaAudio } from "@remotion/media";
import { Scene } from "./Scene";
import { Captions } from "./Captions";
import { HookCard } from "./HookCard";
import type { VideoSpec } from "./spec-types";

/**
 * Composition root: lays out one <Sequence> per scene (wrapping the single
 * parametric <Scene>, plus a <HookCard> for the hook scene only), a global
 * karaoke-<Captions> overlay (outside any Sequence -- see Captions.tsx for
 * why), a full-length narration track, and a looped BGM track at constant
 * volume (no ducking, per the house spec).
 */
export const MainVideo: React.FC<VideoSpec> = ({
  scenes,
  narrationAudioPath,
  bgmAudioPath,
  bgmVolume,
  captions,
  brandKit,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {scenes.map((scene, index) => (
        <Sequence
          key={`${scene.assetPath}-${scene.startFrame}-${index}`}
          from={scene.startFrame}
          durationInFrames={scene.durationInFrames}
          name={`scene-${index}`}
        >
          <Scene
            assetPath={scene.assetPath}
            assetType={scene.assetType}
            effect={scene.effect}
            direction={scene.direction}
            zoomVariant={scene.zoomVariant}
            fit={scene.fit}
            assetWidth={scene.assetWidth}
            assetHeight={scene.assetHeight}
            focus={scene.focus}
            focusReverse={scene.focusReverse}
            zoomTo={scene.zoomTo}
            slide={scene.slide}
            entrance={scene.entrance}
            durationInFrames={scene.durationInFrames}
          />
          {scene.isHook && brandKit ? (
            <HookCard headline={scene.hookHeadline ?? ""} brandKit={brandKit} />
          ) : null}
        </Sequence>
      ))}

      {captions && captions.length > 0 ? <Captions lines={captions} /> : null}

      {narrationAudioPath ? <MediaAudio src={staticFile(narrationAudioPath)} name="narration" /> : null}

      {bgmAudioPath ? (
        <MediaAudio src={staticFile(bgmAudioPath)} volume={bgmVolume ?? 0.25} loop name="bgm" />
      ) : null}
    </AbsoluteFill>
  );
};
