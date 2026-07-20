# Steps 4–6 — Build the spec, render, report

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
