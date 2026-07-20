# `slide_top_bottom` — start centred, drift downward

```
anh_1.jpg | slide_top_bottom
anh_1.jpg | slide_top_bottom: 0% 20%
```

The picture appears at its **vertical centre** and drifts steadily down for the
rest of the shot. Read `slide-left-right.md` first — the value grammar, the
blur-layer rule, the easing, the tag composition and the parsing are all
identical. This file is only the delta.

## Two deltas, and both come from the author's description

> *"ảnh sẽ xuất hiện ở center xong trôi dần xuống dưới"*

**1. It starts at the middle, not at the top edge.** The horizontal slides run
edge to edge by default; this one runs `0.5 → 1.0`. Insets still work and are
still measured from the end they are near, but the default start is the centre
of the picture rather than its top.

**2. It does not fly in.** The horizontal slides open by arriving from
off-frame, because nothing else says where they begin. This tag's own
description *is* its opening — it appears where it appears — so adding a fly-in
would contradict the author. `flip_book` can still be added explicitly if a
stronger transition is wanted.

## What it needs from the picture

A slide travels along its axis, so this one wants a **tall** picture — a
portrait, a phone screenshot, a poster. Given a landscape photo there is no
scale that both overflows vertically and stays narrow enough to leave a blur
band either side, so it falls back to cover and `buildSpec` puts a line in
`spec.warnings`. Read that warning; a wide photo asked to drift downward
produces a shot that barely moves.

The blur bands sit **left and right** here, not top and bottom — they are
always on the axis perpendicular to travel.

## Where it earns its place

Downward drift reads as *reading*: it follows the eye down a tall image the way
a person scans one. Use it for screenshots of posts, articles, chat threads,
long posters — anything whose meaning runs top to bottom.

For a person or an object in a tall frame, prefer `focus_object` or an aimed
`zoom_in`; a drift past a face is motion without attention.

## What ships

```json
{
  "effect": "slide",
  "slide": { "axis": "y", "from": 0.5, "to": 1, "foregroundScale": 0.9 },
  ...
}
```

`axis: "y"` is the only structural difference from the horizontal slides — the
same component, the same maths, one field apart. Note the absent `entrance`.
