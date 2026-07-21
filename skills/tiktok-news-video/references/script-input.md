# Step 1 — Scene script: parse the user's input

## Parse the chat input

`$ARGUMENTS` (or whatever the user pasted in chat) contains blocks like:

```
Screen 1: [nội dung] — ảnh: hop-bao.jpg
Screen 2: [nội dung] — video: phong-van.mp4
```

Parse into `screens[] = [{ index, text, assets[] }]`.

**The user's text is the narration, verbatim.** Do not rewrite, tighten,
re-order, or "improve" it. Do not add a `[NOTE: ...]` gloss. What the user
typed is what gets spoken — this is the author's voice and the pipeline's job
is to render it, not to edit it. (A house-style rewrite step existed until
2026-07-20 and was deleted on the user's instruction: *"bỏ qua phần xào lại
đã, xoá hẳn đi, tập trung vào input của user thôi"*.)

The only text you may touch is `ttsText` — the ElevenLabs audio-tag markup
built in Step 2 — and that changes delivery, never wording.

## Filenames are written loosely on purpose

The author may write `anh_1.jpg`, `anh_1`, `ảnh 1`, `Anh 1` or `anh-1` — all
five find `assets/<folder>/anh_1.jpg`, and the folder never has to be repeated.
Take what they typed through **unchanged**; `buildSpec` resolves it in one
place at Step 4. Don't try to guess the extension or the folder yourself.

Read `asset-naming.md` for the rule and for what `clean-source` produces.

**If the assets still carry their camera names** — `IMG_4821.HEIC`,
`Screenshot 2026-07-20 at 17.16.19.png`, `z6123456789_abc.jpg` — say so before
Step 1 and point the user at the `/clean-source` skill. It renames a folder to
`anh_1` / `video_2` in the order the files already sort, and makes the `_des`
marker copies that `focus_object` and `target N` depend on. Running it after
the script is written means the script's filenames no longer match anything.

For each filename, verify the file exists under `$WORKSPACE_DIR/assets/`
(`buildAssetIndex` in `scripts/resolve-asset.mjs` answers this — it applies the
same resolution the build will) — if ANY are missing, or any name matches two
files in different folders, stop here and list them. This is the one validation
that must block before doing any paid API work.

If the user separately mentions a video file wasn't embeddable in the doc but
names it in the script, treat that name exactly like any other filename — it
must already be in `$WORKSPACE_DIR/assets/`.

Also ask (once, if not already clear from the message): does the user have a
ready MP3 narration file, or should TTS generate it?

## Several assets on one screen

A screen may hold several images/videos, and a filename may carry tags:

```
Screen 3:
anh_1.jpg (30%) | focus_object: người thứ 1 từ trái sang
anh_2.jpg (70%)
video_1.mp4
```

`(30%)` is that asset's share of the screen's duration; absent means an even
split — and usually you should cut where the narration says so instead of
using `%` at all.

Some assets come with a **description image** beside them (`anh_2_des.jpg`) —
the same photo with numbered markers, so the author can say "số 1" instead of
counting people. Those files are never rendered; they exist only to be read.

Tags override the automatic aspect-ratio classification for that one asset —
an absent tag is never an error.

Read `tags/README.md` for the grammar and the table of implemented keys, then
open the reference file for each key you actually meet.

**A key that is not in that table STOPS the run**, here at Step 1, before any
paid call. Report it, say what the pipeline does implement, and ask what the
author meant. Do not guess at it, and do not carry it forward as a Step 6
warning: an unimplemented tag means the finished video is missing an effect
the author explicitly asked for, and a note at the bottom of the report is not
where they should discover that. (`hieu_ung`, `khung` and `vao` have all been
written in scripts and none of them exists yet.)

This is the same reasoning as the asset check above — everything that can
abort a run belongs before Step 2.
