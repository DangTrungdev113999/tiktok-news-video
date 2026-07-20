# On-screen text — typography, safe zone, captions

Full rationale and the measurement method:
`docs/superpowers/specs/2026-07-20-safe-zone-typography-design.md`.

## The one rule

**All on-screen text geometry lives in `remotion/src/layout.ts`** — font,
sizes, badge/headline/caption positions, and the TikTok safe-zone bounds.
Every number in it was measured off reference frames, not eyeballed.

Do not re-tune those numbers inside `HookCard.tsx` / `Captions.tsx`. Change
`layout.ts`, then re-verify by rendering a still and measuring the pixels (the
design spec's §F shows the method). "Looks right in the Remotion preview" is
exactly what produced the round-1 output the user rejected.

## TikTok safe zone

TikTok draws its own UI over the video during playback. Text outside this box
gets covered on a real phone:

| Edge | Bound (1080×1920) |
|---|---|
| top | 247 |
| bottom | 1629 |
| left | 51 |
| right, above y862 | 1026 |
| right, below y862 | **886** |

The right edge tightens below y862 — that's where the like/comment/share
column starts. The lower half of the frame is the dangerous region, and it's
where all of this video's text lives.

## Typography

**Oswald 700**, subsets `["vietnamese", "latin"]`, shared by the hook headline
and the karaoke captions at the same 54px size. The Vietnamese subset is
non-negotiable — narration is always Vietnamese and the headline renders
ALL-CAPS, so every diacritic must exist in the loaded subset.

Chosen over Anton (too heavy at caption size, single weight) and Barlow
Condensed (too wide vs the reference).

## Headline is bottom-anchored

The headline block is anchored by its **bottom** edge, not its top. Headline
text is user-supplied narration of unpredictable length; a top-anchored block
grows downward into the covered band as soon as it needs another line. Bottom
anchoring grows it upward instead — safe at any length.

`fitHeadlineFontSize()` steps the font 54 → 48 → 44 when the estimate exceeds
`maxLines: 3`. Its `AVG_UPPERCASE_CHAR_EM` constant is **measured** (0.48
real, set to 0.50 so it errs toward shrinking early). If you ever change the
font, re-measure it — an under-estimate silently pushes the headline up into
the badge.

## Captions

One global `Captions.tsx` outside any per-scene `<Sequence>`, driven by
absolute-frame word timing from `build-spec.mjs`'s chunking.

Style is **cumulative read-highlight**: a word turns gold the moment its own
speech starts and stays gold; unread words stay white. NOT a per-word pop or
zoom — that was tried and corrected 2026-07-18.

A caption group may wrap onto **two** rendered lines. `build-spec.mjs`'s
bounds (9 words / 52 chars) describe the whole group; the rendered row count
follows from the box width via `flex-wrap`.

## Scope guard

Karaoke captions are in scope for every scene EXCEPT the hook scene. Don't add
per-word styling variety or a second caption style — the single `Captions.tsx`
look is the whole spec.
