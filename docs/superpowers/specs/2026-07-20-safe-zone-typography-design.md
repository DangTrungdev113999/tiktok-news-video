# Safe-Zone Typography — Design Spec

Date: 2026-07-20
Status: approved by user, implemented and pixel-verified

## 0. Goal

Round-1 output looked wrong on a real phone for two independent reasons:

1. **Wrong typeface.** The hook headline used Baloo2 (a rounded, friendly
   display face) and the karaoke captions used Inter. Two unrelated families
   in one video, neither of which reads as the upright condensed news
   lettering the user's reference channel (theanh28) uses.
2. **Text outside TikTok's safe zone.** The hook headline sat at y1262 with
   `right: 60`, and the captions at `bottom: 260` (≈y1660). Both are inside
   the band TikTok covers with its own UI during playback, so on a real phone
   the headline ran under the action-button column and the captions were
   partly hidden behind TikTok's own caption/progress chrome.

This spec fixes both, and makes every text position derive from measured
constants in one shared module instead of per-component eyeballing.

## A. Measurement method (why these numbers, not others)

Every number below was measured off a reference image rather than chosen by
eye, because "looks about right in the Remotion preview" is exactly what
produced the round-1 result.

**Safe zone** — from the user's `safe-zone.jpg` (720×1280 overlay marking
TikTok's covered regions in black and the usable region in white). Boundaries
were read programmatically (scan for the white region's edges) and scaled
1.5× to the composition's 1080×1920 frame:

| Edge | 720×1280 | **1080×1920** |
|---|---|---|
| top | 165 | **247** |
| bottom | 1086 | **1629** |
| left | 34 | **51** |
| right (above y862) | 684 | **1026** |
| right (below y862) | 591 | **886** |

The right edge tightens below y862 — that is where TikTok's like/comment/share
column begins. Any text wider than x886 in the lower half is at risk.

**Badge and headline proportions** — from a theanh28 reference frame
(`Screenshot 2026-07-20 at 10.47.31.png`). The video content was isolated
inside the screenshot (x46–978, y3–1660 → exactly 932×1657, i.e. 9:16), giving
a scale factor of 1080/932 = 1.1588 back to composition pixels. Text bands and
the badge ribbon were then located by pixel scan.

**Badge vertical position** — from the user's own approved 2026-07-18 render
(`Screenshot 2026-07-18 at 14.38.07.png`), measured the same way. The
theanh28 frame puts its badge higher, but it also carries a date chip between
badge and headline that this pipeline does not render; the user's own render
is the closer target.

## B. Typeface — Oswald 700, shared

`@remotion/google-fonts/Oswald`, weight 700, subsets `["vietnamese",
"latin"]`. The Vietnamese subset is non-negotiable: this pipeline's narration
is always Vietnamese and the headline is rendered ALL-CAPS, so every diacritic
must exist in the loaded subset.

Oswald was chosen over two alternatives the user compared side by side in a
browser mockup, all three rendered at identical measured geometry:

- **Anton** — closest match to the reference's letter width, but a single
  weight with no room to step lighter, and slightly too heavy at caption size.
- **Barlow Condensed 800** — noticeably wider than the reference; reads softer
  and less "news".
- **Oswald 700** — chosen. Tall, genuinely condensed, upright.

The same family and the same size (54px) are used for the hook headline *and*
the karaoke captions, by explicit user request — the two are meant to read as
one system.

## C. Layout constants

All of these live in `remotion/src/layout.ts` and are consumed by both
`HookCard.tsx` and `Captions.tsx`. No component defines its own position.

**Badge** (flush-left ribbon, flat left edge, rounded right end):

| Property | Round 1 | **Round 2** |
|---|---|---|
| top | 1132 | **1185** |
| height | 70 (implicit) | **90** |
| padding-left | 24 | **93** |
| padding-right | 34 | **52** |
| icon | 38, outlined | **62, solid white disc** |
| font-size | 30 | **44** |

The large left padding is the reference's defining badge trait: the logo mark
is inset far enough that it lines up with the headline's left edge (96)
instead of hugging the screen edge. The icon also changed from an outlined
circle to a solid white disc carrying the brand's darkest gradient stop as the
mark — the outline read as an afterthought at this size.

**Headline:**

| Property | Round 1 | **Round 2** |
|---|---|---|
| left | 48 | **96** |
| right inset | 60 (→ x1020, unsafe) | **194** (→ x886 = safe right) |
| font-size | 74 | **54** |
| line-height | 1.36 | **1.34** |
| anchor | `top: 1262` | **`bottom: 343`** (bottom edge y1577) |

**Anchoring by the bottom is the load-bearing decision here.** A headline is
user-supplied narration text of unpredictable length. A top-anchored block
grows *downward* into the covered band the moment it needs a fourth line —
which is precisely how round 1 broke. Bottom-anchoring makes it grow upward
instead, so the block is safe at any length while still landing exactly where
the reference puts it (top 1360, bottom 1577) for the typical 3-line headline.

**Captions:**

| Property | Round 1 | **Round 2** |
|---|---|---|
| font | Inter 800 / 64px | **Oswald 700 / 54px** |
| bottom | 260 (≈y1660, unsafe) | **350** (bottom edge y1570) |
| left / right inset | 5% / 5% | **60 / 194** |
| wrap | forced 1 line | **up to 2 lines** |
| case | as-written | **uppercase** |

## D. Long-headline safety net

Bottom-anchoring handles overflow *downward*, but a 5-line headline would grow
*upward* into the badge (badge bottom = 1185 + 90 = 1275; a 5-line block's top
would be 1215). `fitHeadlineFontSize()` steps the font down through 54 → 48 →
44 until the estimated line count fits `maxLines: 4`.

The estimate is a character-count heuristic (`AVG_UPPERCASE_CHAR_EM = 0.45`,
deliberately on the wide side so it errs toward shrinking early) rather than a
DOM measurement. This keeps the component a pure function of its props, in
line with this project's house rule that everything rendered is deterministic
math over its inputs. The heuristic only ever engages for pathologically long
headlines; at normal lengths the layout is exactly the measured one.

## E. Caption chunking

`build-spec.mjs`'s group bounds widened from 5 words / 28 chars to **9 words /
52 chars**, because a group may now wrap onto two rendered rows.

Note the unit: a "group" is what is shown together on screen at one time;
`Captions.tsx` lays its words out with `flex-wrap`, so the *rendered* row
count follows from the box width, not from these constants. The caption box is
1080 − 60 − 194 = 826px at Oswald 700 / 54px, fitting roughly 34 uppercase
characters per row, so ~68 over two rows. 52 leaves real slack for wide words
and the 18px word gap rather than betting on that estimate.

## F. Verification (done, not planned)

`tsc --noEmit` clean is necessary but not sufficient — this component's whole
history is "render a frame, look at the pixels." Two stills were rendered from
a real spec and measured programmatically:

**Hook frame** (`--frame=60`):
- badge glyphs y1200–1259, starting at x93 (= the measured 93px inset ✓)
- headline rows y1363–1419, 1435–1491, 1522–1564
- lowest glyph **y1564** < safe bottom 1629 ✓
- rightmost glyph **x854** < safe right 886 ✓

**Caption frame** (`--frame=250`), measured by the exact karaoke gold `#FFD24C`
to avoid picking up a bright photo background:
- two rows, y1426–1484 and y1514–1563 → **wrapping to 2 lines works** ✓
- lowest glyph **y1563** < safe bottom 1629 ✓
- rightmost glyph **x846** < safe right 886 ✓
- measured line pitch **73px** vs the specified 54 × 1.34 = 72 ✓

## G. Explicit scope cuts

- **No date chip.** The theanh28 reference carries a "NGÀY ĐĂNG: dd/mm/yyyy"
  pill between badge and headline. Not requested, not built.
- **No per-brand typography.** Brands vary by color and badge text only (see
  the 2026-07-18 multi-brand spec §G). The font and every position in
  `layout.ts` are house-wide constants, not brand fields.
- **No DOM-measured text fitting.** See §D — the character heuristic is the
  deliberate choice, not a placeholder for `@remotion/layout-utils`.
- **No second caption style.** The single `Captions.tsx` look remains the
  whole spec, as in the 2026-07-17 design's scope guard.
