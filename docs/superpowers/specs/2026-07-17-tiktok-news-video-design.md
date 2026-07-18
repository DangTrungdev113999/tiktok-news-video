# TikTok News Video Plugin — Design Spec

Date: 2026-07-17
Status: approved-by-default (autonomous continuation — see note at bottom)

## 0. Goal

A standalone Claude Code plugin (`tiktok-news-video`) that a non-technical staff
member (Windows or Mac) can install, run a one-time `init`, then produce a
finished TikTok-format (1080×1920, 30fps) news video end-to-end from:
images/videos + (optional MP3 narration) + a scene script typed straight into
chat. No dependency on the existing `content-video-plugin` repo — fully
independent, though several implementation patterns found there (ElevenLabs v3
tag taxonomy, BGM schema shape, loudness mastering via ffmpeg) are reused as
*reference material*, not as code dependencies.

## A. Pipeline architecture (confirmed)

```
1. Init (one-time per machine)
2. Parse chat input -> scenes[] = {text, asset filename}
3. Script rewrite (house-style) -> user approves/edits (text only, in chat)
4. Resolve audio:
     - user gave MP3 -> forced-align script text onto it
     - no MP3        -> ElevenLabs v3 TTS (voice_id FHhpndubmejSghqiumSv), timestamps come free
5. Compute per-scene start/end times from the aligned/generated timeline
6. Resolve BGM (saved library pick, or new upload -> save + name it)
7. Classify each asset (image: landscape/portrait/square; video: passthrough) -> pick effect
8. Compose Remotion timeline via ONE parametric scene component (not bespoke-per-scene)
9. Render MP4 (video + narration + BGM @25% loop) -> master loudness pass (-14 LUFS)
10. Write output to the per-video folder under the user's chosen output dir
```

Repo location: `~/Desktop/tiktok-news-video/`, new independent git repo,
structured as a Claude Code plugin:
```
.claude-plugin/plugin.json
commands/make-video.md         # thin dispatcher
skills/tiktok-news-video/SKILL.md   # orchestration logic (the DAG above)
agents/                        # none needed for v1 — effect selection is deterministic math, not bespoke-authored code
knowledge/script-rewrite-house-style.md
knowledge/effect-catalog.md
scripts/init.mjs
scripts/tts-elevenlabs.mjs
scripts/align-audio.mjs
scripts/bgm-library.mjs
remotion/                      # single shared Remotion project
assets/                        # user's reusable image/video library (gitignored)
bgm-library/                   # saved BGM files (gitignored)
output/                        # rendered videos (gitignored, points at user-chosen dir via symlink or config)
```

## B. Input contract (confirmed)

- Scene script + scene→asset mapping is typed/pasted directly in chat, one
  scene per line/block, referencing assets **by filename**:
  `Scene 1: [rewritten text] — ảnh: hop-bao.jpg`
- Images/videos live in `assets/` (a stable, reusable library — not
  re-uploaded per video). Videos not embeddable inline in the chat are still
  named by filename exactly like any other asset; they must already exist in
  `assets/` before the run.
- No fixed-template file required — the agent parses the chat message
  directly for `Scene N:` blocks + trailing `ảnh:`/`video:` filename refs.

## C. Script rewrite (house-style, knowledge doc)

Encoded as `knowledge/script-rewrite-house-style.md` (a locked, repeatable
standard — not "LLM rewrites it" freeform), covering the brief from the
original request:

1. Zero-background-knowledge readability: no jargon requiring explanation or
   a search; every rewritten scene must stand alone.
2. At least one of: analogy to an everyday situation, a psychology/behavioral
   framing, storytelling framing, or a "why this matters to you" insight —
   chosen per scene based on content, not templated.
3. **The agent must state its reasoning** for the chosen framing alongside
   the rewritten text (e.g. "→ dùng ẩn dụ X vì Y"), so the user can judge and
   correct it, not just accept a black box.
4. Output surface: **text only, in chat** (confirmed with user — no visual
   Artifact/blur-reveal UI; that idea from the original brief was
   superseded). Shown as original vs. rewritten side by side per scene in
   Markdown.
5. User can approve as-is, or edit/paste a replacement — either path proceeds
   straight to step 4 (audio) with the final text locked in.

## D. Audio pipeline

Two distinct paths — they do NOT align the same way:

**Path 1 — TTS-generated (no MP3 provided):**
- ElevenLabs v3 `text_to_speech` on the full approved script, tags inserted
  per `knowledge/effect-catalog.md`'s sibling doc
  `knowledge/elevenlabs-v3-tags.md` (adapted from the reference material
  found in `content-video-plugin`'s `voice-elevenlabs-v3.md` — emotion tags,
  pause tags, delivery tags, 3-mode stability).
- Default `voice_id = FHhpndubmejSghqiumSv` (trungdt_clone), overridable in
  local config.
- ElevenLabs returns character/word-level timestamps directly in the same
  call — **no separate alignment step needed** for this path.

**Path 2 — user-provided MP3:**
- Needs **forced alignment**: the known script text (scene-segmented) is
  aligned onto the existing audio waveform — NOT transcribe-then-fuzzy-match,
  which breaks on Vietnamese diacritics/homophones.
- Primary: ElevenLabs Speech-to-Text (Scribe) if it exposes word-level
  timestamps with acceptable Vietnamese accuracy — **to be verified during
  implementation** (flagged, not assumed).
- Fallback if Scribe's Vietnamese word-timing proves unreliable: local
  Whisper (large-v3) forced-alignment via `whisper-timestamped` or
  `stable-ts`, run through `scripts/align-audio.mjs`.
- Either way, the API is the same: input = (audio file, ordered scene texts),
  output = per-scene `{start, end}` in seconds.

Both paths converge on the same per-scene timing array before step 6.

**Update (2026-07-18):** karaoke captions were later requested and built.
Both paths now also return `words[]` per scene (word-level timing) alongside
`timings[]` — used by `build-spec.mjs` to build `spec.json`'s global
`captions` array (rendered by `remotion/src/Captions.tsx`) for every scene
except the hook scene. See §F's "Hook card + captions" addendum below.

## E. BGM handling (confirmed spec)

- At video-creation time, ask: "Bạn có file BGM muốn dùng không?"
  - If yes and it's new → ask for a name, save to `bgm-library/<name>.mp3`.
  - If the library already has saved tracks → show them as options + an
    "other (upload new)" option, same UX pattern as the existing
    `content-video-plugin`'s BGM config.
- Playback: loop under the full video length, **constant 25% volume**, no
  ducking (per explicit spec — simpler than `content-video-plugin`'s optional
  ducking, intentionally not carried over).

## F. Visual effects engine (deterministic, one parametric component)

Classification is by aspect ratio + media type — fully automatic, no manual
tagging required:

| Asset type | Detection | Effect |
|---|---|---|
| Landscape photo (w/h ≥ 1.2) | image, wide | **Ken Burns pan**: slow horizontal drift + slight zoom (100%→108%), direction alternates L↔R per scene index for rhythm |
| Portrait photo (h/w ≥ 1.2) | image, tall | **Slow centered zoom-in** (100%→112%), avoids motion sickness on already-tall content |
| Square-ish photo (0.83–1.2 ratio) | image | **Diagonal pan+zoom hybrid** (small diagonal drift + 100%→106% zoom) |
| Video clip | video, any ratio | **Passthrough** at native speed/content — no synthetic motion added |
| Any asset that can't fully "cover" the 1080×1920 frame without unacceptable cropping (e.g. extreme panorama, or a video not already 9:16) | any | **Contain + blur-pad background**: a blurred, scaled-up duplicate of the same asset fills the frame; the sharp original is centered on top at its natural aspect ratio |

Additional variety (researched, offered as extra presets configurable per
scene if the default classification feels monotonous):
- **Push/pull alternation**: alternate zoom-in vs. zoom-out across consecutive
  scenes of the same type, so the video doesn't feel like the same motion
  repeating.
- **Breathing hold**: for formal/headshot-style portraits, a very subtle
  100%→104% zoom instead of the stronger 112% — reads as "stillness with
  life" rather than a dramatic push.
- **Parallax layered** (subject-cutout float over blurred backdrop): flagged
  as a *possible* v2 addition, not in v1 — needs a background-removal step
  we don't have infra for yet.

Implementation: **one** parametric Remotion `<Scene>` component takes
`{assetPath, assetType, effect, durationInFrames}` — no per-scene bespoke
code, no determinism-gate risk, since the motion math is pure and
deterministic (`interpolate()` on frame number only).

**Update (2026-07-18) — pan traversal fix + hook card + captions:**
- The original pan implementation clamped translate to a zoom-derived
  overflow (~3.4% of frame width at the original 1.08 zoom target),
  regardless of the source image's actual crop overflow — landscape scenes
  barely moved. Fixed: pan now sizes the media at its true static cover
  scale (from `assetWidth`/`assetHeight`, now passed through `spec.json`)
  and traverses the REAL crop overflow. See `knowledge/effect-catalog.md`'s
  "Pan — real crop traversal" section for the full derivation.
- Amplitude bumped generally to match common short-form Ken-Burns intensity:
  portrait zoom 100%→120% (was 112%), square-ish diagonal 100%→108% + ±5%
  drift (was 106%/±4%).
- **Hook card**: scene index 0 gets `isHook: true` instead of karaoke
  captions — a full-frame background image (`brandKit.hookBgPath`,
  CSS-masked so only roughly the bottom HALF of the frame tints, fading
  smoothly out of the photo rather than a hard-edged band) + a fully coded
  ribbon badge (flush-left, rounded right end — replaced compositing the
  flat `logo.jpg` image, which read as less intentional and is no longer
  used) + a large, generously-spaced, embossed ALL-CAPS headline, rendered
  by `remotion/src/HookCard.tsx`. The headline defaults to the scene's OWN
  final narration text (not a separately-invented stat line — that was
  tried and corrected 2026-07-18). Headline font is Baloo2
  (`@remotion/google-fonts/Baloo2`, switched from an earlier Anton attempt
  for better readability/roundness at this size). No reveal/fade-in
  animation — badge and headline are fully static and visible from frame 0
  (an earlier version had a fade-in reveal; removed per explicit feedback
  2026-07-18: "không cần hiệu ứng đâu, luôn luôn xuất hiện nhé"). See the
  2026-07-18 multi-brand-kit spec for how `brandKit` itself is now resolved
  (per-brand folders with their own badge text + color palette, replacing
  the single machine-wide `brandKit` config field this section originally
  described).
- **Captions**: every non-hook scene gets word-synced karaoke captions,
  rendered by one global `remotion/src/Captions.tsx` component (outside any
  per-scene `<Sequence>`, driven by absolute-frame word timing from
  `build-spec.mjs`'s chunking) — see §D's update above for where the word
  data comes from. Style is cumulative read-highlight (a word turns gold the
  moment it starts and stays gold; unread words stay white), NOT a per-word
  pop/zoom — tried and corrected 2026-07-18 per user feedback.

Resolution/format defaults (not asked, presenting as defaults to confirm):
1080×1920 @ 30fps, H.264 MP4, target LUFS -14 for final master (reusing the
2-pass ffmpeg loudnorm approach found in `content-video-plugin`).

## G. Init flow (highest-risk deliverable — detailed per-OS)

Triggered once per machine via `scripts/init.mjs` (invoked by a `/init`
command or automatically on first `make-video` run if no local config
exists). Must be concrete, not "auto-installs dependencies":

1. **Detect OS** (`process.platform`).
2. **Node.js**: assumed present (Claude Code itself requires it) — verify
   with `node -v`, fail loudly with a plain-language message + a link if
   somehow absent.
3. **ffmpeg**:
   - Mac: check `which ffmpeg`; if missing, run `brew install ffmpeg`
     (verify Homebrew itself is present first; if not, print the official
     Homebrew install one-liner and stop with clear instructions — do not
     silently attempt to install Homebrew itself, that's a bigger
     permission ask than this plugin should take unprompted).
   - Windows: check `where ffmpeg`; if missing, try `winget install
     ffmpeg` (winget ships with modern Windows 10/11); if `winget` itself
     is absent, print manual download instructions (gyan.dev static
     build) with exact steps (download → extract → add to PATH).
4. **Remotion deps**: `npm install` inside `remotion/`, then trigger
   Remotion's Chrome Headless Shell download (`npx remotion browser
   ensure`) so the first real render isn't the first time that download
   happens.
5. **Verification step**: actually run each binary
   (`ffmpeg -version`, a `npx remotion --version`) and report per-item
   pass/fail in plain language — not just "done", but e.g.:
   ```
   ✅ Node.js 20.11 found
   ✅ ffmpeg 7.0 installed
   ✅ Remotion renderer ready
   ❌ ElevenLabs key not set — you'll need one for TTS videos
   ```
6. **Prompt for config** (only after the above passes):
   - Output folder: "Bạn muốn lưu video đã render ở đâu?" → validate the
     path exists/creatable → save.
   - ElevenLabs API key → save to local `.env` (gitignored), never
     committed.
   - Optionally confirm/override default `voice_id`.
7. Write everything to a local, gitignored `config.local.json` (output dir,
   saved BGM list pointer, voice_id) + `.env` (secrets only).

## H. Folder / output structure

```
tiktok-news-video/
  assets/                        # reusable image/video library, user-managed
  bgm-library/                   # named BGM tracks, grows over time
  output/                        # OR a symlink/pointer to the user-chosen dir from init
    2026-07-17_gia-vang-tang/
      final.mp4
      narration.mp3              # generated or copied-in source
      spec.json                  # the resolved scene/timing/effect spec used to render
  config.local.json               # gitignored: output dir, voice_id, saved BGM names
  .env                             # gitignored: ELEVENLABS_API_KEY
```

Each video gets its own dated+slugged folder so staff can find "what I just
made" instantly, mirroring the per-slug convention found in
`content-video-plugin` (minus its Postgres-backed catalog, which is
disproportionate for a lightweight plugin).

## I. Error handling & testing

- Init verification step (F.5) is the primary error-handling surface —
  fail fast, plain language, no silent partial success.
- Render pipeline validates before rendering: every scene's asset filename
  must resolve inside `assets/`, or it fails the whole run with a list of
  missing files (never renders a partially-broken video).
- Alignment step validates: sum of scene durations must roughly match total
  audio duration (±2s tolerance) — otherwise flags a likely mis-alignment
  rather than silently producing a garbled video.
- Testing: a synthetic smoke test (`scripts/smoke-test.mjs`) generates
  placeholder assets of each aspect-ratio class + a silent narration track
  with evenly-split scene durations, and renders a real MP4 through the full
  pipeline — this exercises the render engine without requiring a live
  ElevenLabs key, so it can run in CI / on a fresh machine before any API
  key is configured.

## J. Explicit scope cuts (confirmed or default-assumed)

- ~~No karaoke/word-synced captions~~ — **reversed 2026-07-18**: karaoke
  captions are now in scope for every scene except the hook scene (see §F's
  update). Still in scope as a cut: no per-scene caption style variation —
  one look, everywhere.
- No visual Artifact/blur-reveal UI for script review — text-only in chat.
- No ducking on BGM — constant 25%.
- No parallax/subject-cutout effects in v1.
- No dependency on `content-video-plugin` — independent repo, patterns
  adapted where useful, not imported.

---
**Process note:** this spec was authored under an active `/goal` Stop-hook
that requires a working, initialized plugin before the turn can end. Per the
brainstorming skill, sections were meant to be approved one at a time by the
user; sections A was shown and B–J were completed autonomously per "Auto Mode
Active" guidance (bias toward proceeding on reasonable defaults rather than
blocking) since no interactive user response was available mid-loop. All
choices above are either (a) directly confirmed via AskUserQuestion earlier
in this session, or (b) explicitly marked as a default/to-verify-later. The
user should review this file and flag anything to change.
