# Steps 4–5 — Narration audio and BGM

## Step 4 — Resolve narration audio

Two paths, both producing the SAME shape: `{startSec, endSec}` per scene plus
`words[]` per scene.

**User has an MP3** → run `scripts/align-audio.mjs` with the audio path +
ordered `finalText` array. This is forced alignment, NOT
transcribe-then-fuzzy-match — see `knowledge/elevenlabs-v3-tts.md` for why
that distinction matters for Vietnamese. The same call returns `words[]` per
scene (word-level timing for Step 6's karaoke captions).

**No MP3** → build `ttsText` per scene, adding ElevenLabs v3 audio tags per
`$CODE_ROOT/knowledge/elevenlabs-v3-tts.md`'s selection method (sparse,
action-adjacent, matched to each scene's rhetorical role). Then run
`scripts/tts-elevenlabs.mjs` with the scenes + `voiceId` from `$CONFIG_FILE` +
the API key from `~/.tiktok-news-video/.env`. You get the synthesized
narration file AND `{startSec, endSec}` **and `words[]`** per scene from the
same call — no separate alignment step needed on this path.

**Keep `words[]` either way.** It's what drives captions in Step 6; don't
discard it after computing scene timings.

### Sanity check (do not skip)

The sum of `(endSec - startSec)` across scenes should roughly match the full
audio duration (±2s). If it doesn't, that's a bug to fix — re-check the
alignment / tag-stripping — not something to silently ship.

### Timing gaps are handled for you

Natural speech pauses leave small gaps between one scene's `endSec` and the
next scene's `startSec`. `build-spec.mjs`'s `buildSpec()` closes these
automatically (extends each scene's hold through to the next scene's real
start) before converting to frames, so you don't need to do this by hand.

`words[]` timing is left untouched by that close — captions must track real
speech, not the extended hold. Pass `words[]` straight through.

## Step 5 — BGM (USER PAUSE #2)

Run `scripts/bgm-library.mjs list`.

- Saved tracks exist → show them as options plus "khác (tải file mới)".
- Library empty → ask directly whether the user has a BGM file.
- New file provided → ask what to name it, then
  `scripts/bgm-library.mjs save <path> <name>`.
- User declines BGM entirely → proceed without it (no `bgmAudioPath` in the
  spec).

BGM always mixes at a constant **25% volume, no ducking**, looped to the full
video length. Never ask about volume — that's fixed by the design spec. Do not
add ducking; constant 25% is the whole spec.
