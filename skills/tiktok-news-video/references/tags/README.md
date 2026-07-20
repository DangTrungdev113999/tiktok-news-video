# Tags — the per-asset override vocabulary

A scene line may carry zero or more **tags** after the filename. Tags are how
a non-technical author says something the pipeline cannot infer on its own.

```
anh_1.jpg | focus_object: nguoi thu 1 luc "su bin hoang son"
anh_2.jpg | fill_full_screen
anh_3.jpg
```

The third line is the normal case. **Absent tag = automatic.** No tag is ever
required, and an author who types only filenames must always get a working
video.

## Grammar

| Rule | Detail |
|---|---|
| Separator | ` \| ` between the filename and each tag, and between tags |
| Key form | ASCII snake_case ID — no Vietnamese diacritics, no spaces |
| Key/value | `key: value`. The value's shape is that key's own business |
| Bare flags | A few tags have no value and are written as the key alone (`fill_full_screen`) |
| Duration share | `(30%)` directly after the filename — not a tag; see below |
| Unknown key | **Report it to the user and continue** — never silently drop it, never guess |

Values are free-form for keys that say so. `focus_object` takes natural
Vietnamese; most other keys take a fixed enum.

## One screen, several assets

A screen may hold several images, several videos, or a mix — one per line:

```
Screen 3:
anh_1.jpg (30%) | focus_object: người thứ 1 từ trái sang
anh_2.jpg (70%) | focus_object: nhân vật đeo mặt nạ
video_1.mp4
```

`(30%)` is **that asset's share of the screen's duration**. The screen's total
length is still set by the narration for that screen; `%` only decides how it
is divided.

| Case | Result |
|---|---|
| No `%` anywhere | split evenly |
| `%` on every asset | use them; if they don't total 100, normalise and say so |
| `%` on some only | the tagged ones take their share, the rest split what's left |
| `%` totalling over 100 | normalise down, report it |

Captions are unaffected — they are global and track the speech, not the
assets.

## Registered keys

| Key | Value | Reference |
|---|---|---|
| `focus_object` | free-form Vietnamese description of what to focus on | `focus-object.md` |

When you meet a key in this table, **open its reference file before acting**.
The table is the whole contract — a key not listed here is not implemented.

**Agreed but not yet written:** `fill_full_screen` (bare flag, forces
edge-to-edge crop once blur-pad becomes the default fit). Treat it as unknown
until it has a row above.

## Adding a key

Per the project's standing rule, keys ship one at a time:

1. Write the key's reference file in this directory.
2. Add the row to the table above.
3. Only then touch the parser, `spec-types.ts`, `build-spec.mjs`, `Scene.tsx`.

Two invariants every key must hold:

- **Absent = automatic.** A tag adds intent; it never becomes a prerequisite.
- **Overrides feed `classifyAsset`, not `Scene.tsx`.** A tag changes which
  parameters the one parametric scene component receives. It never adds a
  bespoke rendering path.
