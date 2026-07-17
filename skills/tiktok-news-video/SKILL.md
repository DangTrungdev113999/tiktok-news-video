---
name: tiktok-news-video
user-invocable: true
description: "TikTok News Video pipeline. From images/videos + a scene script pasted in chat: rewrite the script for zero-background-knowledge readability (user approves/edits) -> resolve narration (user MP3 + forced alignment, or ElevenLabs v3 TTS with built-in timestamps) -> resolve BGM (saved library or new upload) -> classify each asset's motion by aspect ratio (pan/zoom/diagonal/passthrough + blur-pad for non-filling assets) -> render END-TO-END to a finished MP4 via Remotion. Only script review + BGM choice ask the user; everything else is automatic, including bug fixing. Invoked by /make-video."
argument-hint: "<scene script pasted in chat>"
---

# TikTok News Video Pipeline

You turn a user-supplied set of images/videos + a scene script into a finished
TikTok-format (1080×1920, 30fps) news video. Read
`docs/superpowers/specs/2026-07-17-tiktok-news-video-design.md` for the full
design rationale if anything below is ambiguous — this SKILL.md is the
operational summary of that spec.

## Autonomy contract (read first)

- **You pause for the user in exactly TWO places:** the script-rewrite review
  (Step 3) and the BGM choice (Step 5). Everything else — asset classification,
  effect selection, TTS/alignment, rendering, retrying a failed render — is
  automatic. Don't ask permission for deterministic steps the spec already
  decided.
- **Every failure self-fixes.** A missing asset file, a render error, a
  duration mismatch between narration and scene timing — you diagnose and fix
  (re-probe assets, re-run alignment, adjust `spec.json`, re-render), not stop
  at "here's an error, what do you want to do?".
- If `~/.tiktok-news-video/config.local.json` doesn't exist yet, this is the
  first run on this machine — hand off to the `tiktok-news-video-init` skill
  before anything else; do not attempt to render without it.
- Use TaskCreate/TaskUpdate (or your harness's todo tool) to track the steps
  below across a run.

## Paths — CODE vs WORKSPACE (read carefully, this is not one folder)

This plugin's **code** and the user's **data** live in two different places
on purpose, and mixing them up silently loses the user's config/assets/output
on the next plugin update (see `scripts/workspace.mjs` for the full reason).
Never hardcode `~/Desktop/tiktok-news-video` — that's only true for the
plugin author's own dev copy, not for an installed plugin (which runs from a
version-pinned cache directory).

```
CODE_ROOT   = the directory two levels above THIS SKILL.md file
              (skills/tiktok-news-video/SKILL.md -> up 2 = plugin root).
              Resolve this from the actual file path this skill loaded from
              -- do not assume it equals any fixed path.
              Contains: scripts/, knowledge/, remotion/ (the engine/code —
              read-only from this skill's perspective).

CONFIG_FILE = ~/.tiktok-news-video/config.local.json
              (Windows: %USERPROFILE%\.tiktok-news-video\config.local.json)
              Fixed home-directory path, independent of CODE_ROOT and stable
              across every plugin update. Read this file's `workspaceDir`
              field to get WORKSPACE_DIR below. Also holds `voiceId`,
              `bgmLibrary[]`. The ElevenLabs API key lives alongside it in
              `~/.tiktok-news-video/.env` (ELEVENLABS_API_KEY=...).

WORKSPACE_DIR = config.local.json's `workspaceDir` field — a normal, visible
              folder the user chose during init (default suggestion:
              ~/Desktop/tiktok-news-video-workspace). Contains:
                $WORKSPACE_DIR/assets/         user's reusable image/video library
                $WORKSPACE_DIR/bgm-library/    saved BGM tracks
                $WORKSPACE_DIR/output/         rendered videos, <dated-slug>/ per run
```

Every script that touches assets/bgm-library/output/config takes
`workspaceDir` as an explicit argument (never infers it from its own
location) — see each script's own usage comment. `scripts/render.mjs` needs
BOTH: it resolves the Remotion engine from its own CODE_ROOT but writes
`--public-dir=<workspaceDir>` so `staticFile()` calls resolve against the
user's data, not the plugin's code.

Read `$CODE_ROOT/knowledge/script-rewrite-house-style.md` before Step 2, and
`$CODE_ROOT/knowledge/elevenlabs-v3-tts.md` + `$CODE_ROOT/knowledge/effect-catalog.md`
before Steps 4/6.

## Step 1 — Parse the chat input

`$ARGUMENTS` (or whatever the user pasted in chat) contains blocks like:
```
Scene 1: [nội dung] — ảnh: hop-bao.jpg
Scene 2: [nội dung] — video: phong-van.mp4
```
Parse into `scenes[] = [{ index, text, assetFilename }]`. For each
`assetFilename`, verify the file exists under `$WORKSPACE_DIR/assets/` — if
ANY are missing, stop here and list the missing filenames (this is the one
validation that must block before doing any paid API work). If the user
separately mentions a video file wasn't embeddable in the doc but names it in
the script, treat that name exactly like any other `assetFilename` — it must
already be in `$WORKSPACE_DIR/assets/`.

Also ask (once, if not already clear from the message): does the user have a
ready MP3 narration file, or should TTS generate it?

## Step 2 — Script rewrite (house style)

Apply `$KNOWLEDGE/script-rewrite-house-style.md` to every scene's `text`.
Produce, per scene: original, rewritten, and the one-line reasoning for the
framing chosen. This is content work — think about each scene, don't
mechanically paraphrase.

## Step 3 — Review (ONE user pause)

Show the rewrite in chat per the house-style doc's format (text only, no
visual UI). Ask: "Giữ bản xào lại này, hay bạn muốn sửa scene nào?" If the
user pastes replacement text for specific scenes, use it verbatim for those
scenes (do not rewrite on top of a user edit) and keep your rewrite for the
rest. Lock in final `scenes[].finalText` before continuing.

## Step 4 — Resolve narration audio

- **User has an MP3** → run `scripts/align-audio.mjs` with the audio path +
  ordered `finalText` array → get `{startSec, endSec}` per scene (forced
  alignment, NOT transcribe-then-fuzzy-match — see the knowledge doc for why
  that distinction matters for Vietnamese).
- **No MP3** → build `ttsText` per scene (add ElevenLabs v3 audio tags per
  `$CODE_ROOT/knowledge/elevenlabs-v3-tts.md`'s selection method — sparse,
  action-adjacent, matched to each scene's rhetorical role) → run
  `scripts/tts-elevenlabs.mjs` with the scenes + `voiceId` from
  `$CONFIG_FILE` + the API key from `~/.tiktok-news-video/.env` → get the
  synthesized narration file AND `{startSec, endSec}` per scene from the
  same call (no separate alignment step needed for this path).
- Either way, sanity-check: sum of `(endSec - startSec)` across scenes should
  roughly match the full audio duration (±2s). If it doesn't, that's a bug to
  fix (re-check the alignment/tag-stripping), not something to silently ship.

## Step 5 — BGM (ONE user pause)

Run `scripts/bgm-library.mjs list`. If it returns saved tracks, show them as
options + "khác (tải file mới)"; if empty, ask directly whether the user has
a BGM file. If they provide a new one, ask what to name it, then
`scripts/bgm-library.mjs save <path> <name>`. If they decline BGM entirely,
proceed without it (no `bgmAudioPath` in the spec). BGM always mixes at a
constant 25% volume, no ducking, looped to the full video length — never
ask about volume, that's fixed by the design spec.

## Step 6 — Classify assets and build `spec.json`

For each scene's asset, run `scripts/probe-asset.mjs` to get
`{type, width, height}`. Apply the classification table in
`$CODE_ROOT/knowledge/effect-catalog.md` exactly (landscape→pan, portrait→zoom,
square-ish→diagonal, video→passthrough; contain-blur-pad override when
cropping would lose too much or the asset is a non-9:16 video). Alternate pan
direction by scene index for landscape scenes specifically (not globally
across all scene types).

Convert each scene's `{startSec, endSec}` (from Step 4) into
`{startFrame, durationInFrames}` at 30fps. Call `buildSpecToFile` from
`scripts/build-spec.mjs` with `workspaceDir: <WORKSPACE_DIR>` (from
`$CONFIG_FILE`) — it resolves `assets/<assetFilename>` against that
workspace and returns the full `spec.json` shape Remotion expects.

## Step 7 — Render

Create the dated+slugged output folder first (see Section H of the design
spec for the convention: `$WORKSPACE_DIR/output/<YYYY-MM-DD>_<slug>/`,
containing `final.mp4`, the narration audio, and `spec.json` itself for
reproducibility). Run
`node scripts/render.mjs <spec.json path> <output .mp4 path> <WORKSPACE_DIR>`
— the third argument is required (it's what `--public-dir` and every
asset-existence check resolve against; omitting it or passing `CODE_ROOT`
instead is a bug, not a shortcut). If the render fails, diagnose (bad asset
path, Remotion error, missing dep from an incomplete init) and fix before
retrying — don't surface a raw stack trace as "done, but broken."

## Step 8 — Report

Tell the user where the final video landed
(`$WORKSPACE_DIR/output/<dated-slug>/final.mp4`), the video's duration, and a
one-line summary of what effects/BGM/voice were used.

## Explicit scope guard

Do not add karaoke-style word-synced captions (alignment data here is used
ONLY to size scene durations, never for on-screen text sync) — that was
explicitly cut from this plugin's scope in the design spec. Do not build a
visual Artifact/blur-reveal UI for script review — text-in-chat only. Do not
add BGM ducking — constant 25% is the whole spec.
