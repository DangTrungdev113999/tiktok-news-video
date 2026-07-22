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

### Later slices (not this change)

1. Karaoke: `captionFontSize`, `captionBottomInset`, `captionReadColor`, …
   threaded from `brand.json` through `layout.ts` into `Captions.tsx`.
2. Whatever comes next — the point of the optional-with-default rule is that
   this list never has to be finished up front.
