# Steps 4–6 — Build the spec, render, report

## Tags are RESOLVED here, not at Step 1

Step 1 only parses the scene script — `scripts/parse-tags.mjs` reports what
the author wrote and resolves nothing. Turning that into numbers happens
**here**, because it needs things that don't exist until now:

| To resolve | You need | Available from |
|---|---|---|
| a cut pinned to a spoken moment | word-level timing | Step 2 |
| `focus_object` → coordinates | a look at the image | any time, but the reads belong with the rest of the build |
| `lúc "..."` → `peakSec` | word-level timing | Step 2 |
| slide insets → `from`/`to`, degenerate-slide check | the asset's real dimensions | the probe, here |

So: parse at Step 1, resolve at Step 4, and never try to work out a cut point
at parse time — there is nothing to time against yet.

### What you pass, per motion tag

`buildSpec` does the geometry — keeping it there is what makes the two slide
tags exact mirrors by construction rather than by two prompts agreeing. Pass
the author's intent, in the shape the tag was written in, on the asset:

| Tag | Pass on the asset |
|---|---|
| `fill_full_screen` | `fillFullScreen: true` |
| `zoom_in: 50%` | `zoom: { variant: 'in', amount: 0.5 }` |
| `zoom_out` (bare) | `zoom: { variant: 'out' }` |
| `slide_left_right: 20% 20%, top 20%` | `slide: { direction: 'left_right', startInset: 0.2, endInset: 0.2, anchorY: 0.1 }` |
| `slide_right_left` (bare) | `slide: { direction: 'right_left' }` |
| `slide_top_bottom` | `slide: { direction: 'top_bottom', ... }` |
| `flip_book` | `flipBook: true` |
| `zoom_in: 50%, target 1 trong x_des.jpg` | `zoom: { variant: 'in', amount: 0.5, aim: { x, y, note } }` |
| `focus_object: ...` | `focus: [{ x, y, scale, peakSec?, note? }]` |

`parsePercent()`, `parseSlideValue()` and `parseTargetRef()` in
`scripts/parse-tags.mjs` produce `amount`, `startInset`, `endInset`, `anchorY`
and the target's marker for you — don't re-derive them by reading the tag text
yourself.

`aim` is the ONE field here you have to look at an image to fill: resolve the
target marker to coordinates exactly as `focus_object` is resolved, and report
what you picked. Everything else is arithmetic `buildSpec` does for you —
including the entrance, which a slide gets automatically.

## Building `spec.json`

Convert each scene's `{startSec, endSec}` (from Step 2) into
`{startFrame, durationInFrames}` at 30fps. `buildSpec` does the gap-closing
itself (see `narration-and-bgm.md`), so pass the raw per-scene timing straight
through.

Call `buildSpecToFile` from `scripts/build-spec.mjs` with:

| Argument | Value |
|---|---|
| `workspaceDir` | `$WORKSPACE_DIR` from `$CONFIG_FILE` |
| `scenes[].words` | Step 2's word timing — **omit for the hook scene** |
| `scenes[].isHook` / `hookHeadline` | on the hook scene only |
| `brandKit` | the resolved brand object (see `hook-and-brand.md`) |
| `narrationAudioPath` / `bgmAudioPath` | relative to `workspaceDir` |

A screen holding several assets is passed as
`assets: [{filename, share}]` instead of `assetFilename` — see
`tags/README.md`. `buildSpec` flattens it into one **shot** per asset,
dividing the screen's time by the shares, so `spec.scenes[]` may be longer
than what you passed in. Shots are contiguous by construction and the screen's
`words[]` is attached once, so captions never double up.

It resolves `assets/<filename>` against that workspace, chunks `words[]`
into karaoke caption groups, applies the motion classification, and returns
the full `spec.json` shape Remotion expects.

### `spec.warnings`

`buildSpec` returns a `warnings[]` on the spec for problems that still produce
a video, but not the video the author asked for — a focus cue clamped because
it fell outside its shot, shares that had to be normalised. **Report all of
them in the Step 6 report.** They exist because the alternative is failing
silently in a way that looks identical to success.

`buildSpec` refuses to build if any asset fails to probe — it throws listing
every missing file rather than rendering a partially-broken video.

## Step 5 — Render

Create the dated + slugged output folder first:

```
$WORKSPACE_DIR/output/<YYYY-MM-DD>_<slug>/
    final.mp4
    narration.mp3
    spec.json        # kept for reproducibility
```

Then run:

```
node scripts/render.mjs <spec.json path> <output .mp4 path> <WORKSPACE_DIR>
```

**The third argument is required.** It's what `--public-dir` and every
asset-existence check resolve against; omitting it, or passing `CODE_ROOT`
instead, is a bug rather than a shortcut.

If the render fails, diagnose and fix before retrying — bad asset path,
Remotion error, missing dep from an incomplete init. Don't surface a raw stack
trace as "done, but broken."

### Rendering a single frame while iterating

Faster than a full render when checking layout or a single scene:

```
cd $CODE_ROOT/remotion && npx remotion still src/index.ts MainVideo <out.png> \
  --props=<spec.json> --public-dir=$WORKSPACE_DIR --frame=<n>
```

Note that a `spec.json` from an older run may carry a stale `brandKit` shape
and fail — resolve a fresh brand kit into it first.

## Step 6 — Report

Tell the user:

- where the final video landed
  (`$WORKSPACE_DIR/output/<dated-slug>/final.mp4`)
- the video's duration
- a one-line summary of what effects / BGM / voice / brand were used
- **every entry in `spec.warnings`**, plus what you resolved each
  `focus_object` to (which person, which coordinates, which cue word) — the
  author is the only one who can catch a misidentification
