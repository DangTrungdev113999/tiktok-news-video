# `fill_full_screen` — no blur bands, crop to the edges

```
anh_1.jpg | fill_full_screen
```

A **bare flag** — it takes no value. It forces `fit: "cover"` on that asset:
the picture is scaled until it covers all of 1080×1920 and whatever falls
outside the frame is cropped away. No blurred backdrop, no letterbox bands.

## What it is actually overriding

**Every image is blur-padded by default.** The whole picture is shown at its
natural size and the rest of the frame is filled with a blurred copy, so the
bands land wherever the ratio puts them — top and bottom for a landscape, left
and right for a portrait. Nothing is decided by a threshold; it follows from
the aspect ratio.

This flag is the opt-out. It says: crop this one to the edges instead.

| Asset | Default | With the flag |
|---|---|---|
| Any image | `contain-blur-pad` — bands by ratio | `cover` — edge to edge |
| Video, already near 9:16 | `cover` | unchanged |
| Video, anything else | `contain-blur-pad` | `cover` |

(This changed on 2026-07-20. Before, cover was the default and blur-pad was
reserved for extreme panoramas, which made this flag close to a no-op on
ordinary photos. It is now one of the most consequential tags in the set.)

## The cost it buys

Cover means accepting the crop that blur-pad exists to avoid, and in a 9:16
frame that crop is severe:

- A 16:9 photo keeps about **37% of its width**. Anything either side of
  centre is gone.
- A 3.6:1 photo keeps about **15%**. If the subject is off to one side, the
  subject is what gets cut.
- A 16:9 talking-head video loses ~44% of its width. Faces sit off-centre more
  often than not, so this is how you crop someone's head in half.

The flag is the author saying they have looked at the picture and want the
crop. Take them at their word — but **say what will be lost** in the Step 6
report whenever the crop exceeds half the width, or the asset is a video. One
line is enough:
`video_1.mp4 — fill_full_screen: cắt ~44% chiều ngang, kiểm tra lại mặt người có bị cắt không`.

Reach for it when the picture genuinely has nothing at its edges, or when a
full-bleed frame is worth more than the missing sides — a hook shot, a texture,
a face already dead centre.

## Interaction with other tags

- **`focus_object`** — composes cleanly and is the good pairing. The focus tag
  aims the crop; this flag removes the bands. If a panorama has to be cropped,
  a focus point is what stops the crop landing on the wrong half.
- **`slide_left_right` / `slide_right_left` / `slide_top_bottom`** — composes,
  and it matters. A slide keeps a blur band on the axis it does NOT travel
  along; this flag removes it, so the traverse runs edge to edge.

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
