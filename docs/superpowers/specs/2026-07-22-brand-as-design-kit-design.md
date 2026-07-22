# Brand folder = the channel's design kit, not 6 colors + a photo

## What's wrong today

A brand is `brand.json` (6 required color fields) plus a mandatory
`hook-bg.jpg`. Everything else that makes a channel look like itself is
hardcoded in the plugin:

- The badge mark is the literal character `©`, written into
  `remotion/src/HookCard.tsx:134`. Every brand on earth wears a copyright
  symbol, including channels that have nothing to do with copyright.
- Karaoke font family, size, and position are module constants in
  `remotion/src/layout.ts`, shared by all brands with no way to override.
- `hook-bg.jpg` is required (`brand-kit.mjs:52` throws when it's absent), and
  it must be a raster photo. A brand whose cover is drawn rather than
  photographed cannot exist.

The name `hook-bg` is also wrong: it is the background of the *hook scene*,
not of the brand.

## The fact that makes this cheap

`scripts/render.mjs:135` passes `--public-dir=${workspaceDir}`. The entire
workspace is already served to the renderer, so anything in
`brand/<slug>/` is reachable via `staticFile()` — exactly how `hook-bg.jpg`
works now. Swapping a `.jpg` for an `.svg` is a file swap. No webpack change,
no build step, no compiling anything.

## Two kinds of content, two mechanisms

The temptation is to make everything one thing. It isn't:

| Kind | Lives as | Why |
|---|---|---|
| Visuals — logo, hook background | `.svg` / `.html` / image files in the brand folder | They are pictures. Describing a picture in JSON means the plugin has to grow a new renderer for every new idea. |
| Measurements — colors, font family, size, position | fields in `brand.json` | They are numbers. Putting a caption's y-position inside an SVG puts it somewhere nothing can read it. |

So the brand folder becomes:

```
brand/<slug>/
├── brand.json        # numbers: colors, fonts, sizes, positions
├── logo.svg          # optional — replaces the hardcoded ©
└── hook-bg.svg|.jpg  # optional — the hook scene's background
```

### Markup, not components

`.svg` and `.html` load through `staticFile()` with zero machinery. A `.tsx`
React component does **not** — webpack only compiles what lives under
`remotion/src`, so a component in the brand folder would need a copy-and-bundle
step, and it would mean handing employees a folder containing runnable code.

We are not doing that. If a brand ever genuinely needs frame-synced motion in
its background, that is a separate decision with its own design.

**Stated assumption:** brand visuals are static. Remotion renders frame by
frame, so CSS/SMIL animation inside an inlined SVG is expected to freeze or
desync. This has not been measured — it is an assumption, and it holds for
every brand we have. Motion stays in plugin code (hook card slide-up, karaoke
fill, image zoom), where it is already frame-driven.

## Every new field is optional

`REQUIRED_MANIFEST_FIELDS` is currently all-or-nothing: a brand missing any one
field is dropped from the picker. Adding karaoke keys to that list would break
`mat-vu-tac-quyen` — the only real brand — the moment the code shipped.

So: **new fields are optional and fall back to today's `layout.ts` constants.**
An existing brand keeps working with zero edits, and the vocabulary grows one
key at a time, the same way the scene-script tags do.

`hook-bg` likewise becomes optional. A brand without one is still valid; the
hook card draws its background from `badgeGradient`.

## Slice 1: the logo (this change)

Smallest cut that exercises the whole new path end to end.

- `brand-kit.mjs` looks for `logo.svg` (then `logo.png`) in the brand folder
  and, when present, resolves `logoPath` the same way it resolves
  `hookBgPath`. Absent → `logoPath` is `null`, not an error.
- `HookCard` renders `<Img src={staticFile(brandKit.logoPath)}>` inside the
  white disc when there is a logo, and falls back to the `©` glyph when there
  isn't — so `mat-vu-tac-quyen` looks identical until someone drops a
  `logo.svg` next to its `brand.json`.
- `buildSpec`'s brandKit guard must not start requiring `logoPath`; optional
  means optional.

## Slice 2: the hook background (done)

`hook-bg` became optional and now resolves `.svg`, `.png`, `.jpg`, `.jpeg`,
`.webp` in that order. `brand.json` is the only required file in a brand
folder.

When there is no file, `HookCard` fills the same masked card from
`badgeGradient` — the card's position and bloom are unchanged, only what fills
it differs. So a brand can be pure config, pure drawing, or a photo, and none
of those is the privileged case.

One consequence worth recording: `buildSpec`'s guard used `hookBgPath` as its
sentinel for "someone passed raw brand.json instead of `getBrand()` output".
That stopped working the moment the field became optional — its absence no
longer proves anything. The sentinel is now `slug`, which is a better one
anyway: it is the field `getBrand()` always adds and `brand.json` never
contains.

Verified by rendering three ways: the real brand (unchanged photo card), a
brand whose background is a hand-written SVG (gradient + dot screen +
waveform), and a brand folder holding nothing but `brand.json`.

## Slice 3: karaoke geometry (done)

`brand.json` gained an optional `caption` block: `left`, `rightInset`,
`bottomInset`, `fontSize`, `lineHeight`, `wordGap`. Every key optional.

**Defaults live in exactly one place.** `brand-kit.mjs` passes through only the
keys a brand actually set; `resolveCaption()` in `layout.ts` merges them over
`CAPTION`. If the node side filled in defaults instead, a later edit to
`CAPTION` would silently disagree with a stale copy — surfacing only as a
video that looks slightly off, with nothing pointing back here.

**An unknown key is an error**, not a shrug. `botomInset` would otherwise be
ignored in silence, and the brand author's natural conclusion is "the feature
is broken", not "I misspelled it". It fails at Step 1 with the key quoted.

**Positions are clamped, not rejected.** Out-of-zone is renderable; it just
renders where TikTok's own UI covers it — and the author cannot see that in
the MP4, only on the platform, after posting. So `build-spec.mjs` clamps to
the `SAFE` floors and pushes a warning naming the value and its replacement.
Rejecting instead would turn "50px too low" into "the employee gets no video
and cannot fix it", since only the admin authors brands.

Verified: a brand overriding `fontSize`/`bottomInset`/`wordGap` renders visibly
larger and higher; one with all three positions out of bounds produced three
clamps and three warnings; the real brand (no `caption` key) renders unchanged;
a misspelled key lands in `invalid[]` with the allowed list.

## Slice 4: the typeface (done)

A brand folder may hold `font.woff2` / `.woff` / `.ttf` / `.otf`. It is
resolved to `fontPath` and applied by `MainVideo` to the headline, the badge
label and the captions **together** — resolved once, at the composition root,
so there is no code path that gives them different families. That is the whole
reason `layout.ts` exists (see below).

**The load is gated.** `useBrandFont` holds `delayRender()` until
`FontFace.load()` resolves. Without the gate the failure mode is not "the font
didn't work" — Remotion renders frames independently, so it would be a handful
of frames scattered through the video in the fallback typeface. That is the
hardest kind of defect to catch in review and the easiest to ship.

**A font that fails to load calls `cancelRender`.** The brand asked for this
typeface; shipping a video quietly set in a different one is worse than not
shipping. Verified: a corrupt file exits 1 with the path named, and writes no
output.

**Registered across `weight: "100 900"`.** The components ask for 700. A face
declaring only its own weight would make Chrome synthesise a bold on top of a
file that is usually already bold, and the text would render smeared. Brands
supply the weight they want in the file.

The house font stays in the CSS stack behind the brand's, so a glyph the
brand's file lacks — Vietnamese diacritics being the realistic case — is drawn
by Oswald rather than by whatever the browser would otherwise pick.

Verified: with a brand font, frame 2 (the earliest hook frame) already renders
in it, along with the badge and the captions; removing the file returns
everything to Oswald.

### Why this could not be part of slice 3

`layout.ts` exists so the hook headline and the captions can never load
different families again — the Baloo2/Inter drift it was written to kill. A
per-brand font therefore has to move headline, badge, and captions together;
it is brand-wide typography, not caption geometry.

It also needed the font-loading gate above — a determinism risk that did not
belong bundled into a pure-data change.

### Later slices

Nothing queued. The point of the optional-with-default rule is that this list
never has to be finished up front.
