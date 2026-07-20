# `slide_left_right` — travel across the picture, left to right

```
anh_1.jpg | slide_left_right
anh_1.jpg | slide_left_right: 20% 20%
anh_1.jpg | slide_left_right: 20% 20%, top 20%
```

The frame travels across the image from its left side to its right side, at a
steady pace, for the whole length of the shot. This is the tag for a wide
photograph the eye needs time to read: a crowd, a street, a stadium, a
panorama.

See `slide-right-left.md` for the mirror; it is this tag with the two ends
swapped and nothing else changed.

## The value

All parts are optional. Bare, the frame travels the entire width.

```
slide_left_right: <start inset> <end inset>, <vertical anchor>
```

### The two percentages — insets, not positions

`20% 20%` means **start 20% in from the left edge, stop 20% short of the right
edge.** They are always measured from the edge that end of the move is near,
which is what makes `slide_right_left: 20% 20%` mean the mirror image rather
than something the author has to think about.

| Written | Travels from | to |
|---|---|---|
| `slide_left_right` | 0% | 100% |
| `slide_left_right: 20% 20%` | 20% | 80% |
| `slide_left_right: 10% 30%` | 10% | 70% |

Use them to skip dead space — an empty road on the left, a wall on the right —
without cutting the image.

Insets that leave less than 15% of travel are clamped and reported: a slide
with nowhere to go is a still frame that looks like a bug.

### `top 20%` — the vertical anchor

By default the frame sits at the vertical centre of the image and stays there.
`top 20%` says: **make the top 20% band of the picture the centre of frame**
instead. `bottom 20%` does the same from the other edge. Reach for it when the
subject lives in a strip — faces along the top of a group shot, a scoreboard,
a headline in a screenshot.

**An anchor necessarily brings a zoom with it, and that is why the author asks
for one.** Cover-fitting a wide photo into 1080×1920 already binds on height:
the picture is exactly frame-height, so there is no vertical slack to shift
into. To put a band other than the middle in the centre of frame, the image has
to be enlarged first. So an anchored slide **opens with a push** — 1.0× rising
over the first quarter of the shot, then holding while the travel continues.
Without an anchor there is no zoom at all: the slide carries the motion itself.

**How far it pushes depends on how far the anchor sits from centre**, up to a
ceiling of 1.6× — past that the source pixels show, the same limit
`focus_object` uses. A fixed zoom would under-serve a strong ask: bringing a
point at y=0.1 to the middle of a cover-fitted wide photo needs roughly scale 5
before the picture is tall enough to allow the shift, so at 1.3× the frame gets
only ~29% of the way and `top 20%` barely registers. Measured on a test render,
the band moved 110px at 1.3× and 219px at 1.6×.

As with `focus_object`, the shift is clamped to what the picture can actually
give, so a 20% band never literally reaches dead centre — it gets as close as
the pixels allow, which reads as "framed high", and that is what the author
wanted. An anchor nearer the middle (`top 40%`) both needs less zoom and lands
closer to its target.

## The blur layer — how a slide sits on it

The blur backdrop is **its own layer, and it does not move with the picture.**
That single rule settles every question about slides and blur:

| | the blurred backdrop | the sharp picture |
|---|---|---|
| while travelling | stays put | travels |
| an anchor's zoom (`top 20%`) | **stays put** | zooms |
| a `zoom_in` / `zoom_out` tag | scales with it | scales |

So along the axis it travels, the picture is **wider than the frame** — no
blurred band is ever slid past, which is the author's rule *"lia sang phải thì
phần blur bên trái cũng phải mất đi"*. Across the other axis it stays
**shorter** than the frame, and that is where the blur band shows.

The picture is painted as **small as it can be** while still having somewhere
to travel — smaller picture means bigger bands, so minimising the scale is what
maximises the blur. A 3.6:1 photo keeps ~737px of band top and bottom and still
has 540px to traverse. (A fixed 10% band was tried first and was wrong: a 192px
sliver of blur against a backdrop that is a blurred copy of the same picture
reads as full-bleed, and the author said so.)

`fill_full_screen` removes the remaining band by scaling the picture to cover
instead — see the combination table in `README.md`.

A slide needs a picture that is long on the axis it travels. If a portrait is
asked to slide sideways there is no scale that both overflows horizontally and
stays short vertically, so it falls back to cover and `buildSpec` says so in
`spec.warnings`.

## The entrance — a slide arrives, it doesn't cut

Unless a `flip_book` claims the slot first, a horizontal slide **opens by flying
in from the side opposite its travel**: `slide_left_right` enters from the
right, then travels left→right. The blurred backdrop is already on screen when
the shot starts, so what the viewer sees is the picture arriving onto a
background that was already there — a transition into the screen, not a cut.

The entrance takes 0.75s and eases out, so it lands rather than stopping.

## Why this is not a `computeTransform` branch

Every other effect is. This one is a sibling of `PanMedia` instead, and the
reason is load-bearing:

`computeTransform`'s result is applied to a **frame-sized** element with
`object-fit: cover`. That element *clips* the cropped-off sides — the extra
image content is not in the box, so translating the box does not reveal it, it
just slides the AbsoluteFill into view as a black band down one edge. (This
happened, was measured, and was fixed once already.) The clamp that prevents it
bounds travel to `(scale − 1) × dimension / 2`, which at any tasteful zoom is a
few percent of frame width — nowhere near a traverse.

So a real slide has to size the `<Img>` at its **true cover-scaled dimensions**,
putting the whole picture physically in the layout, and translate across that.
That is precisely what `PanMedia` was built to do, and `SlideMedia` is the same
geometry with the endpoints and the anchor exposed.

The component is called `LayeredMedia`, because it also carries the backdrop
and the entrance. Keep `motion.md`'s claim honest: *most* effects are
`computeTransform` branches; `pan` and `slide` are the two documented
exceptions, both for this same reason.

## Pace and easing

Neither `MOTION_EASING` (a hard ease-out, ~93% done by halfway — a slide under
it appears to arrive immediately and then crawl) nor a linear ramp (starts and
stops dead, reading as a mechanical sweep). `SLIDE_EASING` is a symmetric
ease-in-out: it accelerates away from the start, holds an even pace through the
middle where the eye is actually reading the picture, and settles at the end.

## What ships

```json
{
  "effect": "slide",
  "slide": {
    "axis": "x",
    "from": 0.2, "to": 0.8,
    "foregroundScale": 1.536,
    "anchorPos": 0.1, "anchorScale": 1.6
  },
  "entrance": { "type": "slide_in", "fromSide": "right", "durationInFrames": 23 },
  ...
}
```

`from`/`to` are normalised positions along the image, **already resolved from
the insets** — `slide_right_left` differs only in that `from > to`. There is no
direction field, because the endpoints already say which way the move goes and
a sign convention on top of them would be one more thing to get backwards.

`anchorPos` is the centre of the named band (`top 20%` → 0.1), normalised
against the picture, not the frame. Both are omitted entirely when the author
gave no anchor, and the renderer then holds scale 1 and centres vertically.

`foregroundScale` is the size the sharp picture is painted at, chosen to
satisfy the blur-layer rule above. It ships as a number rather than being
recomputed in the renderer, so the inset→position conversion and the render
agree **by construction** instead of by two implementations happening to match.

## Interaction with other tags

- **`focus_object`** — conflict; the focus tag wins. A slide is a survey of a
  whole picture and a focus is a move to one point in it; they cannot both own
  the transform. Report which one was applied.
- **`zoom_in` / `zoom_out`** — **compose.** They fill different slots, so
  `zoom_in 20% | slide_left_right` is a traverse that also closes in. The two
  ramps multiply.
- **`fill_full_screen`** — composes; it removes the blur band on the
  perpendicular axis by scaling the picture to cover.
- **`flip_book`** — composes, and takes the entrance slot, so the slide does
  not also fly in.

## Parsing

An **optional-value key**: valid bare, valid with a value. `parse-tags.mjs`
returns it in `tags{}` with `""` when bare. Read the value with
`parseSlideValue()` from the same module, which accepts the insets with or
without `%`, in either order relative to the anchor clause, and reports what it
could not understand rather than guessing.
