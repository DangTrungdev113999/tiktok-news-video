# `fill_full_screen` — no blur bands, crop to the edges

```
anh_1.jpg | fill_full_screen
```

A **bare flag** — it takes no value. It forces `fit: "cover"` on that asset:
the picture is scaled until it covers all of 1080×1920 and whatever falls
outside the frame is cropped away. No blurred backdrop, no letterbox bands.

## What it is actually overriding

`classifyAsset` picks the fit automatically, from how much a centre-crop would
throw away:

| Asset | Automatic fit | What the flag changes |
|---|---|---|
| Normal photo (16:9, 4:3, portrait, square) | `cover` already | **nothing** |
| Extreme panorama (crop loss > 75%) | `contain-blur-pad` | → `cover` |
| Video, unless already near 9:16 (crop loss > 15%) | `contain-blur-pad` | → `cover` |

**Say this to the author when they use it.** Cover is already the default for
ordinary photographs, so on a normal landscape shot the flag does nothing
visible. Someone who expects blur bands to be the usual case will test it on a
plain photo, see no change, and conclude it is broken. It bites on panoramas
and on video.

(Making blur-pad the *default*, so that edge-to-edge becomes the everyday
opt-in, is a different and much larger change — it alters how every existing
asset renders. It has not been made. Don't infer it from this flag.)

## The cost it buys

Forcing cover on an asset the classifier sent to blur-pad means accepting the
crop the classifier was avoiding:

- A 3:1 panorama cropped to 9:16 keeps about a third of its width. If the
  subject is off to one side, the subject is what gets cut.
- A 16:9 talking-head video cropped to 9:16 loses ~44% of the width. Faces sit
  off-centre more often than not, so this is how you crop someone's head in half.

The flag is the author saying they've looked at the picture and want the crop.
Take them at their word — but if the asset is a video, or the crop loss is
over 75%, **say what will be lost** in the Step 6 report. One line is enough:
`video_1.mp4 — fill_full_screen: cắt ~44% chiều ngang, kiểm tra lại mặt người có bị cắt không`.

## Interaction with other tags

- **`focus_object`** — composes cleanly and is the good pairing. The focus tag
  aims the crop; this flag removes the bands. If a panorama has to be cropped,
  a focus point is what stops the crop landing on the wrong half.
- **`slide_left_right` / `slide_right_left`** — redundant. A slide already
  fills the frame on its axis of travel (see `slide-left-right.md`). Harmless,
  but don't teach the pair together.

## What ships

The flag is resolved entirely at build time — it sets one field and the
renderer sees nothing new:

```json
{ "assetPath": "assets/anh_1.jpg", "fit": "cover", ... }
```

There is no `fillFullScreen` field in `spec.json`. A tag changes which
parameters `Scene.tsx` receives; it never adds a rendering path.

## Parsing

`scripts/parse-tags.mjs` lists it in `KNOWN_FLAGS`, so it is returned in
`flags[]`, not `tags{}`. Written with a value (`fill_full_screen: yes`) the
value is ignored and a warning is emitted — the flag still applies.
