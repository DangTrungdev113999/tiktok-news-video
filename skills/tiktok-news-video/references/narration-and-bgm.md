# Steps 1b–3 — Voice, narration audio and BGM

## Step 1b — Voice (a user pause, TTS path only)

**Read this before Step 2.** It is written first because it has to HAPPEN
first: Step 2 is the call that spends the user's ElevenLabs quota, and a
voice chosen after it is a voice chosen too late to use.

**Skip this entirely on the MP3 path.** A run that synthesizes nothing needs no
voice, and asking for one is asking a question whose answer gets thrown away.

The voice used to be frozen at init: one id, chosen once, for every video
forever. That was the wrong place for the decision — init runs furthest from
the moment the choice matters, and the same person makes videos for several
channels that should not all sound alike. Init no longer asks; **you do, every
TTS run.**

Run `node $CODE_ROOT/scripts/voice-library.mjs list`.

- **Library has voices** → show them numbered, with each one's description,
  plus a final option **"thêm giọng mới"**. Whatever they pick, pass its
  `voice_id` to `synthesizeScript` as `voiceId` — always explicitly, never by
  letting the fallback decide.
- **Library empty** → two options, not an open prompt:
  1. `Hạnh — nữ trẻ giọng Bắc, rõ chữ, hợp tin tức` (`pGapy9MNHCukzJtjavF0`),
     the one voice this project has actually auditioned;
  2. nhập voice_id mới.
- **Adding a voice** → ask for the id AND for a description in the user's own
  words ("giọng nam trầm cho kênh crypto"), then
  `node $CODE_ROOT/scripts/voice-library.mjs add <voiceId> <mô tả>`.
  The description is required, and it is the whole point: an id is 20 random
  characters and tells the next person nothing.

### Validate before you save, and say what came back

`add` checks the id against ElevenLabs and reports whether `vi` is in the
voice's `verified_languages`. **Show that answer to the user before using the
voice.** A voice not verified for Vietnamese still produces confident audio —
it pronounces Vietnamese with another language's phonemes. This project shipped
exactly that mistake once: its own long-standing default id turned out to be a
voice cloned for cross-lingual *Indonesian* TTS.

An id ElevenLabs does not know is REFUSED: `add` exits non-zero and saves
nothing, so a typo is caught while the user is still looking at it rather than
at render time. A voice that exists but is not verified for Vietnamese is saved
WITH a loud warning — the user may know better than the label, but they have to
be told.

If the check cannot run at all (no network, no key on this machine), `add` says
so plainly and saves anyway — an unreachable API is not evidence that an id is
wrong. It reads the key from `<home>/.tiktok-news-video/.env` itself; you do not
pass it, and it must never appear on a command line.

### Where the list lives, and why it matters here

`<workspace>/voices.json`, beside `brand/` and `bgm-library/` — **not** in
`config.local.json`. An admin preparing a template folder for employees can
curate the voice list once and every employee receives it; config.local.json is
rebuilt per machine by init and can carry nothing to anyone.

Machines configured before the library existed keep their old voice: the first
`list` migrates `config.local.json`'s `voiceId` (or `.env`'s
`ELEVENLABS_VOICE_ID`) into `voices.json` automatically.

## Step 2 — Resolve narration audio

Two paths, both producing the SAME shape: `{startSec, endSec}` per scene plus
`words[]` per scene.

**User has an MP3** → run `scripts/align-audio.mjs` with the audio path +
ordered per-screen `text` array (the user's words, verbatim). This is forced alignment, NOT
transcribe-then-fuzzy-match — see `knowledge/elevenlabs-v3-tts.md` for why
that distinction matters for Vietnamese. The same call returns `words[]` per
scene (word-level timing for Step 4's karaoke captions).

**No MP3** → build `ttsText` per scene, adding ElevenLabs v3 audio tags per
`$CODE_ROOT/knowledge/elevenlabs-v3-tts.md`'s selection method (sparse,
action-adjacent, matched to each scene's rhetorical role). Then run
`scripts/tts-elevenlabs.mjs` with the scenes + the `voiceId` chosen in **Step 1b
above** + the API key from `<home>/.tiktok-news-video/.env`. You get the synthesized
narration file AND `{startSec, endSec}` **and `words[]`** per scene from the
same call — no separate alignment step needed on this path.

**Keep `words[]` either way.** It's what drives captions in Step 4; don't
discard it after computing scene timings.

### The TTS path speeds the read up, and hands you the new numbers

`tts-elevenlabs.mjs` time-stretches the narration after synthesis (the user
picked the amount at init; default is 1.4×) and rescales `timings` and
`words[]` to match. Everything you receive is already on the stretched
timeline — do not adjust it again. `references/narration-pace.md` explains why
this exists at all, since `eleven_v3` silently ignores `voice_settings.speed`.

The MP3 path does **not** stretch. A narration the user recorded or supplied
already has the pace they wanted.

### Sanity check (do not skip)

The sum of `(endSec - startSec)` across scenes should roughly match the full
audio duration (±2s). If it doesn't, that's a bug to fix — re-check the
alignment / tag-stripping — not something to silently ship.

**That check alone is not enough on the MP3 path.** It cannot see the failure
where one screen's words are swallowed by its neighbour: the spans still tile
the audio perfectly and the totals still agree. `align-audio.mjs` now warns
separately about any screen that ends up with under 0.5s or under 2 words.
Treat that warning as fatal — a screen with no words has no captions.

### Timing gaps are handled for you

Natural speech pauses leave small gaps between one scene's `endSec` and the
next scene's `startSec`. `build-spec.mjs`'s `buildSpec()` closes these
automatically (extends each scene's hold through to the next scene's real
start) before converting to frames, so you don't need to do this by hand.

`words[]` timing is left untouched by that close — captions must track real
speech, not the extended hold. Pass `words[]` straight through.

## Step 3 — BGM (THE user pause)

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

## Step 3b — Karaoke caption style (always asked)

Two looks exist, both driven by the same word-level timing from Step 2 — the
choice only changes how `remotion/src/layout.ts`'s `CAPTION` box renders it,
never the position/size, which stays whatever the brand kit resolves to
(`text-layout.md`).

Ask plainly, every run, after BGM:

- **cumulative** (mặc định / `Captions.tsx`) — the whole spoken group stays on
  screen together; each word turns gold the moment it's spoken and stays gold.
  Reads as a sentence filling in.
- **popup** (`PopupCaptions.tsx`) — small 2-3 word groups, one on screen at a
  time, cutting straight to the next group. Only the word being spoken right
  now is gold and slightly enlarged; every other word in the group — spoken or
  not — is plain white. Faster, punchier rhythm; better for short, high-energy
  hooks.

Pass the answer straight through as `captionStyle: "cumulative" | "popup"` to
`buildSpec`/`buildSpecToFile` (see `build-and-render.md`) — omit the field
entirely only if you're reusing an old flow that predates this option, since
`buildSpec` already defaults to `"cumulative"` when it's absent.

This is a per-video editorial choice, not a brand identity trait — it does
**not** live in `brand.json` alongside colours/badge text, and it is not
skipped just because the channel has rendered one style before.
