# `focus_object` — point the camera at a specific thing in the image

```
anh_1.jpg | focus_object: người thứ 1 từ trái sang
anh_2.jpg | focus_object: 1 trong anh_2_des.jpg lúc "Trung Đặng"
anh_3.jpg | focus_object: chân dung người đàn ông áo vest
```

The value is **free-form**. It describes *what* in the picture matters, in
whatever words the author would use out loud. There is no enum and no fixed
grammar — read it the way a person would.

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

## Description images — the reliable way to say who

When the author writes `1 trong anh_2_des.jpg`, there is a second file beside
the asset: the same photo with **markers drawn on it**. `anh_2.jpg` is what
gets rendered; `anh_2_des.jpg` exists only to tell you who "1" is.

**A marker is whatever the author drew.** Digits (`1`, `2`, `3`), letters
(`a`, `b`, `c`), or anything else legible — the only requirement is that it is
findable in the description image and that the author referred to it. Do not
insist on a numbering scheme; read what is there.

This beats an ordinal description ("người thứ 3 từ trái") because it removes
the counting, which is where misidentification comes from. Prefer it, and
suggest it to the author when a photo is crowded.

**Read BOTH files.** The description image identifies; the original is what
you measure against.

> **A marker is a pointer, not a coordinate.** Markers get placed *near* their
> subject and often land on top of whatever is behind them. In the reference
> screenshot the "1" sits squarely on a mascot's head, immediately left of the
> man it actually refers to — taking the marker's own position would have
> zoomed into the mascot. Work out **who** the marker indicates, then find that
> person **in the original image** and take their face. Never take coordinates
> off the description image.

The same marker mechanism is available to `zoom_in` / `zoom_out` via
`target 1 trong anh_1_des.jpg` — see `zoom-in.md`. Resolve it exactly as you
resolve a marker here; it is the same job, and an aimed zoom ships as a
single-point `focus` entry.

Description images are **not renderable assets**. Never put one in a screen's
`assets[]`; it appears only inside a `focus_object` value.

## Several subjects in one image

One picture often earns more than one moment:

```
anh_1.jpg | focus_object: 1 lúc "Sơn Tùng", 2 lúc "Trung Đặng"
```

The camera visits each in turn, **landing on each subject exactly as they are
named**, then holding until it's time to move on. Resolve one entry per
subject, in the order the narration names them, and pass `focus` as an
**array**:

```json
"focus": [
  { "x": 0.22, "y": 0.28, "scale": 1.5, "peakSec": 3.0, "note": "so 1 - ao vest xanh" },
  { "x": 0.75, "y": 0.31, "scale": 1.5, "peakSec": 6.2, "note": "so 2 - ao vest hong" }
]
```

`buildSpec` enforces that the cues are in time order and at least 12 frames
apart, and warns when it had to move one. A single subject is just an array of
one — pass a bare object and it's wrapped for you.

**Give each leg room.** Two names spoken a second apart in a wide photo means
the camera lurches. Better to focus only the subjects that matter, or let the
screen run longer.

### Travelling between them

`Scene.tsx` doesn't cut between subjects and doesn't whip-pan. It eases the
zoom back on the way across, glides over, and pushes back in — the way a real
camera repositions. That relief beat only triggers when the two subjects are
genuinely far apart, so two faces side by side still get a simple, direct
move. Both the zoom AND the aim are interpolated, which is what keeps the
subject glued to the middle of the travel instead of sliding through frame.

## `lúc "..."` — land the zoom on a word

`lúc "Trung Đặng"` inside the value means: **the push reaches its peak exactly
as that name is spoken**, then holds. This is the "zoom sync với text"
requirement — a zoom still travelling while the name goes by has missed its
cue.

Resolve it against that screen's `words[]` from Step 2:

- Match **diacritic-insensitively and case-insensitively** — fold both sides to
  lowercase ASCII, so `trung dang` matches `Trung Đặng`.
- **First occurrence wins.** Say so in chat if the phrase occurs more than once.
- **Phrase not found** → an author error worth surfacing. Fall back to peaking
  at the end of the shot, and tell the user the phrase wasn't in that screen's
  narration.
- Pass the matched word's start time as `focus.peakSec` (absolute audio
  seconds). `buildSpec` converts it to a shot-local frame.

**Cut early, peak on the word.** If the asset is also pinned to a cut (see
`README.md`), start the shot a beat *before* the name so the push has run-up.
`buildSpec` enforces a 6-frame minimum, but 0.5–1s reads far better — a push
with no run-up is just a static crop.

## Resolution procedure

For each asset carrying `focus_object`:

1. **Read the image** (`$WORKSPACE_DIR/assets/<filename>`) — and the
   description image too, if the value names one.
2. **Locate what the description names.** Via a marker where there is one;
   otherwise by the words. Ordinals ("người thứ 3 từ trái sang") count
   left-to-right by each subject's own horizontal centre, not by where their
   limbs reach.
3. **Take the focus point from the ORIGINAL image**, normalised — for a
   person, the **face**, not the body centroid:
   - `x`: 0 = left edge, 1 = right edge
   - `y`: 0 = top edge, 1 = bottom edge
4. **Choose how tight to go.** `scale` is the zoom at the peak — roughly 1.12
   for a single large subject, 1.2 for one person in a group, up to 1.3 for one
   face in a crowd. **1.3 is a hard ceiling** and the renderer clamps to it: an
   aimed move is already carrying the eye somewhere, so it needs far less scale
   than an untargeted zoom to register, and more reads as a lunge. Ask for a
   bigger number and you will simply get 1.3.
5. **Resolve `lúc "..."`** to `peakSec`, if present.
6. **Say what you saw, in chat.** One line per asset:
   `anh_2.jpg — "1 trong anh_2_des.jpg" → người áo vest hồng bên phải (không phải con thú bông mà số 1 đè lên) → focus (0.75, 0.31), zoom 1.35, đỉnh tại "Trung Đặng" (7.0s)`.
   The author is the only one who can catch a misidentification, and they can
   only catch it if you tell them what you picked.

## The two shapes — what you pass vs what ships

(Shown here with a single target for clarity; the same conversion applies to
every entry when `focus` is an array.)

**What you pass to `buildSpec`** — timing in absolute audio seconds, because
that's what Step 2 gives you:

```json
"focus": { "x": 0.75, "y": 0.31, "scale": 1.35, "peakSec": 7.0, "note": "nguoi ao vest hong ben phai" }
```

**What lands in `spec.json`** — `buildSpec` converts the cue to a shot-local
frame and drops `peakSec`, so the renderer only ever sees render-ready numbers:

```json
"focus": { "x": 0.75, "y": 0.31, "scale": 1.35, "peakFrame": 30, "note": "nguoi ao vest hong ben phai" }
```

`x`/`y` are normalised **against the picture itself**, not against the
1080×1920 frame — the renderer converts, differently for cover and for
blur-pad. `note` is never read by the renderer; it exists so a saved
`spec.json` still explains *why* the numbers are what they are, months later.

### Check `spec.warnings` before you render

The cut (`assets[].startSec`) and the peak (`focus.peakSec`) are two things
**you** set independently, so they can disagree — pin the cut at 7.5s for a
name spoken at 7.0s and the zoom cannot possibly peak on it. `buildSpec`
clamps the cue into the shot so the render still works, and puts a line in
`spec.warnings` saying which asset and by how much.

**Report every one of those to the user in the Step 6 report.** A silently
clamped cue looks exactly like a cue that worked, and it defeats the only
thing `lúc "..."` exists to do.

## How it changes the motion

The tag's contract: **the described thing ends up large and as centred as the
picture allows, arriving on cue.**

It must not add a bespoke rendering path. Per the house rule in `motion.md`, a
tag changes which parameters `Scene.tsx` receives. A genuinely new movement
becomes a named effect in `knowledge/effect-catalog.md` plus a branch in
`computeTransform` — available to every asset, not just this tag.

### What the renderer actually does with it

`computeFocusTransform` in `Scene.tsx` pushes from scale 1 to `focus.scale`,
reaching it at `peakFrame` and holding for the rest of the shot, while
**translating** the picture so the focus point travels toward centre.

Not `transform-origin`: scaling *about* the focus point only makes the subject
bigger where they already stand — someone at the left edge stays at the left
edge. Moving them to the middle means moving the image.

It also uses `FOCUS_EASING`, not the house `MOTION_EASING`. The house curve is
a hard ease-out, ~93% done by the halfway point — right for ambient Ken-Burns
drift, wrong for a move that must land on a word, because the eye reads the
arrival a third of the way in and the cue passes unmarked.

**Full centring is usually impossible, and that's expected.** Bringing a face
at x=0.1 to dead centre would need roughly scale 5 before the picture is wide
enough to allow the shift. The translate is clamped to what the image can
give, so an edge subject ends up large and *closer* to centre, never dead
centre — and never with a blurred sliver or black band creeping in. Want it
tighter? Raise `scale`; don't expect framing beyond what the pixels allow.

The alternation counter for the `zoom` class **skips** an asset carrying this
tag — an aimed move must not flip the next portrait's push/pull.

## Interaction with framing

`focus_object` decides where the camera looks. It says nothing about whether
the frame is edge-to-edge or blur-padded — that is a separate tag's job. Both
may appear on the same asset.

You do not adjust `x`/`y` for the fit. They are always normalised against the
picture, and `Scene.tsx` works out the painted size for whichever layout
applies. This matters: measuring against the 1080×1920 frame instead would
make a blur-padded shot aim past its subject by the height of the bands.

## Parsing

`scripts/parse-tags.mjs` splits the line into `{filename, share, tags}`. It
deliberately resolves nothing — turning a description into coordinates needs a
look at the image, and `lúc "..."` needs Step 2's word timing. Both are yours
to do, at Step 4. The parser returns any unregistered key in `unknownKeys` so
it gets surfaced instead of silently dropped.

## Failure rule

If you genuinely cannot find what the description names — the person isn't
there, a marker is ambiguous between two subjects — **do not guess a
coordinate**. Fall back to centre (0.5, 0.5) with `scale: 1.15`, and tell the
user plainly which asset and which description failed. A wrong focus point is
worse than none: it zooms confidently into the wrong face.
