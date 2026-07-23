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

**A hook scene's image always covers (full-bleed), automatically.** `buildSpec`
forces `fit: cover` for any `isHook` scene, overriding the usual blur-pad
default. The image sits inside the HookCard — the card is already its own frame,
so the blur border content images wear (see `tags/README.md`) would read as a
frame within a frame. You do NOT tag the hook image `fill_full_screen`; `isHook`
covers it for you.

The card has **no reveal/fade-in animation** — badge and headline are fully
static and visible from frame 0. An earlier version had a fade-in reveal;
removed per explicit feedback 2026-07-18 ("không cần hiệu ứng đâu, luôn luôn
xuất hiện nhé").

Do not bake host-app UI chrome (search bars, play buttons, progress bars) into
the hook card — that belongs to whatever app plays the video back, not to the
video itself.

For the card's typography and geometry, see `text-layout.md`.

### Extending the hook over the next screen(s)

By default the hook card lasts exactly the hook line, then the run cuts to
full-frame image scenes. To keep the hook going over the screen(s) right after
it — so hook and screen read as **one continuous opening thought** — the author
writes the **`continue_hook`** tag on those screen lines.

**This is explicit, never inferred.** Do NOT decide the merge by reading the
script for "one continuous thought"; two lines that sound continuous are still
cut apart unless the author tagged the screen. Present `continue_hook` = merge;
absent = ordinary captioned cut. (The skill used to make this call itself; that
was replaced by the explicit tag on 2026-07-23 so the author controls it.) The
tag's full contract is in `tags/continue-hook.md`.

**What the tag does: extend the hook with the full hook style.** A tagged
screen is marked `isHook: true` with the **same `hookHeadline`** as scene 0. It
then renders exactly like the hook scene — the branded card + headline held
below, the screen's image full-bleed (`cover`) behind it, no karaoke. The card
is static and identical across the boundary, so hook + screen read as one shot;
only the image behind it changes (one image per screen). This is the look the
author asked for on 2026-07-22 ("2 chỗ đó gộp vào 1 … style của ảnh phải giống
lúc đọc hook") — the image must NOT show a blur border here, and `isHook`'s
automatic `cover` guarantees that. Pass one image per extended screen, so the
merged hook+screen span shows just those images and nothing else.

A tagged screen must be **contiguous with the hook** — immediately after it, or
after another `continue_hook` screen. A tag that lands after ordinary screens
have already cut away is meaningless; stop and ask at Step 1 rather than guess.

**The split held look: `continue_hook: split`.** The same tag with the value
`split` keeps the branded card **pinned in the bottom half** while that scene's
image is fitted into the **top half** over a blurred pad (`heldHook: true`),
instead of the continuous full-frame cover the bare tag gives. It also
suppresses that scene's karaoke captions.

- Like the bare tag it is **explicit only** — an untagged scene fills the whole
  frame and shows captions, and `split` is never chosen by reading the script.
  Same contiguity rule: only on screen(s) immediately after the hook (or after
  another `continue_hook` screen).
- The bottom keeps the **real hook card** (`HookCard`, the same brand cover +
  badge + headline as the hook scene) — not a flat gradient panel, which read
  as a bare orange slab. The image (`remotion/src/HeldHookScene.tsx`) is
  `contain`-fitted (not cropped) with a blurred pad behind it, rendered OVER
  the card in the top region with its bottom edge faded so it blooms into the
  card.
- Captions for a held screen are **not emitted**, and `build-spec.mjs` records
  every caption-free screen index in `spec.captionSkipScreens` so
  `verify-captions.mjs` excludes the same screens from the script side. Without
  that the gate would fail, short by the held screen's words.
- The badge, date and headline sit entirely in the bottom half in BOTH the full
  and split cards, so a scene crossing from the hook into a held screen keeps
  them from shifting — only the top (cover → content image) changes.

Added 2026-07-22 on the author's request ("giữ ảnh thẻ hook, các ảnh cho nằm
nửa trên phía ảnh thẻ").

## Resolving the brand kit (the conditional user pause)

`$WORKSPACE_DIR/brand/<slug>/` holds one self-contained brand kit. Brands are
prepared by the plugin owner (co-designed with Claude) and handed to employees
as a folder to drop in — there is no registration command. See
`docs/superpowers/specs/2026-07-18-multi-brand-kit-design.md`.

```
brand/<slug>/
├── brand.json      REQUIRED — badge text, colors, caption geometry
├── hook-bg.*       optional — hook scene background
├── logo.*          optional — the badge mark
└── font.*          optional — the channel's typeface
```

**`brand.json` is the only required file.** A brand folder containing nothing
else is valid and renders.

- `logo.svg` / `logo.png` is drawn inside the badge's white disc. Without it
  the disc shows a `©` glyph — which every brand used to get unconditionally,
  copyright channel or not.
- `hook-bg.svg` / `.png` / `.jpg` / `.jpeg` / `.webp` backs the hook scene.
  Without it the card is filled from `badgeGradient`.
- `font.woff2` / `.woff` / `.ttf` / `.otf` is the channel's typeface. It
  applies to the headline, the badge label **and** the karaoke captions at
  once — never to one of them. Without it everything uses house Oswald 700.

`.svg` wins when several extensions are present; `.woff2` likewise for fonts.

Put the WEIGHT you want in the font file (supply a Bold file if you want
bold). The face is registered across the full weight range, so Chrome uses the
file as-is instead of smearing a synthetic bold over an already-bold face.

A font that fails to load **stops the render** with the path named. It does
not fall back — a video silently shipped in the wrong typeface is worse than
one that didn't render.

Because `--public-dir` is the workspace, anything in the brand folder is
already reachable via `staticFile()`. That is why a logo can be **SVG**: the
renderer is Chrome, so vector markup needs no conversion and stays sharp.
Assume it is static — Remotion renders frame by frame, so animation inside an
SVG is not expected to survive. Motion belongs in the components.

New brand keys are **optional with a default**, always. Making one required
would invalidate every brand folder already in employees' hands. See
`docs/superpowers/specs/2026-07-22-brand-as-design-kit-design.md`.

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
   a brand folder (at minimum a `brand.json`) into
   `$WORKSPACE_DIR/brand/<slug>/`. Do not render without one.
3. **Exactly one valid brand** → use it automatically, no question asked. Note
   which brand was used in the Step 6 report.
4. **Two or more valid brands** → ask the user to pick one, showing each
   `displayName`.

Resolve to one `brand` object (from `listBrands`' `brands[]`) before building
the spec. `getBrand(slug, workspaceDir)` looks up a single brand by slug.

Multi-brand is a pipeline-level concern: `spec.json` always carries exactly
one already-resolved `brandKit`, and Remotion never knows others exist.

## The badge row: ribbon left, optional date plate right

The flush-left ribbon badge (logo disc + channel name + a skewed tail) gets
its lighting — gloss, inner keylines, coloured bloom — from the brand's
existing `badgeGradient`, stop 0 as the accent and stop 2 as the ink. **No new
`brand.json` key**, so every brand already in the field got the better badge
with no edit.

`"hookDate": true` adds a publish-date plate on the right, mirroring the badge
at the same height with its right edge on `SAFE.rightBelowButtons`. It is
**off by default and per brand**: dating a post is one channel's editorial
habit, not a house layout rule, so a brand that does not date its posts
renders no plate and needs no edit to keep it that way.

The plate is deliberately plain — white date, nothing else. Its dark backing
exists only so white type is legible over an arbitrary photograph.

The date string is `spec.hookDate`, **formatted on the node side** by
`build-spec.mjs` and pinned to `Asia/Ho_Chi_Minh`. Reading a clock inside the
renderer would break the rule that a render is a pure function of its spec:
the same spec would produce a different video tomorrow, and a different one
again on an employee's machine in another timezone.

`buildSpec`'s `hookDate` argument overrides the brand's choice — a string sets
the text, `null` suppresses the plate.

**The plate and the badge share one row with no collision guard.** With a
13-character `badgeLabel` the gap is only a few pixels; a much longer channel
name will slide under the plate. Check the hook still when naming a brand.

## Karaoke geometry per brand

`brand.json` may carry an optional `caption` block. Every key inside is also
optional — only what the brand sets is overridden, everything else keeps the
house default from `CAPTION` in `remotion/src/layout.ts`:

```json
"caption": { "fontSize": 44, "bottomInset": 400, "wordGap": 14 }
```

Allowed: `left`, `rightInset`, `bottomInset`, `fontSize`, `lineHeight`,
`wordGap`. **An unknown key makes the brand invalid**, on purpose — a
misspelled `botomInset` would otherwise be silently ignored and read as "the
feature doesn't work".

The three position keys are **clamped to TikTok's safe zone** by
`build-spec.mjs`, which pushes a warning into `spec.warnings` naming the value
and what it became. Report those warnings to the user: the author cannot see
the problem in the rendered MP4, only on the platform, after posting.

## Brand scope limits

Today brands vary by **color, badge text, badge mark, hook background, karaoke
geometry, and typeface**. Still house-wide in `remotion/src/layout.ts`: every
hook-card position — see `text-layout.md`.

The set is meant to grow, but one key at a time, each with a stated default. A
brand key that lands without a default is a bug: it breaks every folder
already handed out.
