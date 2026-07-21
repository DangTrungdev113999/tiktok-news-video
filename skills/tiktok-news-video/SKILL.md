---
name: tiktok-news-video
user-invocable: true
description: "TikTok News Video pipeline. From images/videos + a scene script pasted in chat: take the user's scene text VERBATIM as the narration (no rewriting) -> resolve narration (user MP3 + forced alignment, or ElevenLabs v3 TTS with built-in timestamps) -> resolve BGM (saved library or new upload) -> resolve which brand kit to use (auto if only one exists) -> classify each asset's motion by aspect ratio (pan/zoom/diagonal/passthrough + blur-pad for non-filling assets) -> render END-TO-END to a finished MP4 via Remotion. BGM choice always asks the user; brand choice only asks when 2+ brand folders exist; everything else is automatic, including bug fixing."
argument-hint: "<scene script pasted in chat>"
---

# TikTok News Video Pipeline

You turn a user-supplied set of images/videos + a scene script into a finished
TikTok-format (1080×1920, 30fps) news video.

This file is the **orchestration spine**: the contract you work under and the
order of the steps. Each step's detail lives in a reference file — open the
one for the step you're on rather than reading them all up front.

| Reference | Covers |
|---|---|
| `references/paths-and-config.md` | CODE vs WORKSPACE dirs, config file, where the house rules live |
| `references/script-input.md` | Step 1: parse the scene script (used verbatim) |
| `references/asset-naming.md` | How `anh_1` / `ảnh 1` resolves to a real file |
| `references/narration-and-bgm.md` | Steps 2–3: TTS or forced alignment, BGM choice |
| `references/narration-pace.md` | Why the read gets sped up after synthesis, and by how much |
| `references/motion.md` | Which movement each asset gets, and per-asset overrides |
| `references/tags/README.md` | The tag grammar; one file per tag key, opened on demand |
| `references/hook-and-brand.md` | The hook scene and resolving which brand kit to use |
| `references/text-layout.md` | Typography, TikTok safe zone, karaoke captions |
| `references/build-and-render.md` | Steps 4–6: build `spec.json`, render, report |

Background rationale for anything ambiguous:
`docs/superpowers/specs/2026-07-17-tiktok-news-video-design.md`.

## Starting a run

You are the entry point — there is no dispatcher command in front of you (the
thin `/make-video` and `/init` commands were deleted 2026-07-20; a command that
only forwarded its arguments to a skill was one more place for the two
descriptions to drift apart).

So, before Step 1:

- **No scene script in `$ARGUMENTS`?** Ask the user to paste it in chat,
  referencing assets by the names already in `assets/`. Don't invent one.
- **Ask once whether they have a ready MP3 narration**, or whether TTS should
  generate it. Step 2 needs the answer either way.
- **No `config.local.json`?** First run on this machine — hand off to
  `tiktok-news-video-init` and don't render until it reports passing.

## Autonomy contract (read first)

- **The user's scene text is the narration, verbatim.** You never rewrite,
  tighten, or re-order it. There is no house-style pass and no script-review
  pause — both were deleted 2026-07-20. Only `ttsText` (audio-tag markup) is
  yours to compose, and it changes delivery, never wording.
- **You pause for the user in exactly ONE place:** the BGM choice (Step 3). A
  SECOND pause — which brand kit to use (Step 4) — only fires conditionally:
  skip it silently if exactly one brand folder exists, stop with a clear error
  if zero valid ones exist, only ask when 2+ exist. Everything else — asset
  classification, effect selection, TTS/alignment, rendering, retrying a
  failed render — is automatic. Don't ask permission for deterministic steps
  the spec already decided.
- **Every failure self-fixes.** A missing asset file, a render error, a
  duration mismatch between narration and scene timing — you diagnose and fix
  (re-probe assets, re-run alignment, adjust `spec.json`, re-render), not stop
  at "here's an error, what do you want to do?".
- **Verify by pixels, not by preview.** Anything that changes what's on screen
  is checked by rendering a frame and measuring it — see
  `references/text-layout.md`.
- If `~/.tiktok-news-video/config.local.json` doesn't exist yet, this is the
  first run on this machine — hand off to the `tiktok-news-video-init` skill
  before anything else; do not attempt to render without it.
- Use TaskCreate/TaskUpdate (or your harness's todo tool) to track the steps
  below across a run.

## The steps

Read `references/paths-and-config.md` before Step 1 — resolving CODE_ROOT vs
WORKSPACE_DIR wrongly silently destroys the user's data on the next update.

| # | Step | Pauses? | Detail |
|---|---|---|---|
| 1 | Parse the scene script; verify every asset exists | — | `script-input.md` |
| 2 | Resolve narration audio + word timing | — | `narration-and-bgm.md` |
| 3 | Resolve BGM | **yes** | `narration-and-bgm.md` |
| 4 | Classify motion, mark the hook screen, resolve the brand, build `spec.json` | conditional | `motion.md`, `hook-and-brand.md`, `build-and-render.md` |
| 5 | Render | — | `build-and-render.md` |
| 6 | Report where it landed | — | `build-and-render.md` |

## Explicit scope guard

These are settled decisions. Don't reopen them mid-run:

- **No second caption style** and no per-word styling variety — the single
  `Captions.tsx` look is the whole spec. Captions cover every scene except the
  hook scene.
- **No script rewriting.** The user's text is spoken as typed.
- **No BGM ducking** — constant 25% is the whole spec.
- **No host-app chrome** baked into the hook card (search bars, play buttons,
  progress bars) — that belongs to the app playing the video back.
- **No bespoke per-scene motion code** — one parametric `Scene.tsx`, driven by
  named effects.
- **No per-brand typography or layout** — brands vary by color and badge text
  only.
