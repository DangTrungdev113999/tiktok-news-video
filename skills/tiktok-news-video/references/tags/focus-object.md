# `focus_object` — point the camera at a specific thing in the image

```
anh_1.jpg | focus_object: nguoi thu 1 tu trai sang
anh_2.jpg | focus_object: nhan vat deo mat na, luc "su bin hoang son"
anh_3.jpg | focus_object: chan dung nguoi dan ong ao vest
```

The value is **free-form natural Vietnamese**. It describes *what* in the
picture matters. There is no enum to memorise — the author writes what they
would say out loud.

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
2. **Locate what the description names.** Ordinal descriptions ("nguoi thu 3
   tu trai sang") are counted left-to-right by the subject's own horizontal
   centre, not by where their limbs reach.
3. **Write down the focus point** as normalised coordinates of the subject's
   visual anchor — for a person, the **face**, not the body centroid:
   - `focusX`: 0 = left edge, 1 = right edge
   - `focusY`: 0 = top edge, 1 = bottom edge
4. **Write down a focus tightness**, `focusScale`, the zoom factor at the peak
   of the move. 1.35 for a person in a group, 1.15 for a single large subject,
   up to 1.6 for one face in a crowd. Never above 1.8 — past that the source
   pixels show.
5. If the description also carries `luc "<cụm từ>"`, resolve the cue (below).
6. **Say what you saw, in chat.** One line per asset:
   `anh_2.jpg — "nhan vat deo mat na" → người đeo mặt nạ đen, thứ 2 từ trái → focus (0.38, 0.31), zoom 1.35`.
   The author is the only one who can catch a misidentification, and they can
   only catch it if you tell them what you picked.

## The `luc "..."` cue

`luc "<cụm từ>"` inside the value pins the *peak* of the move to the moment
that phrase is spoken.

- Match against that scene's `words[]` from Step 4, **diacritic-insensitive
  and case-insensitive** — fold both sides to lowercase ASCII before comparing,
  so `su bin hoang son` matches `Su Bin Hoàng Sơn`.
- **First occurrence wins.** If the phrase occurs more than once in the scene,
  use the first and say so in chat.
- **Phrase not found** → this is an author error worth surfacing. Fall back to
  the middle of the asset's window and tell the user the phrase wasn't in the
  narration for that scene.
- The cue **outranks a `(30%)` share**: widen or shift the asset's window so it
  contains the cue frame, then re-split the remaining time among the other
  assets. Report the adjustment.

## What lands in `spec.json`

The tag resolves into plain numbers on the asset:

| Field | Meaning |
|---|---|
| `focusX`, `focusY` | 0–1 normalised focus point → `transform-origin` |
| `focusScale` | zoom factor at the peak |
| `focusPeakFrame` | absolute frame the peak lands on; null = middle of the window |
| `focusNote` | the human-readable line you reported in chat |

`focusNote` is not read by the renderer. It exists so that the saved
`spec.json` explains *why* the numbers are what they are, months later.

## How it changes the motion

`focus_object` **forces the effect to `zoom` (push-in)** and overrides its
origin and timing. It does not add a new effect. Per the house rule in
`motion.md`, the tag changes which parameters `Scene.tsx` receives; it never
adds a branch.

Concretely, versus an automatic zoom:

| | Automatic | With `focus_object` |
|---|---|---|
| Origin | image centre | `(focusX, focusY)` |
| Direction | alternates push/pull by occurrence | always push in |
| Peak | end of the window | `focusPeakFrame` |

The alternation counter for the `zoom` class **skips** an asset that carries
this tag — a forced push must not flip the next portrait's turn.

## Interaction with `fill_full_screen`

Independent. `focus_object` decides where the camera looks; `fill_full_screen`
decides whether the frame is edge-to-edge or blur-padded. Both may appear on
the same asset. If blur-padded, the focus point is normalised against the
**visible image**, not the padded 1080×1920 frame.

## Failure rule

If you genuinely cannot find what the description names — the person isn't
there, the description is ambiguous between two subjects — **do not guess a
coordinate**. Fall back to centre (0.5, 0.5) with `focusScale: 1.15`, and tell
the user plainly which asset and which description failed. A wrong focus point
is worse than no focus point: it zooms confidently into the wrong face.
