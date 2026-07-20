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
| square-ish image (`0.83 <= w/h < 1.2`) | **diagonal** / **rotate**, alternating |
| any video | **passthrough** — native playback, no synthetic motion |

Plus a `contain-blur-pad` fit override when cropping would lose too much (see
the catalog's thresholds: images > 0.75 crop fraction, videos > 0.15).

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

## House rule — one parametric component

All motion is pure math over the local frame number in
`remotion/src/Scene.tsx`, so it is fully deterministic across renders. Never
write bespoke per-scene motion code. If a new movement is needed, it becomes a
new named effect in the catalog + a branch in `computeTransform`, not a
one-off component.

### Every screen ends on a punch

The last 0.25s of each screen pushes in ~12% and then cuts. It is automatic —
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
(`zoom`) and small drifts (`diagonal`, `rotate`) do not. A traverse does.
