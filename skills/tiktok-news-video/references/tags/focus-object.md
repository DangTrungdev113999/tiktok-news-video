# `focus_object` — point the camera at a specific thing in the image

```
anh_1.jpg | focus_object: người thứ 1 từ trái sang
anh_2.jpg | focus_object: nhân vật đeo mặt nạ
anh_3.jpg | focus_object: chân dung người đàn ông áo vest
```

The value is **free-form**. It describes *what* in the picture matters, in
whatever words the author would use out loud. There is no enum, no sub-syntax,
and no reserved words inside the value — everything after the colon is
description, and you interpret it the way a person would.

Its job: the pipeline cannot tell which person in a group photo the narration
is talking about. Only the author knows. This tag carries that knowledge in.

## The rule that makes this safe

**Vision runs at BUILD time, never at render time.**

You look at the image once, while building `spec.json`, and write down
**numbers**. Remotion then renders from those numbers and never looks at an
image. The render stays a pure function of `spec.json` — same spec, same
frames, every time.

(An earlier design note in `motion.md` claimed image-aware focusing was
impossible because it would break determinism. That was wrong: it conflated
build time with render time. Build-time vision is fine and is the whole basis
of this tag.)

## Resolution procedure

For each asset carrying `focus_object`:

1. **Read the image file** with the Read tool
   (`$WORKSPACE_DIR/assets/<filename>`). Actually look at it — this is the one
   step in the pipeline where vision is the point.
2. **Locate what the description names.** Ordinal descriptions ("người thứ 3
   từ trái sang") are counted left-to-right by each subject's own horizontal
   centre, not by where their limbs reach.
3. **Write down the focus point** as normalised coordinates of the subject's
   visual anchor — for a person, the **face**, not the body centroid:
   - `focusX`: 0 = left edge, 1 = right edge
   - `focusY`: 0 = top edge, 1 = bottom edge
4. **Choose how tight to go.** `focusScale` is the zoom factor at the peak of
   the move — roughly 1.15 for a single large subject, 1.35 for one person in
   a group, up to 1.6 for one face in a crowd. Never above 1.8: past that the
   source pixels show.
5. **Say what you saw, in chat.** One line per asset:
   `anh_2.jpg — "nhân vật đeo mặt nạ" → người đeo mặt nạ đen, thứ 2 từ trái → focus (0.38, 0.31), zoom 1.35`.
   The author is the only one who can catch a misidentification, and they can
   only catch it if you tell them what you picked.

## What lands in `spec.json`

The tag resolves into plain numbers on the asset:

| Field | Meaning |
|---|---|
| `focusX`, `focusY` | 0–1 normalised focus point → `transform-origin` |
| `focusScale` | zoom factor at the peak |
| `focusNote` | the human-readable line you reported in chat |

`focusNote` is not read by the renderer. It exists so that the saved
`spec.json` explains *why* the numbers are what they are, months later.

## How it changes the motion

The tag's contract is only: **the described thing ends up large and centred in
frame.** Which movement gets it there is your call — push in on it, hold it
steady while the rest drifts, settle onto it off a wider start. Vary it so a
video with several focused assets doesn't feel mechanical.

What it must not do is add a bespoke rendering path. Per the house rule in
`motion.md`, a tag changes which parameters `Scene.tsx` receives. If a genuinely
new movement is wanted, it becomes a named effect in
`knowledge/effect-catalog.md` plus a branch in `computeTransform` — available
to every asset, not just this tag.

**This is real `Scene.tsx` work, not a free parameter pass.** As of 2026-07-20
`computeTransform` hardcodes `transform-origin: center center` (four call
sites) and the `zoom` branch always runs the fixed `ZOOM_END` constant across
the whole window. Shipping this key means widening that branch to take an
origin and a target scale.

The alternation counter for the `zoom` class **skips** an asset that carries
this tag — a forced, aimed move must not flip the next portrait's turn.

## Interaction with framing

`focus_object` decides where the camera looks. It says nothing about whether
the frame is edge-to-edge or blur-padded — that is a separate tag's job. Both
may appear on the same asset. If the asset is blur-padded, the focus point is
normalised against the **visible image**, not the padded 1080×1920 frame.

## Failure rule

If you genuinely cannot find what the description names — the person isn't
there, the description is ambiguous between two subjects — **do not guess a
coordinate**. Fall back to centre (0.5, 0.5) with `focusScale: 1.15`, and tell
the user plainly which asset and which description failed. A wrong focus point
is worse than no focus point: it zooms confidently into the wrong face.
