# TTS — ElevenLabs `eleven_v3` + audio tags (default voice `trungdt_clone`)

> Adapted from a verified reference in a sibling project (`content-video-plugin`'s
> `voice-elevenlabs-v3.md`, itself checked against the ElevenLabs API
> 2026-07-16). This doc is self-contained — no dependency on that repo.

## Voice identity (default for this plugin)

| | value |
|---|---|
| provider | ElevenLabs |
| model | `eleven_v3` — expressive model, supports audio tags |
| voice_id | **`FHhpndubmejSghqiumSv`** (`trungdt_clone`) — user-confirmed default, overridable in `config.local.json` |
| settings | `{ stability: 0.5, similarity_boost: 0.75 }` — **Natural** mode (see below); no `style`/`speaker_boost` (v3 ignores them) |
| env | `ELEVENLABS_API_KEY` in `.env` (set during `init`) |

## Stability — 3 discrete modes, not a slider

| Mode | value | Behaviour |
|---|---|---|
| Creative | `0.0` | most expressive, tags hit hardest — hallucinates (mis-reads script), risky on number-dense news copy |
| **Natural** | **`0.5`** | balanced, closest to source — **default** |
| Robust | `1.0` | very stable, largely ignores tags |

News scripts are often number-dense (dates, figures, names) — default to
Natural `0.5`; only drop to Creative for a pure-emotion beat with no critical
figures, and re-listen before shipping.

## THE data model — three strings, not two

Same trap as any tag-driven TTS pipeline: conflating these breaks scene timing.

| String | Contains | Consumed by |
|---|---|---|
| **display** | clean prose, no tags | shown to user in the script-review step (section C of the design spec) |
| **ttsText** | `[tag]` + pronunciation spell-outs | sent to ElevenLabs |
| **alignText** | ttsText with `/\[[^\]]*\]/g` stripped, whitespace collapsed | used only to sanity-check scene-duration sums (§ below) — tags are never spoken, so they must not count toward timing |

## Audio tags — verified taxonomy (use ONLY these)

- **Emotions:** `[sad]` `[angry]` `[happily]` `[sorrowful]` `[excited]` `[tired]`
  `[awe]` `[nervous]` `[hesitant]` `[curious]` `[sarcastic]` `[mischievously]`
  `[panicked]` `[amazed]` `[serious]` `[questioning]` `[suspicious tone]`
  `[angrily, fed up]`
- **Delivery/pacing:** `[whispers]` `[shouts]` `[dramatic tone]` `[rushed]`
  `[rapid-fire]` `[slows down]` `[deliberate]` `[drawn out]` `[stammers]`
  `[repeats]` `[timidly]` `[emphasized]` `[stress on next word]`
  `[understated]` `[flatly]` `[quietly, after a pause]` `[robotically]`
- **Non-verbal (strongest, action-adjacent):** `[laughs]` `[chuckles]`
  `[giggle]` `[sighs]` `[exhales]` `[breathes]` `[gasp]` `[crying]`
  `[snorts]` `[clears throat]` `[gulps]` `[trembling]`
- **Pauses/timing:** `[pause]` `[continues after a beat]` — never stack more
  than one in a row (destabilizes v3: speed-ups/artifacts).
- **Layering:** stack for compound nuance, e.g. `[hesitant][nervous]`.

Selection method:
1. Only use tags from the list above — an unlisted tag is unproven, listen-test
   before relying on it.
2. Prefer action-adjacent tags (`[sighs]`, `[gasps]`, `[snorts]`) over abstract
   mood tags (`[serious]`, `[flatly]`) — abstract tags wash out on an Instant
   Voice Clone unless paired with `[emphasized]` or `[pause]`.
3. Sparse density — not every sentence needs a tag; neutral/transitional
   scenes read best untagged.
4. Match tag to the scene's rhetorical role (hook/open question →
   `[questioning]`/`[curious]`; the reveal/punchline → `[emphasized]` +
   preceding `[pause]`; bad news → `[sighs]`/`[exhales]`, not `[flatly]` alone).

## Numbers & symbols

News scripts are number-dense (dates, %, currency). ElevenLabs v3's
auto-normalization of Vietnamese numbers is not fully verified — if a number
misreads on listen-check, put its spoken form directly in `ttsText` (e.g.
`77%` → `bảy mươi bảy phần trăm`) while keeping the clean symbol in `display`.

## Single-request whole-script synthesis (how per-scene timing is derived)

This is **Path 1** of the design spec's audio pipeline (no user MP3 provided):

1. Concatenate every scene's `ttsText`, joined by a paragraph break (`\n\n`) —
   NOT a single space (a flat space reads as one continuous breath with no
   scene-boundary cadence).
2. ONE call to `POST /v1/text-to-speech/{voice_id}/with-timestamps`. It
   returns `alignment.characters`, 1:1 with the exact input string
   *including* `[tag]` brackets (tag characters are timed but silent).
3. For each scene, walk the known character offset of its first/last spoken
   character (skip past any leading `[tag]` via a bracket-depth scan) to get
   `start_time`/`end_time` directly — no separate alignment step needed for
   this path (Path 2, user-provided MP3, needs real forced alignment — see
   `scripts/align-audio.mjs`).
4. `t0 = max(prevEnd, start_time[firstSpokenChar] − 0.06)`,
   `t1 = end_time[lastChar] + 0.10` — small padding so cuts don't clip onsets.
5. Sanity check: sum of `(t1 - t0)` across all scenes should roughly equal the
   full synthesized audio duration (±2s) — flag a mismatch rather than
   silently rendering with drifted timing.

## Re-synth ripple

Any tag/stability/voice change re-synthesizes the whole script → real
durations shift → the Remotion `spec.json` scene durations MUST be
regenerated from the new timestamps before re-rendering. Never hand-edit
`spec.json` durations after a re-synth.
