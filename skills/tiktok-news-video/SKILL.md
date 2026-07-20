---
name: tiktok-news-video
user-invocable: true
description: "TikTok News Video pipeline. From images/videos + a scene script pasted in chat: rewrite the script for zero-background-knowledge readability (user approves/edits) -> resolve narration (user MP3 + forced alignment, or ElevenLabs v3 TTS with built-in timestamps) -> resolve BGM (saved library or new upload) -> resolve which brand kit to use (auto if only one exists) -> classify each asset's motion by aspect ratio (pan/zoom/diagonal/passthrough + blur-pad for non-filling assets) -> render END-TO-END to a finished MP4 via Remotion. Script review + BGM choice always ask the user; brand choice only asks when 2+ brand folders exist; everything else is automatic, including bug fixing. Invoked by /make-video."
argument-hint: "<scene script pasted in chat>"
---

# TikTok News Video Pipeline

You turn a user-supplied set of images/videos + a scene script into a finished
TikTok-format (1080×1920, 30fps) news video. Read
`docs/superpowers/specs/2026-07-17-tiktok-news-video-design.md` for the full
design rationale if anything below is ambiguous — this SKILL.md is the
operational summary of that spec.

## Autonomy contract (read first)

- **You always pause for the user in TWO places:** the script-rewrite review
  (Step 3) and the BGM choice (Step 5). A THIRD pause — which brand kit to use
  (Step 6) — only fires conditionally: skip it silently if exactly one brand
  folder exists (just use it), stop with a clear error if zero valid ones
  exist, only ask when 2+ exist. Everything else — asset classification,
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
                $WORKSPACE_DIR/brand/          one subfolder per brand kit (see below)
                $WORKSPACE_DIR/output/         rendered videos, <dated-slug>/ per run
```

`$WORKSPACE_DIR/brand/<slug>/` holds one self-contained brand kit
(`hook-bg.jpg` + `brand.json` — badge text and full color palette, see
`docs/superpowers/specs/2026-07-18-multi-brand-kit-design.md`). Brands are
prepared by the plugin owner (co-designed with Claude) and handed to
employees as a folder to drop in — there is no registration command. Use
`scripts/brand-kit.mjs`'s `listBrands(workspaceDir)`/`getBrand(slug,
workspaceDir)` to resolve one (see Step 6).

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
  that distinction matters for Vietnamese) AND `words[]` per scene (same call
  — word-level timing for Step 6's karaoke captions).
- **No MP3** → build `ttsText` per scene (add ElevenLabs v3 audio tags per
  `$CODE_ROOT/knowledge/elevenlabs-v3-tts.md`'s selection method — sparse,
  action-adjacent, matched to each scene's rhetorical role) → run
  `scripts/tts-elevenlabs.mjs` with the scenes + `voiceId` from
  `$CONFIG_FILE` + the API key from `~/.tiktok-news-video/.env` → get the
  synthesized narration file AND `{startSec, endSec}` **and `words[]`** per
  scene from the same call (no separate alignment step needed for this
  path). Keep this `words[]` — it's what drives captions in Step 6; don't
  discard it after computing scene timings.
- Either way, sanity-check: sum of `(endSec - startSec)` across scenes should
  roughly match the full audio duration (±2s). If it doesn't, that's a bug to
  fix (re-check the alignment/tag-stripping), not something to silently ship.
- Note: natural speech pauses leave small gaps between one scene's `endSec`
  and the next scene's `startSec` — `build-spec.mjs`'s `buildSpec()` closes
  these automatically (extends each scene's hold through to the next scene's
  real start) before converting to frames, so you don't need to do this by
  hand. `words[]` timing is left untouched by that close (captions must track
  real speech, not the extended hold) — just pass `words[]` straight through.

## Step 5 — BGM (ONE user pause)

Run `scripts/bgm-library.mjs list`. If it returns saved tracks, show them as
options + "khác (tải file mới)"; if empty, ask directly whether the user has
a BGM file. If they provide a new one, ask what to name it, then
`scripts/bgm-library.mjs save <path> <name>`. If they decline BGM entirely,
proceed without it (no `bgmAudioPath` in the spec). BGM always mixes at a
constant 25% volume, no ducking, looped to the full video length — never
ask about volume, that's fixed by the design spec.

## Step 6 — Classify assets, mark the hook scene, and build `spec.json`

For each scene's asset, run `scripts/probe-asset.mjs` to get
`{type, width, height}` (also used by `build-spec.mjs` for pan's real
crop-overflow traversal — see the knowledge doc). Apply the classification
table in `$CODE_ROOT/knowledge/effect-catalog.md` exactly (landscape→pan,
portrait→zoom, square-ish→diagonal, video→passthrough; contain-blur-pad
override when cropping would lose too much or the asset is a non-9:16
video). Alternate pan direction by scene index for landscape scenes
specifically (not globally across all scene types).

**Hook scene:** scene index 0 gets `isHook: true` plus a `hookHeadline`.
Default `hookHeadline` to that scene's OWN final (rewritten) narration text,
rendered ALL-CAPS by the component — this is "the hook" the user is already
saying in scene 1, not a separately-invented stat headline; do not craft a
new sentence here unless the user explicitly asks for a different one. The
hook scene is excluded from karaoke captions (Step 4's `words[]` for that
scene is simply not passed to `buildSpec` — see below); it gets the
hook-card overlay instead (gradient card + brand badge + the headline,
rendered by `HookCard.tsx`), which needs one resolved brand kit.

**Resolve the brand kit** (the conditional THIRD user pause from the
autonomy contract): call `listBrands(workspaceDir)` from
`scripts/brand-kit.mjs`.
- Report any entries in its `invalid[]` array by name in chat (e.g. "bỏ qua
  folder `abc/` vì thiếu `brand.json`") — never silently drop a broken
  folder, the employee who copied it needs to know something's wrong.
- Zero valid brands → stop with a clear message telling the user to drop a
  brand folder (with `hook-bg.jpg` + `brand.json`) into
  `$WORKSPACE_DIR/brand/<slug>/` — do not render without one.
- Exactly one valid brand → use it automatically, no question asked; note
  which brand was used in the Step 8 report.
- Two or more valid brands → ask the user to pick one, showing each
  `displayName`.
Resolve to one `brand` object (from `listBrands`' `brands[]`) before
building the spec.

Convert each scene's `{startSec, endSec}` (from Step 4) into
`{startFrame, durationInFrames}` at 30fps — `buildSpec` does the gap-closing
itself (see Step 4's note), so pass the raw per-scene timing straight
through. Call `buildSpecToFile` from `scripts/build-spec.mjs` with
`workspaceDir: <WORKSPACE_DIR>` (from `$CONFIG_FILE`), each scene's `words[]`
(omit for the hook scene), `isHook`/`hookHeadline` on the hook scene, and
`brandKit` set to the resolved brand object above — it resolves
`assets/<assetFilename>` against that workspace, chunks `words[]` into
karaoke caption lines, and returns the full `spec.json` shape Remotion
expects.

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
one-line summary of what effects/BGM/voice/brand were used.

## Explicit scope guard

Karaoke captions (Step 6) are in scope for every scene EXCEPT the hook scene
— don't add per-word styling variety or a second caption style, the single
`Captions.tsx` look is the whole spec. Do not build a visual
Artifact/blur-reveal UI for script review — text-in-chat only. Do not add
BGM ducking — constant 25% is the whole spec. Do not bake host-app UI chrome
(search bars, play buttons, progress bars) into the hook-card overlay — that
belongs to whatever app plays the video back, not to the video itself.
