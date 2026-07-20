# Steps 1–3 — Scene script: parse, rewrite, review

## Step 1 — Parse the chat input

`$ARGUMENTS` (or whatever the user pasted in chat) contains blocks like:

```
Scene 1: [nội dung] — ảnh: hop-bao.jpg
Scene 2: [nội dung] — video: phong-van.mp4
```

Parse into `scenes[] = [{ index, text, assetFilename }]`.

For each `assetFilename`, verify the file exists under
`$WORKSPACE_DIR/assets/` — if ANY are missing, stop here and list the missing
filenames. This is the one validation that must block before doing any paid
API work.

If the user separately mentions a video file wasn't embeddable in the doc but
names it in the script, treat that name exactly like any other
`assetFilename` — it must already be in `$WORKSPACE_DIR/assets/`.

Also ask (once, if not already clear from the message): does the user have a
ready MP3 narration file, or should TTS generate it?

### Per-asset tags

A filename may be followed by `|`-separated **tags** that override the
automatic aspect-ratio classification for that one asset, and by a `(30%)`
duration share. When no tag is present the asset falls back to automatic
classification — an absent tag is never an error.

```
anh_1.jpg (30%) | focus_object: nguoi thu 1 luc "su bin hoang son"
anh_2.jpg
```

Read `tags/README.md` for the grammar and the table of implemented keys, then
open the reference file for each key you actually meet. A key that is not in
that table is **reported to the user, not guessed at**.

## Step 2 — Script rewrite (house style)

Apply `$CODE_ROOT/knowledge/script-rewrite-house-style.md` to every scene's
`text`. Produce, per scene: original, rewritten, and the one-line reasoning
for the framing chosen.

This is content work — think about each scene, don't mechanically paraphrase.

## Step 3 — Review (USER PAUSE #1)

Show the rewrite in chat per the house-style doc's format (text only, no
visual UI). Ask:

> "Giữ bản xào lại này, hay bạn muốn sửa scene nào?"

If the user pastes replacement text for specific scenes, use it verbatim for
those scenes (do not rewrite on top of a user edit) and keep your rewrite for
the rest. Lock in final `scenes[].finalText` before continuing.

Do not build a visual Artifact/blur-reveal UI for script review — text in chat
only.
