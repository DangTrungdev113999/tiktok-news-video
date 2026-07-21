# Asset naming — the contract between `clean-source` and the script

Two halves of one agreement:

- **`clean-source` emits** a folder of predictably-named files.
- **The pipeline resolves** what the author types back to those files.

Neither half may drift without the other. This file is the shared definition;
`scripts/clean-source.mjs` and `scripts/resolve-asset.mjs` are its executable
halves.

## Where the folder comes from, and where it goes

The employee prepares a folder of source material **anywhere** — Desktop,
Downloads, a USB stick — and hands `clean-source` that path (dragging the
folder into the chat box produces it). `clean-source` then **copies** the
folder into `$WORKSPACE_DIR/assets/<folder>/` and renames the copy.

Both halves matter:

- **It copies into the workspace** because `buildAssetIndex` only ever reads
  `$WORKSPACE_DIR/assets`. Renaming in place — what this did before
  2026-07-21 — printed a perfect rename table and then failed at Step 1 with
  *"no file in assets/ matches anh_1"*, a message that names neither the real
  problem nor the fix. Nothing should ask the employee to remember a location.
- **It copies rather than moves** because renaming someone's photos is already
  hard to undo. The original folder is left byte-for-byte untouched, so a bad
  run costs nothing to redo.

The destination name is the source folder's name with characters NTFS forbids
(`< > : " / \ | ? *`) replaced by `-`; Vietnamese diacritics are kept. If that
destination already exists the run **stops** — merging two sets into one folder
would renumber the pictures and silently re-point every `_des` marker.

`--in-place` skips the copy (for a folder already under `assets/`, and for
tests).

## The emitted names

Inside one folder (`$WORKSPACE_DIR/assets/<folder>/`):

| Kind | Name | Notes |
|---|---|---|
| image | `anh_1.jpg`, `anh_2.png`, `anh_3.jpeg` | **original extension preserved** |
| video | `video_1.mp4`, `video_2.mov` | own counter, starting at 1 |
| marker copy | `anh_1_des.jpg` | byte-identical clone of `anh_1.jpg` |

Three rules that are load-bearing:

- **Images and videos count independently.** A folder holding image, video,
  image becomes `anh_1`, `video_1`, `anh_2`. The author thinks "the second
  photo", not "the third file".
- **Extensions are never normalised.** Renaming `.png` to `.jpg` would be a
  lie about the file's contents — and it is exactly why the author is allowed
  to omit the extension when writing the script (below).
- **Order is the folder's alphabetical order, numerically aware**, so `img2`
  sorts before `img10`. The employee controls the ordering by how they name
  the sources; `clean-source` never reorders or picks for them.

### The `_des` clones

Every image gets one, no questions asked. `anh_2_des.jpg` starts as an exact
copy of `anh_2.jpg`; the employee opens it and draws `1`, `2`, `3` (or `a`,
`b`, `c`) on the parts they want to talk about, then writes

```
anh_2.jpg | zoom_in: 50%, target 1 trong anh_2_des.jpg
```

Creating them up front rather than on request is deliberate: the employee
finds out they need a marker *while writing the script*, and at that point
going back to re-run a tool is friction that ends with them counting people
from the left instead.

Videos get no clone — a still marker on moving footage means nothing.

`_des` files are **never rendered**. They exist only to be looked at.

## What the author may type

The script may name an asset any of these ways, and all of them find
`assets/ban-quyen/anh_1.jpg`:

```
anh_1.jpg      anh_1      ảnh 1      Anh 1      anh-1      ANH_1
```

The resolution rule, in order:

1. **Literal first.** If what was typed exists as a path under `assets/`, that
   file wins. A pre-existing project full of `hop-bao.jpg` keeps working, and
   an author who types the full name is never second-guessed.
2. **Canonicalise, then match the stem.** Strip Vietnamese diacritics, lower
   case, collapse runs of space/hyphen/underscore to a single `_`, drop the
   extension. `ảnh 1` and `anh_1.JPG` both canonicalise to `anh_1`.
3. **Search the whole `assets/` tree**, not just its root. Each video's
   sources live in their own folder, so the script never has to repeat the
   folder name.

Two failure modes, both loud:

- **No match** — build refuses, listing what was typed. Same behaviour as a
  missing file today.
- **Several matches** — e.g. two folders each holding `anh_1.jpg`. Build
  refuses and lists the candidates; the author disambiguates by writing the
  folder (`ban-quyen/anh_1`). Guessing here would silently render the wrong
  video.

`anh_1` never matches `anh_1_des.jpg` or `anh_10.jpg`: the canonical stem is
compared whole, not as a prefix.

## Where this is applied

Resolution happens **once**, in `buildSpec`, immediately before probing —
`scene.assetFilename` is replaced by the resolved path relative to `assets/`,
so the probe and the `assetPath` written into `spec.json` cannot disagree.
`spec.json` therefore only ever holds real, complete paths; the renderer knows
nothing about any of this.

`scripts/parse-tags.mjs` has the matching relaxation on its side: the leading
filename token may be `anh 1` / `ảnh 1` — two tokens with a space — which the
"filename is the first token" rule would otherwise split. It recognises only
the shapes listed above, not arbitrary fuzzy text, so a genuine typo still
surfaces as a missing asset rather than being matched to something plausible.
