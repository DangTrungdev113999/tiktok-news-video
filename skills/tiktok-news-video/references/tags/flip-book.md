# `flip_book` — open a screen by turning a page

```
anh_1.jpg | flip_book
anh_1.jpg | flip_book | slide_left_right
anh_1.jpg | flip_book | zoom_in: 30%
```

A **bare flag**. The picture is uncovered along a straight diagonal fold that
sweeps from the **top-left corner down to the bottom-right**, with a dark
crease riding the moving edge — a page being turned back. Beyond the fold is
the picture's own blurred backdrop, which is already on screen, so the shot
opens *onto* something rather than cutting to it.

Use it to open a new screen. It is a transition, not a camera move.

## It fills the ENTRANCE slot

Tags occupy slots, and this one owns **how the shot begins** (see `README.md`):

- It **composes** with a traverse or a zoom — `flip_book | slide_left_right`
  turns the page onto a picture that then travels across.
- It **replaces** a slide's automatic fly-in. A horizontal slide normally
  arrives from off-frame; write `flip_book` and it turns in instead. Two
  entrances would fight over the same half-second, so the explicit one wins.
- On its own it still moves: a shot with an entrance and nothing else would sit
  frozen after the fold passes, so it gets a gentle 8% push. Any `zoom_in` /
  `zoom_out` you write replaces that default.

## Pace, and why it has its own easing

The fold takes **0.75s** and eases **in and out**, not out.

This one was measured and got fixed. Under the house ease-out curve — which is
~93% complete by the halfway point — the fold swept past before the eye could
find it and the whole gesture read as a hard cut. A page turn wants its
momentum in the middle of the run, where it is actually seen. So entrances
split: a fly-in eases *out* because it should feel like arriving; a fold eases
*in and out* because it should feel like turning.

## Direction is fixed on purpose

Top-left → bottom-right, always. It matches the reference the author supplied,
and a screen full of transitions each going a different way stops reading as a
house style. If a mirrored fold is ever wanted it becomes its own key with its
own row in the registry, not a value on this one.

## What ships

```json
{ "entrance": { "type": "flip_book", "durationInFrames": 23 }, ... }
```

The reveal is a `clip-path` polygon over the sharp foreground: a triangle
growing out of the top-left corner until the fold passes the centre, then a
pentagon closing on the bottom-right. Percentages, so one polygon serves any
frame size. The crease is a second clipped layer carrying a 135° gradient — the
same axis the fold sweeps along, which is what keeps the dark band exactly on
the moving edge instead of drifting off it.

A shot with an entrance renders through `LayeredMedia` (backdrop + foreground +
reveal). When there is no traverse to go with it, `buildSpec` ships a
**degenerate slide** (`from === to`, no travel) so that one component serves
both cases, rather than teaching the cover and blur-pad paths about entrances
as well.

## Parsing

In `KNOWN_FLAGS`, so it comes back in `flags[]`. Given a value, the value is
ignored with a warning and the flag still applies.
