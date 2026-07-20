# `zoom_in` — push in by a stated amount, across the whole shot

```
anh_1.jpg | zoom_in: 50%
anh_1.jpg | zoom_in
```

The picture starts at its natural framing and **pushes in steadily until the
end of the shot**, ending at `100% + the stated amount`. `zoom_in: 50%` ends at
1.5×. The move runs the full length of the shot — that is what the author means
by "suốt screen" — so it is a slow continuous drift, not a snap.

| Value | Ends at |
|---|---|
| `zoom_in: 50%` | 1.5× |
| `zoom_in: 20%` | 1.2× |
| `zoom_in` (bare) | 1.2× — the house default |

**Ceiling: 2.0×.** Past that a 1080-wide source is being enlarged past its own
pixels and the softness shows on a phone screen. A larger value is clamped and
reported.

## Why it exists

`classifyAsset` already gives portrait images a zoom automatically, alternating
push and pull for rhythm. This tag is for when the author wants a *specific*
shot to close in, and by how much — a slow 50% push on a face reads very
differently from the ambient 20% drift.

Using it also **takes that asset out of the push/pull rotation**, so it can't
flip the next portrait's direction. Its motion was chosen, not inferred.

## The easing is deliberately not linear

The push uses the house `MOTION_EASING` — fast at the start, settling gently.
A linear zoom reads as a machine sliding a lens; this reads as a camera
operator finding the shot. Nothing to configure.

## What ships

```json
{ "effect": "zoom", "zoomVariant": "in", "zoomTo": 1.5, ... }
```

`zoomTo` is the scale at the **end** of the shot. Absent, the renderer uses
1.2. No new rendering path: this is the existing `zoom` branch of
`computeTransform` with its endpoint made a parameter instead of a constant.

## `target 1 trong anh_1_des.jpg` — aim the push

```
anh_1.jpg | zoom_in: 50%, target 1 trong anh_1_des.jpg
anh_1.jpg | zoom_out: 40%, target b trong anh_1_des.jpg
```

By default a zoom pushes into the **middle** of the picture. `target` says push
into a specific thing instead, named by a **marker drawn on a description
image** — the same mechanism `focus_object` uses, and resolved the same way, so
read the "Description images" section of `focus-object.md` before doing it.

Markers are whatever the author drew: `1`, `2`, `3` or `a`, `b`, `c`. And the
marker is a **pointer, not a coordinate** — find who or what it indicates, then
take the position from the ORIGINAL image, never from the description image.

An aimed zoom ships as a single-point `focus` entry with the percentage as its
`scale`, rather than as a second aiming mechanism:

```json
"focus": [{ "x": 0.35, "y": 0.30, "scale": 1.5, "note": "target 1 = ao vest xanh" }]
```

`zoom_out` with a target runs it backwards — the shot **starts** close on the
marker and pulls back to natural framing (`focusReverse: true`). Measured on a
render, the two are exact mirrors of each other.

As always, the push is clamped to what the picture allows, so a marker near an
edge ends up larger and *closer* to centre rather than dead centre.

## Interaction with other tags

Tags fill slots, and only same-slot tags conflict (see `README.md`).

- **`focus_object`** — same slot (`traverse`), so this is a real conflict and
  the focus tag **wins**: it already carries its own zoom (`scale`) and its own
  timing (`peakFrame`), and the two would fight. Report that `zoom_in` was
  ignored. For a stronger push, the knob is the focus point's own `scale`.
  Note that `zoom_in` with a `target` is not a conflict at all — it IS the
  focus mechanism, so it simply becomes one.
- **`slide_left_right` / `slide_right_left` / `slide_top_bottom`** — different
  slot, so they **compose**: a traverse that also closes in. The ramps multiply.
- **`fill_full_screen`**, **`flip_book`** — different slots; compose cleanly.

## Parsing

Registered as an **optional-value key**: it is valid bare and valid with a
value, so `parse-tags.mjs` returns it in `tags{}` with `""` when written bare.
Read the value with `parsePercent()` from the same module, which accepts `50%`,
`50 %` and a bare `50` alike.

See `zoom-out.md` for the pull-back, which is this tag reversed.
