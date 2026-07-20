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
   - `x`: 0 = left edge, 1 = right edge
   - `y`: 0 = top edge, 1 = bottom edge
4. **Choose how tight to go.** `scale` is the zoom factor at the peak of
   the move — roughly 1.15 for a single large subject, 1.35 for one person in
   a group, up to 1.6 for one face in a crowd. Never above 1.8: past that the
   source pixels show.
5. **Say what you saw, in chat.** One line per asset:
   `anh_2.jpg — "nhân vật đeo mặt nạ" → người đeo mặt nạ đen, thứ 2 từ trái → focus (0.38, 0.31), zoom 1.35`.
   The author is the only one who can catch a misidentification, and they can
   only catch it if you tell them what you picked.

## What lands in `spec.json`

The tag resolves into plain numbers on the asset:

```json
"focus": { "x": 0.38, "y": 0.31, "scale": 1.35, "note": "nhan vat deo mat na, thu 2 tu trai" }
```

`x`/`y` are normalised **against the picture itself**, not against the
1080×1920 frame — the renderer converts, differently for cover and for
blur-pad. `note` is never read by the renderer; it exists so a saved
`spec.json` still explains *why* the numbers are what they are, months later.

## How it changes the motion

The tag's contract is only: **the described thing ends up large and as centred
as the picture allows.** How tight and how fast is your call — `focus.scale`
is the dial, and varying it keeps a video with several focused assets from
feeling mechanical.

What it must not do is add a bespoke rendering path. Per the house rule in
`motion.md`, a tag changes which parameters `Scene.tsx` receives. If a genuinely
new movement is wanted, it becomes a named effect in
`knowledge/effect-catalog.md` plus a branch in `computeTransform` — available
to every asset, not just this tag.

### What the renderer actually does with it

`computeFocusTransform` in `Scene.tsx` pushes from scale 1 to `focus.scale`
and **translates** the picture so the focus point travels toward the centre of
frame.

Not `transform-origin`: scaling *about* the focus point only makes the subject
bigger where they already stand — someone at the left edge stays at the left
edge. Moving the subject to the middle means moving the image.

**Full centring is usually impossible, and that's expected.** Bringing a face
at x=0.1 to dead centre would need roughly scale 5 before the picture is wide
enough to allow the shift. The translate is therefore clamped to what the
image can give, so an edge subject ends up large and *closer* to centre, never
dead centre — and never with a blurred sliver or black band creeping in. If
you need a subject tighter, raise `focus.scale`; don't expect the framing to
obey beyond what the pixels allow.

The alternation counter for the `zoom` class **skips** an asset that carries
this tag — a forced, aimed move must not flip the next portrait's turn.

## Interaction with framing

`focus_object` decides where the camera looks. It says nothing about whether
the frame is edge-to-edge or blur-padded — that is a separate tag's job. Both
may appear on the same asset.

You do not have to adjust `x`/`y` for the fit. They are always normalised
against the picture, and `Scene.tsx` works out the painted size for whichever
layout applies (cover-scaled, or contain-scaled inside its blur bands). This
matters: measuring against the 1080×1920 frame instead would make a
blur-padded shot aim past its subject by the height of the bands.

## Parsing

`scripts/parse-tags.mjs` splits the line into `{filename, share, tags}`. It
deliberately does NOT resolve `focus_object` — turning a description into
coordinates needs a look at the image, which is yours to do. The parser only
reports what the author wrote, and returns any unregistered key in
`unknownKeys` so it gets surfaced instead of silently dropped.

## Failure rule

If you genuinely cannot find what the description names — the person isn't
there, the description is ambiguous between two subjects — **do not guess a
coordinate**. Fall back to centre (0.5, 0.5) with `scale: 1.15`, and tell
the user plainly which asset and which description failed. A wrong focus point
is worse than no focus point: it zooms confidently into the wrong face.
