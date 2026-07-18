# Multi-Brand Kit — Design Spec

Date: 2026-07-18
Status: approved by user, implementation pending

## 0. Goal

The plugin owner (Trung) will hand-design brand kits for up to ~10 different
TikTok channels and hand them to non-technical employees. Today,
`scripts/brand-kit.mjs` supports exactly ONE brand kit, machine-wide,
registered via a CLI `set` command into `config.local.json`'s single
`brandKit` field. This spec replaces that with a directory-scan model that
supports many brands per machine, requires zero commands from employees, and
lets each brand carry its own badge text and color palette (not just a
different background photo).

## A. File layout — one self-contained folder per brand

```
$WORKSPACE_DIR/brand/
  mat-vu-tac-quyen/
    hook-bg.jpg     # required — background image for the hook card
    brand.json      # required — display name, badge text, color palette
  <other-brand-slug>/
    hook-bg.jpg
    brand.json
```

Activation is "drop a folder in" — no CLI step for employees. The owner (and
Claude, during a brand-design session) prepares each folder directly (write
`brand.json`, copy in `hook-bg.jpg`) and hands the whole folder to whichever
employee/channel needs it. There is no scaffold/CLI-generator command for
this (YAGNI — the two files are trivial to author directly during a design
session; a dedicated command would be an abstraction nobody but Claude uses).

## B. `brand.json` schema — explicit palette, not derived

Colors and badge text are authored explicitly per brand rather than derived
from a single base hex. The current hook card's look is a hand-tuned palette
from several rounds of visual feedback; a generic lighten/darken from one
color would not reproduce it faithfully and would likely look mediocre for
non-orange brands. Authoring the full palette is cheap since brands are
co-designed with Claude, not self-served by employees.

```json
{
  "displayName": "Mật Vụ Tác Quyền",
  "badgeLabel": "Mật Vụ Tác Quyền",
  "badgeGradient": ["#FF9A3D", "#FF6A00", "#F04E00"],
  "badgeShadow": "rgba(120,40,0,0.4)",
  "headlineShadow": ["#E06A00", "#C85D00", "#B05000"],
  "headlineStroke": "rgba(107,42,0,0.35)"
}
```

- `displayName` — shown to employees when picking a brand and in the final
  run report. Free text, can differ from the folder slug.
- `badgeLabel` — the ribbon badge's text (currently hardcoded as "Mật Vụ Tác
  Quyền" in `HookCard.tsx`; becomes per-brand).
- `badgeGradient` — 3-stop gradient for the badge background (currently
  `HookCard.tsx`'s `badgeStyle.background` 135° gradient).
- `badgeShadow` — the badge's `boxShadow` color.
- `headlineShadow` — 3-stop embossed `textShadow` stack for the headline
  (currently hardcoded in `headlineBaseStyle`).
- `headlineStroke` — the headline's `WebkitTextStroke` color.

The existing "Mật Vụ Tác Quyền" brand migrates into this schema with these
exact values (verbatim from the current hardcoded `HookCard.tsx`) — visually
identical output, just externalized.

## C. Brand selection at video-creation time

New resolution step (runs once per video, alongside the existing BGM pause):

1. Scan `$WORKSPACE_DIR/brand/*/`. A folder counts as a valid brand only if
   both `hook-bg.jpg` and a parseable `brand.json` (with all required fields)
   exist. Invalid/incomplete folders are **not silently skipped** — the skill
   reports them by name in chat (e.g. "bỏ qua folder `abc/` vì thiếu
   `brand.json`") so a non-tech employee who mis-copied a folder knows
   something is wrong, rather than the brand just vanishing from the list.
2. Zero valid brands → stop with a clear, actionable message (path to drop a
   brand folder into) — this is a hard requirement for the hook card, so
   failing fast beats rendering without one.
3. Exactly one valid brand → use it automatically, no question asked; state
   which brand was used in the final run report.
4. Two or more valid brands → ask the employee to pick one (multiple-choice,
   showing `displayName`). No separate "default brand" config field — with
   auto-use-if-one already covering the common single-channel-per-machine
   case, a default adds a config surface without removing the one real
   decision point (a machine that legitimately serves multiple channels).

## D. Code changes

- **`scripts/brand-kit.mjs`** — replace the single `setBrandKit`/`getBrandKit`
  pair with:
  - `listBrands(workspaceDir)` → scan `brand/*/`, validate each, return
    `[{slug, displayName, badgeLabel, badgeGradient, badgeShadow,
    headlineShadow, headlineStroke, hookBgPath}]` for valid folders and
    `{slug, error}` for invalid ones (so the caller can report both).
  - `getBrand(slug, workspaceDir)` → look up one resolved brand by slug, throw
    if not found.
  - Drop the CLI `set` command and the `config.local.json` `brandKit`
    registration entirely.
- **`~/.tiktok-news-video/config.local.json`** — remove the `brandKit` field
  (migrated data lives on disk as real brand folders now, not in config).
- **`remotion/src/spec-types.ts`** — `BrandKit` type gains `badgeLabel`,
  `badgeGradient: [string, string, string]`, `badgeShadow`, `headlineShadow:
  [string, string, string]`, `headlineStroke`; drops `logoPath` (already
  unused by `HookCard.tsx`, confirmed dead this round).
- **`remotion/src/HookCard.tsx`** — badge gradient/shadow and headline
  shadow/stroke read from the passed-in `BrandKit` fields instead of the
  hardcoded style constants; badge text reads from `brandKit.badgeLabel`
  instead of the literal `"Mật Vụ Tác Quyền"` string.
- **`scripts/build-spec.mjs`** — unchanged in shape: still receives one
  already-resolved brand object per render (the skill resolves which brand
  to use *before* calling `buildSpecToFile`, same as it already resolves BGM
  before building the spec) — multi-brand is a skill-level/pipeline-level
  concern, not something `spec.json`/Remotion need to know about.
- **`skills/tiktok-news-video/SKILL.md`** — add the brand-resolution step
  (Section C above) as a new pause point in the autonomy contract (only
  actually pauses when ≥2 brands exist); update the hook-card description to
  match the current `HookCard.tsx` (Baloo2, coded badge, half-frame mask, no
  animation — already drifted out of sync per the 2026-07-17 spec's dated
  addendum) and to reference per-brand palettes instead of one machine-wide
  brand kit.

## E. Migration (one-time, done during implementation, not a runtime feature)

1. Confirm `$WORKSPACE_DIR/brand/hook-bg.jpg` actually exists on disk before
   moving anything (config referencing a path isn't proof of its presence).
2. Create `$WORKSPACE_DIR/brand/mat-vu-tac-quyen/`, move `hook-bg.jpg` into
   it, write `brand.json` with the exact current hardcoded values (§B).
3. Delete the now-orphaned `brand/logo.jpg` (confirm it's the unused dead
   asset first) and the old `brandKit` field from `config.local.json`.

## F. Verification

`tsc --noEmit` clean is necessary but not sufficient — this component's
entire history is "render a frame → look at the pixels → user reacts."
Verification for this feature means:
1. Render a hook frame using the migrated `mat-vu-tac-quyen` brand and
   confirm it's pixel-identical in intent to the current output (same
   colors/text, just sourced from `brand.json` now).
2. Create one throwaway test brand with a **deliberately different base
   color** (e.g. blue) and render its hook frame too, confirming the
   badge/headline styling reads well with a non-orange palette — this is the
   real test of whether the schema (full explicit palette, not a derived
   single hex) actually generalizes across brands.
3. Confirm the ≥2-brand picker prompt and the auto-use-if-one path both work
   by temporarily having 2 brand folders present, then removing the test one
   after verification.

## G. Explicit scope cuts

- No default-brand config field (see §C.4's reasoning).
- No CLI scaffold/generator command for authoring a new brand folder — Claude
  writes `brand.json` and copies the image directly during a brand-design
  session with the owner.
- No per-brand customization beyond the fields in §B (e.g. no per-brand font
  family, no per-brand mask height) — if a future brand needs different
  structural layout, not just colors/text, that's a new spec, not a silent
  scope-creep of this one.
