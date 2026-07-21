# Hook scene and brand kit

## The hook scene

Scene index 0 gets `isHook: true` plus a `hookHeadline`.

**Default `hookHeadline` to that screen's OWN narration text, verbatim**,
rendered ALL-CAPS by the component. This is "the hook" the user is
already saying in scene 1 — it is not a separately-invented stat headline. Do
not craft a new sentence here unless the user explicitly asks for one. (This
was tried and corrected on 2026-07-18.)

The hook scene is **excluded from karaoke captions** — Step 2's `words[]` for
that scene is simply not passed to `buildSpec`. It gets the hook-card overlay
instead: gradient card + brand badge + the headline, rendered by
`remotion/src/HookCard.tsx`.

The card has **no reveal/fade-in animation** — badge and headline are fully
static and visible from frame 0. An earlier version had a fade-in reveal;
removed per explicit feedback 2026-07-18 ("không cần hiệu ứng đâu, luôn luôn
xuất hiện nhé").

Do not bake host-app UI chrome (search bars, play buttons, progress bars) into
the hook card — that belongs to whatever app plays the video back, not to the
video itself.

For the card's typography and geometry, see `text-layout.md`.

## Resolving the brand kit (the conditional user pause)

`$WORKSPACE_DIR/brand/<slug>/` holds one self-contained brand kit
(`hook-bg.jpg` + `brand.json` — badge text and full color palette). Brands are
prepared by the plugin owner (co-designed with Claude) and handed to employees
as a folder to drop in — there is no registration command. See
`docs/superpowers/specs/2026-07-18-multi-brand-kit-design.md`.

### Split in two: prove one EXISTS at Step 1, pick WHICH at Step 4

`buildSpec` throws `'a scene has isHook: true but no brandKit was provided'`
when no kit is available — and Step 4 is after Step 2, which is where the
ElevenLabs quota is spent. An employee who forgot to copy the brand folder
used to pay for the whole narration before hitting that error.

So call `listBrands()` **twice**, or once and keep the result:

- **At Step 1**, before any paid call: if `brands[]` is empty, stop. Report
  `invalid[]` here too — a folder that failed validation is usually the folder
  the user thought they had.
- **At Step 4**: resolve which one, asking only when 2+ exist.

The choice genuinely belongs at Step 4 (nothing before it needs a brand), but
the *existence* is a precondition for the entire run.

Call `listBrands(workspaceDir)` from `scripts/brand-kit.mjs`, then:

1. **Report any entries in its `invalid[]` array by name in chat** (e.g. "bỏ
   qua folder `abc/` vì thiếu `brand.json`"). Never silently drop a broken
   folder — the employee who copied it needs to know something's wrong.
2. **Zero valid brands** → stop with a clear message telling the user to drop
   a brand folder (with `hook-bg.jpg` + `brand.json`) into
   `$WORKSPACE_DIR/brand/<slug>/`. Do not render without one.
3. **Exactly one valid brand** → use it automatically, no question asked. Note
   which brand was used in the Step 6 report.
4. **Two or more valid brands** → ask the user to pick one, showing each
   `displayName`.

Resolve to one `brand` object (from `listBrands`' `brands[]`) before building
the spec. `getBrand(slug, workspaceDir)` looks up a single brand by slug.

Multi-brand is a pipeline-level concern: `spec.json` always carries exactly
one already-resolved `brandKit`, and Remotion never knows others exist.

## Brand scope limits

Brands vary by **color and badge text only**. There is no per-brand font, no
per-brand mask height, no per-brand layout. Typography and every text position
are house-wide constants in `remotion/src/layout.ts` — see `text-layout.md`.
If a future brand genuinely needs different structural layout, that's a new
design spec, not a silent widening of `brand.json`.
