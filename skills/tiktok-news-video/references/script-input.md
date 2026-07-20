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

For each filename, verify the file exists under `$WORKSPACE_DIR/assets/` — if
ANY are missing, stop here and list the missing filenames. This is the one
validation that must block before doing any paid API work.

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
open the reference file for each key you actually meet. A key that is not in
that table is **reported to the user, not guessed at**.
