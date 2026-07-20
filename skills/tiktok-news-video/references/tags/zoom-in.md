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

## Interaction with other tags

- **`focus_object`** — the focus tag **wins**, and that is correct: an aimed
  move already carries its own zoom (`scale`) and its own timing (`peakFrame`),
  and the two zooms would fight. If an author writes both, use the focus tag
  and say in the report that `zoom_in` was ignored. If they wanted a stronger
  push toward the subject, the knob is the focus point's own `scale`.
- **`fill_full_screen`** — composes cleanly; one picks the framing, the other
  the motion.
- **`slide_left_right` / `slide_right_left`** — conflict. Both own the
  transform. The slide wins (it is the more specific request); report it.

## Parsing

Registered as an **optional-value key**: it is valid bare and valid with a
value, so `parse-tags.mjs` returns it in `tags{}` with `""` when written bare.
Read the value with `parsePercent()` from the same module, which accepts `50%`,
`50 %` and a bare `50` alike.

See `zoom-out.md` for the pull-back, which is this tag reversed.
