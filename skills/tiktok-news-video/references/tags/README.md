# Tags — the per-asset override vocabulary

A scene line may carry zero or more **tags** after the filename. Tags are how
a non-technical author says something the pipeline cannot infer on its own.

```
anh_1.jpg | focus_object: nguoi thu 1 luc "su bin hoang son"
anh_2.jpg | fill_full_screen
anh_3.jpg
```

The third line is the normal case. **Absent tag = automatic.** No tag is ever
required, and an author who types only filenames must always get a working
video.

**The default look is blur-padded, not full-bleed.** Every image is shown whole
at its natural size, with a blurred copy filling the rest of the frame — bands
top and bottom for a landscape, left and right for a portrait, decided by the
ratio. Edge-to-edge is opt-in via `fill_full_screen`, because cropping is the
choice that throws content away and so is the one worth asking for.

## Grammar

| Rule | Detail |
|---|---|
| Separator | ` \| ` between the filename and each tag, and between tags |
| Key form | ASCII snake_case ID — no Vietnamese diacritics, no spaces |
| Key/value | `key: value`. The value's shape is that key's own business |
| Bare flags | A few tags have no value and are written as the key alone |
| Duration share | `(30%)` directly after the filename — not a tag; see below |
| Unknown key | **Report it to the user and continue** — never silently drop it, never guess |

Values are free-form for keys that say so. `focus_object` takes natural
Vietnamese; most other keys take a fixed enum.

### Loose forms are accepted on purpose

Teach the canonical form above. But `scripts/parse-tags.mjs` accepts sloppier
input, because the people typing these lines are not programmers and rejecting
an otherwise clear line is a worse outcome than parsing it slightly loosely.
All of these mean the same thing:

```
anh_1.jpg | focus_object: nguoi thu 1
anh_1.jpg : focus_object nguoi thu 1
anh_1 focus_object nguoi thu 1
```

Two rules make that safe: **the filename is always the first token**, and **a
tag always begins at a registered key**. Everything between one key and the
next is the first key's value — which is why a value can hold spaces, commas,
quotes and diacritics with no escaping at all.

Do NOT relax this further by guessing at unregistered words. An unknown key is
reported, never interpreted.

## One screen, several assets

A screen may hold several images, several videos, or a mix — one per line:

```
Screen 3:
anh_1.jpg (30%) | focus_object: người thứ 1 từ trái sang
anh_2.jpg (70%) | focus_object: nhân vật đeo mặt nạ
video_1.mp4
```

### Cut where the narration says so — this is the normal case

**Authors rarely type `%`, and they shouldn't have to.** They expect the image
to change when the voice reaches what that image shows. You have everything
needed to do that: narration is the user's text **verbatim** (no rewrite pass
can remove the words a tag points at) and Step 2 gives you **word-level
timing**.

So when a screen holds several assets, work out from the narration *when* each
one becomes the thing being talked about, and pin it there — pass
`assets[].startSec` to `buildSpec`. A `focus_object` description naming a
person is the strongest signal: cut to that image on the word that names them.

Judge it like an editor, not a stopwatch: cut a beat *before* the name lands
rather than after, and don't cut so often it flickers. `buildSpec` enforces a
0.5s floor per shot and falls back to an even split if the pins can't fit.

Say what you chose in the Step 6 report — which asset, which moment, which
word.

### `(30%)` — when the author does want to say it

`(30%)` is **that asset's share of the screen's duration**. It's the fallback
when nothing in the narration marks a natural cut. The screen's total length is
still set by the narration for that screen; `%` only decides how it is divided.

| Case | Result |
|---|---|
| No `%` anywhere | split evenly |
| `%` on every asset | use them; if they don't total 100, normalise and say so |
| `%` on some only | the tagged ones take their share, the rest split what's left |
| `%` totalling over 100 | normalise down, report it |

Captions are unaffected — they are global and track the speech, not the
assets.

## Registered keys

| Key | Slot | Value | Reference |
|---|---|---|---|
| `focus_object` | traverse | free-form description of what to focus on | `focus-object.md` |
| `slide_left_right` | traverse | optional `20% 20%, top 20%` | `slide-left-right.md` |
| `slide_right_left` | traverse | optional — same grammar, mirrored | `slide-right-left.md` |
| `slide_top_bottom` | traverse | optional — starts centred, drifts down | `slide-top-bottom.md` |
| `zoom_in` | zoom | optional `50%`, and `target 1 trong anh_1_des.jpg` | `zoom-in.md` |
| `zoom_out` | zoom | optional — same, pulling back | `zoom-out.md` |
| `flip_book` | entrance | none — bare flag | `flip-book.md` |
| `fill_full_screen` | fit | none — bare flag | `fill-full-screen.md` |

When you meet a key in this table, **open its reference file before acting**.
The table is the whole contract — a key not listed here is not implemented.

### Three kinds of key

The parser distinguishes them, and so should you when teaching the syntax:

| Kind | Written | Example |
|---|---|---|
| Value required | `key: value` | `focus_object` |
| Bare flag | `key` alone; a value is ignored with a warning | `fill_full_screen`, `flip_book` |
| Value optional | either; bare means "use the default" | `zoom_in`, `slide_left_right` |

## Tags fill SLOTS — different slots compose

Tags are not rivals in general. Each fills one slot, and **only two tags in the
SAME slot conflict**:

| Slot | Decides | Keys |
|---|---|---|
| `fit` | edge-to-edge or blur bands | `fill_full_screen` |
| `entrance` | how the shot BEGINS | `flip_book` |
| `traverse` | where the camera goes during it | `focus_object`, `slide_*` |
| `zoom` | how close it gets | `zoom_in`, `zoom_out` |

Within a slot the more specific key wins and the loser is **reported, never
silently dropped** — for `traverse` that order is `focus_object` first, then the
slides.

### Worked combinations

```
anh_1.jpg | fill_full_screen | slide_left_right 20%
```
Travel left→right across the picture, starting 20% in from its left edge and
running to the far edge (one number = the START inset; the end defaults to 0).
`fill_full_screen` fills the `fit` slot, so the picture is scaled to cover and
**the blur band that a slide normally leaves is gone** — edge to edge for the
whole traverse.

```
anh_1.jpg | zoom_in 20% | slide_left_right
```
Different slots, so they **compose**: the picture travels the full width AND
closes in 20% over the shot. The two ramps multiply. This is not a conflict and
must not be reported as one.

```
anh_1.jpg | flip_book | slide_left_right
```
The page turns onto the picture, which then travels. `flip_book` fills the
`entrance` slot, so the slide does not ALSO fly in — one opening, not two.

```
anh_1.jpg | focus_object: người áo hồng | slide_left_right
```
The only real conflict here: both are the `traverse`. `focus_object` wins,
the slide is ignored, and you say so in the Step 6 report.

## Adding a key

Per the project's standing rule, keys ship one at a time:

1. Write the key's reference file in this directory.
2. Add the row to the table above.
3. Only then touch the parser, `spec-types.ts`, `build-spec.mjs`, `Scene.tsx`.

Two invariants every key must hold:

- **Absent = automatic.** A tag adds intent; it never becomes a prerequisite.
- **Overrides feed `classifyAsset`, not `Scene.tsx`.** A tag changes which
  parameters the one parametric scene component receives. It never adds a
  bespoke rendering path.
