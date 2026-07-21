# Narration pace — how the read gets faster

ElevenLabs reads Vietnamese at about **193 words per minute**. Vietnamese
TikTok news sits nearer 260–290. The gap is closed after synthesis, by a
time-stretch, and the amount is the user's choice — recorded once at init as
`narrationPace` in `$CONFIG_FILE`.

You do not apply this yourself. `scripts/tts-elevenlabs.mjs` reads the config
and does it. This file exists so you understand what already happened when the
numbers reach you.

## `eleven_v3` ignores `voice_settings.speed`

Not a suspicion. Measured 2026-07-21, one sentence, one voice, three repeats
per setting:

| `speed` | three takes | mean |
|---|---|---|
| 0.7 | 12.88 / 12.56 / 11.84 | 12.43s |
| 1.0 | 12.64 / 12.88 / 12.48 | 12.67s |
| 1.2 | 13.28 / 12.56 / 12.88 | 12.91s |

A working `speed` would make the 0.7 take about 1.7× the 1.2 take — roughly
21s against 12s. All three land inside 12.4–12.9s, and the means drift the
**wrong way**, comfortably inside v3's own run-to-run spread (11.84 to 13.28
across identical calls). Sending `speed` to v3 spends credits and changes
nothing.

## So pace is `ffmpeg atempo`, applied after synthesis

`atempo` preserves pitch — no chipmunk. It is WSOLA underneath: it overlaps
and re-splices waveform windows, and the harder it is pushed the more that
surfaces as a faint warble on held vowels and clipped breaths between clauses.
Where that becomes audible depends on the voice and on the listener, which is
exactly why the level is a user setting and not a constant.

`scripts/narration-pace.mjs` owns the table. Both the init prompt and the TTS
path import it, so what a user picked and what the pipeline applied cannot
drift apart.

| label | atempo | ≈ wpm | episode length |
|---|---|---|---|
| `none` | 1.00× | 193 | unchanged |
| `2x` | 1.20× | 232 | −17% |
| `3x` | 1.30× | 251 | −23% |
| `4x` | 1.40× | 270 | −29% ← default |
| `5x` | 1.50× | 290 | −33% |

**The labels are not multipliers.** `5x` means the fifth notch, 1.5×. They are
the author's names for the levels. Anywhere a label is shown to a user, show
the real factor and the word rate beside it.

## Timestamps are rescaled with the audio

`rescaleTimeline()` divides every timestamp by the same factor. That is exactly
right because atempo is uniform: a word's position as a fraction of the whole
does not move.

Both `timings` **and** `words` get rescaled. Miss `words` and the karaoke falls
further behind the voice with every second that passes — a bug that looks fine
in the first shot and obvious by the last.

## Choosing a different model instead

Two models honour `speed` for real **and** support Vietnamese:
`eleven_turbo_v2_5` and `eleven_flash_v2_5`. Neither supports v3's audio tags;
they read `[excited]` aloud as text, so the tags must be stripped first.

Measured on the same episode: Hạnh reads at 193 wpm on v3, and **264 wpm on
turbo at `speed: 1.2` with no stretch at all**. But this is not a general rule
— Kiều Linh went the other way, 184 wpm on v3 against 229 on turbo, *slower*
than her own stretched v3 take. Test the specific voice.

### Check the model speaks Vietnamese. Every time.

`eleven_multilingual_v2` honours `speed` and was recommended on that basis. It
does **not** support Vietnamese — `GET /v1/models` lists 29 languages and `vi`
is not among them. The samples came back pronouncing Vietnamese with another
language's phonetics, and the author caught it by ear in seconds: *"không đúng
local Việt Nam rồi, nó nói tiếng nước nào ý."*

Before proposing any model, confirm `vi` is in its `languages`. A model that
reads quickly in the wrong language is worth nothing.
