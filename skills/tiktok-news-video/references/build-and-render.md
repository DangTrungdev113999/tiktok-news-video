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

## Step 4b — Do the captions say what the author wrote?

```
node scripts/verify-captions.mjs <spec.json> <sceneTexts.json>
```

`sceneTexts.json` is the ordered per-screen `text` array — the author's words,
including the hook screen (the script skips it, since the hook carries no
captions). Exit 0 means every caption word matches the script in order; exit
non-zero prints the first divergences with context.

**Run it every time, not just when something looks off.** On the user-MP3 path
the captions are assembled from a forced alignment against a speech-to-text
transcript, and when that goes wrong it goes wrong invisibly: on 2026-07-21 a
video shipped reading "Tinh Hà X2" for "Tinh Hà Say Hi", "DatViet Work" for
"DatVietVAC", and "hai mươi tư" everywhere the script said "24". The
black-band scan, the safe-zone measurement and the smoke test all passed —
every one of them measures geometry and none reads a character.

A failure here is not a warning to report at Step 6. Fix it and rebuild.

### What this gate does NOT cover

It flattens every caption group into one stream and compares word for word, so
it proves the captions are **the right words in the right order** — and says
nothing about *when* each word appears. The two failures that produced it sat
on different axes:

| Failure | Caught by |
|---|---|
| caption text came from the transcript | this gate |
| a screen's words got eaten by its neighbour (screen 13 → 0s) | `align-audio.mjs`'s starved-scene warning |

A drift that keeps every word correct but shifts the timing passes both. So on
the MP3 path, **still eyeball a rendered frame or two** against the moment
they should appear. A green run here does not retire that.

Its main target is the forced-alignment path. On the TTS path it is nearly,
but not quite, a no-op — and the exception is worth having. TTS captions are
built from `ttsText` with the `[tag]` runs stripped, while this gate compares
against `text`. Those agree only while the convention holds that `ttsText`
changes delivery and never wording. Write a spelled-out number or a
pronunciation respelling into `ttsText` and the gate fails — **correctly**,
because the caption really would be showing words the author did not write.

Run it on both paths. A check that only runs when you already suspect trouble
is a check that runs after the damage.

## Step 5 — Render

Create the dated + slugged output folder first:

```
$WORKSPACE_DIR/output/<YYYY-MM-DD>_<slug>/
    final.mp4
    narration.mp3
    spec.json        # kept for reproducibility
    scene-texts.json # the author's per-screen text, in order
```

Write `scene-texts.json` before Step 4b — it is the second argument to
`verify-captions.mjs`, and the gate is not runnable without it. Keeping it
beside the spec also means a later re-check needs nothing from the chat
transcript.

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
node scripts/render-still.mjs <spec.json> <out.png> <WORKSPACE_DIR> <frame>
```

Pass every path as an **absolute path you substituted yourself**. Do not write
`$CODE_ROOT` or `$WORKSPACE_DIR` into a command: those are sh-style variables,
and an employee's machine may be running cmd or PowerShell, where they expand
to nothing. Same reason there is no `cd ... &&` here — `&&` is not valid in
cmd. (This block used to be a POSIX one-liner with all three problems, which
quietly disabled the mandatory pixel check on Windows.)

Note that a `spec.json` from an older run may carry a stale `brandKit` shape
and fail — resolve a fresh brand kit into it first.

## Step 6 — Report

Tell the user:

- where the final video landed
  (`$WORKSPACE_DIR/output/<dated-slug>/final.mp4`)
- the video's duration
- a one-line summary of what effects / BGM / brand were used, plus the **voice
  and the pace level** (`config.local.json`'s `voiceId` + `narrationPace`, or
  whatever was overridden for this run) — the pace changes how the whole video
  feels and the user cannot tell 1.3× from 1.4× by reading a filename
- **every entry in `spec.warnings`**, plus what you resolved each
  `focus_object` to (which person, which coordinates, which cue word) — the
  author is the only one who can catch a misidentification
