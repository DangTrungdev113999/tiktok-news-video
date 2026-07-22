import React from "react";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { Audio as MediaAudio } from "@remotion/media";
import { Scene } from "./Scene";
import { Captions } from "./Captions";
import { PopupCaptions } from "./PopupCaptions";
import { HookCard } from "./HookCard";
import { HeldHookScene } from "./HeldHookScene";
import type { VideoSpec } from "./spec-types";
import { useBrandFont } from "./useBrandFont";

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
  captionStyle,
  brandKit,
  hookDate,
}) => {
  // Resolved once, here, and handed to BOTH text overlays. The headline, the
  // badge and the captions share one family by construction -- there is no
  // path through this component that gives them different ones.
  const fontFamily = useBrandFont(brandKit?.fontPath);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {scenes.map((scene, index) => (
        <Sequence
          key={`${scene.assetPath}-${scene.startFrame}-${index}`}
          from={scene.startFrame}
          durationInFrames={scene.durationInFrames}
          name={`scene-${index}`}
        >
          {scene.heldHook && brandKit ? (
            // Held hook: the SAME hook card as the hook scene stays pinned
            // (its brand cover + badge + headline fill the bottom, blooming
            // from ~60% down), and this scene's image is fitted into the top
            // half OVER it. Reusing the real card -- not a flat gradient panel
            // -- is what keeps the bottom from reading as a bare orange slab.
            // The image's own bottom fade blends it into the card's bloom.
            <>
              <HookCard
                headline={scene.hookHeadline ?? ""}
                brandKit={brandKit}
                fontFamily={fontFamily}
                hookDate={hookDate}
              />
              <HeldHookScene
                assetPath={scene.assetPath}
                assetType={scene.assetType}
                heightPx={980}
                durationInFrames={scene.durationInFrames}
              />
            </>
          ) : (
            <>
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
                exit={scene.exit}
                durationInFrames={scene.durationInFrames}
              />
              {scene.isHook && brandKit ? (
                <HookCard
                  headline={scene.hookHeadline ?? ""}
                  brandKit={brandKit}
                  fontFamily={fontFamily}
                  hookDate={hookDate}
                />
              ) : null}
            </>
          )}
        </Sequence>
      ))}

      {captions && captions.length > 0 ? (
        captionStyle === "popup" ? (
          <PopupCaptions lines={captions} caption={brandKit?.caption} fontFamily={fontFamily} />
        ) : (
          <Captions lines={captions} caption={brandKit?.caption} fontFamily={fontFamily} />
        )
      ) : null}

      {narrationAudioPath ? <MediaAudio src={staticFile(narrationAudioPath)} name="narration" /> : null}

      {bgmAudioPath ? (
        <MediaAudio src={staticFile(bgmAudioPath)} volume={bgmVolume ?? 0.25} loop name="bgm" />
      ) : null}
    </AbsoluteFill>
  );
};
