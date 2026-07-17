# Visual effect catalog — deterministic, aspect-ratio-driven

> Locked house rule: **one parametric Remotion `<Scene>` component**, never
> bespoke-per-scene code. Motion is pure math over frame number
> (`interpolate()`), so it's trivially render-safe/deterministic — there is no
> "determinism gate" risk here the way there is for LLM-authored scene code in
> sibling projects.

## Classification (fully automatic — no manual tagging)

Read the asset's natural pixel dimensions (`w`, `h`) via `probe-asset.mjs`
(ffprobe under the hood, works for both images and videos):

| Ratio test | Class | Effect |
|---|---|---|
| `w / h >= 1.2` AND is image | landscape | **pan**: horizontal drift (±6% of frame width) + zoom 100%→108% over the scene duration. Direction alternates L↔R by scene index (`index % 2`) so consecutive landscape scenes don't repeat the same drift. |
| `h / w >= 1.2` AND is image | portrait | **zoom-in**: centered scale 100%→112% over the scene duration. |
| `0.83 <= w/h < 1.2` AND is image | square-ish | **diagonal**: small diagonal drift (±4% x, ±4% y) + zoom 100%→106%. |
| any video file | video | **passthrough**: native playback, no synthetic motion added. If the clip's own duration is shorter than the scene's allotted time, loop it; if longer, trim to the scene's duration (never speed up/down). |

## Frame fit — cover vs. contain+blur-pad

Default: **cover** (crop to fill 1080×1920, motion applied on top). The crop
fraction is computed geometrically (not by naive ratio deviation — see
`build-spec.mjs`'s `coverCropFraction`): for a `cover` fit, whichever axis
doesn't bind the scale is where the overflow gets cropped, so the fraction
lost is `1 - targetRatio/ratioWH` (or the inverse for narrower-than-target
assets). A plain 16:9 photo already loses ~68% of its width when force-fit
into 9:16 — that's normal Ken-Burns material, not an edge case, since the
pan effect traverses across the crop over the scene's duration.

Switch to **contain + blur-pad** only when:
- **Images**: crop fraction > **0.75** (roughly `ratioWH > 2.25`, i.e. a
  genuine wide panorama) — ordinary 16:9/4:3/3:2 photos stay on cover+pan.
- **Video**: crop fraction > **0.15** — a much stricter bar than images,
  because cropping a talking head's face is unacceptable even at a moderate
  crop; only clips already close to 9:16 get cropped instead of blur-padded.

**Blur-pad implementation:** duplicate the same asset, `object-fit: cover` +
scale it up further (~130%) + Gaussian blur (~40px) to fill the whole
1080×1920 frame as a backdrop; composite the sharp original centered on top at
its natural `contain` size. Same technique for images and videos.

## Extra presets (offered, not default — enable per-scene if requested)

- **Push/pull alternation**: alternate zoom-in vs. zoom-out across
  consecutive same-class scenes so motion doesn't feel repetitive across a
  long video.
- **Breathing hold**: for formal/headshot-style portraits, use a subtler
  100%→104% zoom instead of the default 112% — reads as stillness-with-life
  rather than a dramatic push. Good for official photos, mugshots, portraits
  in a serious news context.
- **Parallax layered** (flagged, not implemented in v1): subject cut out via
  background removal, floated over its own blurred backdrop at a different
  parallax speed. Needs a background-removal step this plugin doesn't have
  yet — revisit if v1's effects feel flat.

## Render defaults

1080×1920, 30fps, H.264 MP4. Final master pass: 2-pass ffmpeg `loudnorm` to
-14 LUFS (reusing the technique referenced in `content-video-plugin`'s
`scripts/master-audio.sh`, not the script itself).
