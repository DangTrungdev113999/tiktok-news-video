---
description: "TikTok News Video — generate a finished TikTok-format news video from images/videos + a scene script pasted in chat. Auto ken-burns/zoom/passthrough effects, blur-pad backgrounds, ElevenLabs TTS or your own MP3, BGM mixing. Runs end-to-end to a rendered MP4."
argument-hint: "[paste the scene script here, or leave empty and I'll ask]"
---

# TikTok News Video: $ARGUMENTS

You are the entry point. This command just collects input and hands off to the
orchestrator skill — do NOT parse scenes or render anything
yourself here.

## Step 0: First run on this machine?

If `config.local.json` does not exist at the plugin root, tell the user this is
the first run and invoke the Skill `tiktok-news-video:tiktok-news-video-init` first. Do not
proceed to video generation until init reports all checks passing.

## Step 1: Get the scene script

`$ARGUMENTS` is the scene script, e.g.:

```
Scene 1: [nội dung] — ảnh: hop-bao.jpg
Scene 2: [nội dung] — video: phong-van.mp4
```

- If `$ARGUMENTS` is empty, ask the user to paste the scene script directly in
  chat, referencing assets by filename already placed in `assets/`.
- If the user has a ready MP3 narration, ask for its path now; otherwise the
  pipeline will use ElevenLabs TTS.

## Step 2: Hand off to the pipeline skill

Invoke the Skill `tiktok-news-video:tiktok-news-video` with the parsed scene
script (and MP3 path if given). That skill owns the entire flow — see its
SKILL.md.
