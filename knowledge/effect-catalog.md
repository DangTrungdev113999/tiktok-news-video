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
| `w / h >= 1.2` AND is image | landscape | **pan**: horizontal drift (±6% of frame width) + zoom 100%→108% over the scene duration. Direction alternates L↔R by occurrence index *within landscape scenes* so consecutive landscape scenes don't repeat the same drift. |
| `h / w >= 1.2` AND is image | portrait | **zoom**: centered scale, alternating **push** (100%→112%, `zoomVariant:"in"`) and **pull** (112%→100%, `zoomVariant:"out"`) across consecutive portrait scenes — see "Push/pull alternation" below. |
| `0.83 <= w/h < 1.2` AND is image | square-ish | Alternates between **diagonal** (small drift ±4% x/y + zoom 100%→106%) and **rotate** (subtle 0°→±3° spin + zoom 100%→115%, see below) across consecutive square-ish scenes, for variety. |
| any video file | video | **passthrough**: native playback, no synthetic motion added (source audio always muted — see §D/§E). If the clip's own duration is shorter than the scene's allotted time, loop it; if longer, trim to the scene's duration (never speed up/down). |

All ramps use a cinematic ease-out curve (`Easing.bezier(0.22,1,0.36,1)` in
`Scene.tsx`'s `MOTION_EASING`), not linear interpolation — motion settles
gently instead of moving at constant mechanical speed.

### Rotate — the geometry that keeps it safe

Rotating a `cover`-filled frame exposes corners unless the zoom compensates.
For a `w×h` frame rotated by `θ`, the minimum safe scale is
`cos(θ) + (h/w)·sin(θ)` — for the 1080×1920 frame at 3°, that's ~1.092.
`ROTATE_ZOOM_END = 1.15` leaves real margin above that. Rotation and zoom
ramp **monotonically together** (0°→±3° alongside 100%→115%, both starting
at rest at frame 0), NOT oscillating like pan/diagonal — if they started
already offset (as pan/diagonal do), the frame would be under-scaled for the
angle already reached at frame 0, exposing black corners.

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

## Push/pull alternation (implemented, default for portrait)

Consecutive portrait scenes alternate `zoomVariant: "in"` (push, 100%→112%)
and `"out"` (pull, 112%→100%) so a run of portraits doesn't feel like the
same zoom repeating. Tracked per-class in `build-spec.mjs`'s `occurrence`
counters (landscape/portrait/square each have their own independent
alternation, not a single global scene counter).

## Extra presets (not implemented — revisit if v1 still feels flat)

- **Breathing hold**: for formal/headshot-style portraits, a subtler
  100%→104% zoom instead of the default 112% — reads as stillness-with-life
  rather than a dramatic push. Would need a way to distinguish "formal
  headshot" from "candid portrait" automatically (no vision-based detection
  in this plugin), so left undone rather than applied blindly to all
  portraits.
- **Parallax layered**: subject cut out via background removal, floated over
  its own blurred backdrop at a different parallax speed. Needs a
  background-removal step this plugin doesn't have yet.

## Render defaults

1080×1920, 30fps, H.264 MP4. Final master pass: 2-pass ffmpeg `loudnorm` to
-14 LUFS (reusing the technique referenced in `content-video-plugin`'s
`scripts/master-audio.sh`, not the script itself).
