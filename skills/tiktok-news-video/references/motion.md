# Motion — how each asset gets its movement

The authoritative rules live in `$CODE_ROOT/knowledge/effect-catalog.md`. Read
it before classifying. This file covers the *operational* side: what to run,
what to pass, and how per-scene overrides interact with the automatic rules.

## Automatic classification (the default path)

For each scene's asset, run `scripts/probe-asset.mjs` to get
`{type, width, height}`. `build-spec.mjs` also needs this for pan's real
crop-overflow traversal.

Apply the classification table in `knowledge/effect-catalog.md` exactly:

| Asset class | Effect |
|---|---|
| landscape image (`w/h >= 1.2`) | **pan** — real Ken-Burns traversal |
| portrait image (`h/w >= 1.2`) | **zoom** — push/pull alternating |
| square-ish image (`0.83 <= w/h < 1.2`) | **diagonal**, drift direction alternating L↔R |
| any video | **passthrough** — native playback, no synthetic motion |

Plus a `contain-blur-pad` fit override when cropping would lose too much (see
the catalog's thresholds: images > 0.75 crop fraction, videos > 0.15).

**A blur-padded image is never full-bleed.** It rests inset to ~86% of the
frame (`BLUR_PAD_CONTENT_FRACTION`, in both `Scene.tsx` and `build-spec.mjs`),
so a blurred border rings it on all four sides even when the source is already
near 9:16, and its zoom is capped (~1.09×) so the push can't close that border.
`fill_full_screen` opts out (cover, edge-to-edge). The **hook scene's image is
the exception** — `isHook` always covers, because it sits inside the HookCard's
own frame (see `hook-and-brand.md`).

Alternation is tracked **per class**, not globally — two portraits back to
back get push then pull, and a landscape between them doesn't disturb that
sequence. `build-spec.mjs`'s `occurrence` counters already do this; don't
re-implement it.

## Per-asset overrides — tags

Optional **tags** after a filename force a specific effect, fit, or focus for
one asset instead of letting aspect ratio decide. The grammar and the list of
implemented keys live in `tags/README.md`; each key has its own reference file
that you open when you meet that key.

Invariants every tag holds:

- **Absent tag = automatic.** Never require a tag; the pipeline must stay
  usable by an employee who types only filenames.
- **The render is deterministic.** `spec.json` holds only numbers, and Remotion
  is a pure function of it. A tag may be resolved by *looking at the image at
  build time* (that is exactly what `focus_object` does) as long as what lands
  in `spec.json` is the resolved number, not the instruction to go look.
- **Overrides feed `classifyAsset`, not `Scene.tsx`.** The Remotion side stays
  one parametric component; an override changes which parameters it receives,
  never adds a bespoke code path.

## Step 1c — suggest tags for the images left untagged (a user pause)

The automatic classification always produces a working video, but a whole
script of bare filenames leans on just three defaults (pan / zoom / diagonal),
so a long run can read **flat** — the author's complaint that a video "bị nhạt
mắt". This step offers to enrich it, once, before the paid TTS call.

**When it fires:** only when **at least one image carries no tag at all**. It is
a conditional stop (contract #3 / Step 1c). If every image is already tagged, or
the screens hold only videos, say nothing and move on.

**What it touches:** only the **untagged images**.

- An image with **any** tag is the author's own choice — leave it exactly as
  written, never re-suggest for it. "Có tag thì để yên."
- **Videos are skipped** — they are `passthrough`, there is no motion to add.
- `focus_object` is **never suggested**: it needs to know what is *in* the
  picture, which a size-based suggestion cannot see. Suggest only the geometric
  tags (`slide_*`, `zoom_in`/`zoom_out`, `flip_book`, `fill_full_screen`).

**How to suggest — beat the default, don't reproduce it.** First
`probe-asset.mjs` every untagged image for its pixel `w`/`h`. The suggestion
must be a move the aspect-ratio default would *not* already make — otherwise
accepting it changes nothing. Aim for compound moves (different slots multiply)
and vary across the run so no two consecutive shots read alike:

| Untagged image | Default it would get | Suggest instead (livelier) |
|---|---|---|
| landscape (`w/h ≥ 1.2`) | pan | `fill_full_screen \| slide_left_right`, alternating `slide_right_left` — a full-bleed sweep with no blur bands |
| portrait (`h/w ≥ 1.2`) | zoom push/pull | `zoom_in \| slide_top_bottom` — push in while drifting down the tall frame; alternate `zoom_in`/`zoom_out` |
| square-ish (`0.83–1.2`) | diagonal | `zoom_in`, every other one `flip_book \| zoom_in` for rhythm |

Two guards on top of the table:

- **Resolution, not just ratio.** The probe gives pixel size — use it. On a
  **low-resolution** image a `zoom_in` or a `fill_full_screen` magnifies and
  crops into compression artefacts. There, drop the crop/push: prefer a
  `zoom_out` (pulling back shows less of the mush) or a plain `slide_*` over the
  blur-pad instead of a full-bleed one.
- **Anti-repetition.** Never propose the same top move on two untagged images in
  a row; alternate directions and zoom variants across the sequence. Sameness is
  the exact thing this step exists to break.

**Ask once, showing the concrete per-image suggestions**, not a blind yes/no —
the user is approving specific moves (e.g. "anh_1 → full-bleed sweep, anh_3 →
push-in + page turn"). Two options:

- **Áp dụng gợi ý** → write each accepted tag onto its script line and proceed.
  Applied tags flow through the ordinary `parse-tags.mjs` → `classifyAsset`
  path; nothing bespoke is added to the render.
- **None** → inject nothing. The run proceeds with today's automatic
  classification, unchanged. Declining costs the author nothing.

The invariant still holds: a tag only ever *adds* intent. This step never makes
one a prerequisite — it just stops guessing that bare filenames mean the author
wanted the plainest possible motion.

## House rule — one parametric component

All motion is pure math over the local frame number in
`remotion/src/Scene.tsx`, so it is fully deterministic across renders. Never
write bespoke per-scene motion code. If a new movement is needed, it becomes a
new named effect in the catalog + a branch in `computeTransform`, not a
one-off component.

### Every screen ends on a punch

The last 0.8s of each screen pushes in ~8% and then cuts. It is automatic —
not a tag — and it is on at every screen boundary, because this is feed video
and a frame that sits still reads as the video having stalled.

Three details that are load-bearing:

- **It belongs to the SCREEN, not the shot.** A screen holding three images
  punches once, on its last shot. Punching each shot reads as a stutter.
- **The final screen gets none.** There is no cut for it to land on, and ending
  mid-push looks like the file was clipped.
- **It accelerates** (`PUNCH_EASING`, an ease-IN). An ease-out would do its
  travel early and coast into the boundary, which reads as the shot sagging
  rather than snapping.

It is applied by `PunchWrapper` around whichever media component the shot
chose, so it scales the whole composed frame — blurred backdrop, bands and all
— in one implementation instead of three. Captions and the hook card sit
outside `<Scene>` and deliberately do not punch: text that jumps at every cut
is unreadable.

### The two exceptions, and the geometry that forces them

`pan` and `slide` are **not** `computeTransform` branches. Both are still
parametric and still pure functions of the local frame — they are exceptions to
*where the transform is applied*, not to the rule above.

`computeTransform`'s output lands on a **frame-sized** element with
`object-fit: cover`. That element *clips* the cropped-off sides: the extra image
content is not in the box, so translating the box doesn't reveal it, it drags
the `AbsoluteFill` behind into view as a black band down one edge. The clamp
that prevents that (`clampToAxisOverflow`) bounds travel to
`(scale − 1) × dimension / 2` — a few percent of frame width at any tasteful
zoom, nowhere near a traverse.

So any effect that has to travel across the *real* crop overflow must size the
media element at its true cover-scaled dimensions instead, putting the whole
picture physically in the layout. That is `PanMedia` and `SlideMedia`.

The test for whether a future effect needs the same treatment: **does it move
the frame far enough to leave what a frame-sized element holds?** Pure scale
(`zoom`) and small drifts (`diagonal`) do not. A traverse does.
