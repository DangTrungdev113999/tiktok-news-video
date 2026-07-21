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

- **Is the machine ready?** Two separate questions, and they fail on different
  schedules:
  - **the config file missing** (`<home>/.tiktok-news-video/config.local.json`,
    resolved via `os.homedir()` — never the literal `~`, see `paths-and-config.md`) → first run ever on
    this machine. Hand off to `tiktok-news-video-init`.
  - **`$CODE_ROOT/remotion/node_modules/@remotion/cli/` missing** → the render
    engine is not installed *for this copy of the plugin*. Hand off to init
    too, and tell the user to answer **N** when it asks whether to
    reconfigure — their key, voice and pace are kept.

  The second is the common case and the config check cannot see it. Config
  lives in the home folder and survives forever; `node_modules` (~600MB) and
  Chrome live beside the code, in a **version-pinned** directory, so **every
  plugin update lands the user in a fresh copy with no engine.** Before this
  check existed the run went straight to Step 2, spent the ElevenLabs quota,
  then reached a render that silently began downloading Remotion and ~93MB of
  Chrome through `npx` with no explanation.
- **No scene script in `$ARGUMENTS`?** Ask the user to paste it in chat,
  referencing assets by the names already in `assets/`. Don't invent one.
- **Ask once whether they have a ready MP3 narration**, or whether TTS should
  generate it. Step 2 needs the answer either way.
- **Do the assets still have their camera names?** (`IMG_4821.HEIC`,
  `Screenshot 2026-07-20.png`.) Point the user at `/clean-source` before you
  start — it renames a folder to `anh_1` / `video_2` and makes the `_des`
  marker copies the tags rely on. See `asset-naming.md`.
- **Offer the voice and pace only if the user brings them up.** Both live in
  `$CONFIG_FILE` (`voiceId`, `narrationPace`) and hold across runs. A user who
  says "đọc nhanh hơn" or names a different voice for THIS video gets it via
  `synthesizeScript`'s `voiceId` / `paceLabel` options — a per-run override
  that does not touch their saved defaults. Don't raise it unprompted; it is
  settled configuration, not a decision the pipeline needs made.

### Everything that can stop the run, checked BEFORE the paid call

Step 2 spends the user's ElevenLabs quota. Every condition that would abort the
run has to be tested before it, or a missing folder costs real money and a
whole re-run:

| Check | Where it lives |
|---|---|
| every asset filename resolves to exactly one file | `script-input.md` |
| at least one valid brand kit exists | `hook-and-brand.md` |
| every tag key is one the pipeline implements | `tags/README.md` |

The asset check was already gated this way. The brand check was not — it used
to sit at Step 4, so `buildSpec` threw *"a scene has isHook: true but no
brandKit was provided"* AFTER the narration had been paid for and synthesised.
Run `listBrands()` up front; you do not need to ask WHICH brand yet, only to
prove one exists.

## Autonomy contract (read first)

- **The user's scene text is the narration, verbatim.** You never rewrite,
  tighten, or re-order it. There is no house-style pass and no script-review
  pause — both were deleted 2026-07-20. Only `ttsText` (audio-tag markup) is
  yours to compose, and it changes delivery, never wording.
- **You stop for the user in exactly FOUR places, and no others.** Three are
  unconditional, one fires only sometimes:

  | # | Stop | When |
  |---|---|---|
  | 1 | Paste the scene script | only if `$ARGUMENTS` is empty |
  | 2 | Ready MP3, or shall TTS read it? | always, once, before Step 2 |
  | 3 | Which BGM (Step 3) | always |
  | 4 | Which brand kit | **only when 2+ valid kits exist** — silent with one, hard error with zero |

  Everything else — asset classification, effect selection, TTS/alignment,
  rendering, retrying a failed render — is automatic. Don't ask permission for
  deterministic steps the spec already decided.

  (This list used to read "exactly ONE place: the BGM choice" while the same
  file told you to ask two other questions. An agent trusting the contract
  over the prose would silently skip the MP3 question and synthesise narration
  the user already had.)
- **An unimplemented tag key stops the run.** `tags/README.md` lists what
  exists; a key outside it is reported and the run halts until the user says
  what they meant. This is a fifth stop, but a rare and unwelcome one — it
  means the script asked for something the pipeline cannot do, and guessing
  would ship a video missing the effect the author asked for. Do NOT treat it
  as a warning to note at Step 6.
- **Every failure self-fixes.** A missing asset file, a render error, a
  duration mismatch between narration and scene timing — you diagnose and fix
  (re-probe assets, re-run alignment, adjust `spec.json`, re-render), not stop
  at "here's an error, what do you want to do?".
- **Verify by pixels, not by preview.** Anything that changes what's on screen
  is checked by rendering a frame and measuring it — see
  `references/text-layout.md`.
- **Pixels are not enough for text.** Every geometric check — the black-band
  scan, the safe-zone measurement, the smoke test — passed on a video whose
  karaoke read "Tinh Hà X2" instead of "Tinh Hà Say Hi". They measure where
  things sit, never what they say. So run
  `node scripts/verify-captions.mjs <spec.json> <sceneTexts.json>` before
  rendering. It exits non-zero on the first word that differs from the script.
- If the config file (`<home>/.tiktok-news-video/config.local.json`) doesn't exist yet, this is the
  first run on this machine — hand off to the `tiktok-news-video-init` skill
  before anything else; do not attempt to render without it.
- Use TaskCreate/TaskUpdate (or your harness's todo tool) to track the steps
  below across a run.

## The steps

Read `references/paths-and-config.md` before Step 1 — resolving CODE_ROOT vs
WORKSPACE_DIR wrongly silently destroys the user's data on the next update.

| # | Step | Stops? | Detail |
|---|---|---|---|
| 1 | Parse the script; verify every asset, every tag key, and that ≥1 brand kit exists | on failure | `script-input.md`, `tags/README.md`, `hook-and-brand.md` |
| 2 | Resolve narration audio + word timing — **the paid step** | — | `narration-and-bgm.md`, `narration-pace.md` |
| 3 | Resolve BGM | **yes** | `narration-and-bgm.md` |
| 4 | Classify motion, mark the hook screen, pick the brand, build `spec.json` | only if 2+ brands | `motion.md`, `hook-and-brand.md`, `build-and-render.md` |
| 4b | `verify-captions.mjs` — the karaoke says what the author wrote | on failure | `build-and-render.md` |
| 5 | Render | — | `build-and-render.md` |
| 6 | Report where it landed | — | `build-and-render.md` |

Step 1 now carries the brand **existence** check (not the choice — that stays
at Step 4). Everything that can abort a run belongs before Step 2, because
Step 2 is where the user's money goes.

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
