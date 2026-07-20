---
name: tiktok-news-video
user-invocable: true
description: "TikTok News Video pipeline. From images/videos + a scene script pasted in chat: rewrite the script for zero-background-knowledge readability (user approves/edits) -> resolve narration (user MP3 + forced alignment, or ElevenLabs v3 TTS with built-in timestamps) -> resolve BGM (saved library or new upload) -> resolve which brand kit to use (auto if only one exists) -> classify each asset's motion by aspect ratio (pan/zoom/diagonal/passthrough + blur-pad for non-filling assets) -> render END-TO-END to a finished MP4 via Remotion. Script review + BGM choice always ask the user; brand choice only asks when 2+ brand folders exist; everything else is automatic, including bug fixing. Invoked by /make-video."
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
| `references/script-input.md` | Steps 1–3: parse the scene script, rewrite it, get approval |
| `references/narration-and-bgm.md` | Steps 4–5: TTS or forced alignment, BGM choice |
| `references/motion.md` | Which movement each asset gets, and per-asset overrides |
| `references/tags/README.md` | The tag grammar; one file per tag key, opened on demand |
| `references/hook-and-brand.md` | The hook scene and resolving which brand kit to use |
| `references/text-layout.md` | Typography, TikTok safe zone, karaoke captions |
| `references/build-and-render.md` | Steps 6–8: build `spec.json`, render, report |

Background rationale for anything ambiguous:
`docs/superpowers/specs/2026-07-17-tiktok-news-video-design.md`.

## Autonomy contract (read first)

- **You always pause for the user in TWO places:** the script-rewrite review
  (Step 3) and the BGM choice (Step 5). A THIRD pause — which brand kit to use
  (Step 6) — only fires conditionally: skip it silently if exactly one brand
  folder exists, stop with a clear error if zero valid ones exist, only ask
  when 2+ exist. Everything else — asset classification, effect selection,
  TTS/alignment, rendering, retrying a failed render — is automatic. Don't ask
  permission for deterministic steps the spec already decided.
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
| 2 | Rewrite each scene in house style | — | `script-input.md` |
| 3 | Show the rewrite, take edits | **yes** | `script-input.md` |
| 4 | Resolve narration audio + word timing | — | `narration-and-bgm.md` |
| 5 | Resolve BGM | **yes** | `narration-and-bgm.md` |
| 6 | Classify motion, mark the hook scene, resolve the brand, build `spec.json` | conditional | `motion.md`, `hook-and-brand.md`, `build-and-render.md` |
| 7 | Render | — | `build-and-render.md` |
| 8 | Report where it landed | — | `build-and-render.md` |

## Explicit scope guard

These are settled decisions. Don't reopen them mid-run:

- **No second caption style** and no per-word styling variety — the single
  `Captions.tsx` look is the whole spec. Captions cover every scene except the
  hook scene.
- **No visual UI for script review** — text in chat only.
- **No BGM ducking** — constant 25% is the whole spec.
- **No host-app chrome** baked into the hook card (search bars, play buttons,
  progress bars) — that belongs to the app playing the video back.
- **No bespoke per-scene motion code** — one parametric `Scene.tsx`, driven by
  named effects.
- **No per-brand typography or layout** — brands vary by color and badge text
  only.
