---
name: init
user-invocable: true
description: "One-time machine setup for the tiktok-news-video plugin: verifies/installs Node+ffmpeg+Remotion deps per OS, then prompts for output folder, ElevenLabs API key, and voice_id. Run this before the first /make-video on a new machine."
argument-hint: ""
---

# Init — one-time environment setup

Run `npm run init` (equivalently `node scripts/init.mjs`) from the plugin
repo root. The script itself does the real work: OS detection, dependency
checks/installs for ffmpeg + Remotion's headless Chrome, a pass/fail
verification checklist, then prompts for the output folder / ElevenLabs key /
voice_id and writes `config.local.json` + `.env`.

Your job here is just to:
1. Invoke it (via Bash) and stream its output to the user as it runs — it's
   interactive (prompts), so don't background it.
2. If it reports any ❌ items, explain in plain language what that means for
   the user (e.g. "ffmpeg chưa cài được tự động — bạn cần cài thủ công theo
   hướng dẫn ở trên trước khi làm video" or "chưa có API key ElevenLabs — vẫn
   dùng được plugin nếu bạn luôn tự cung cấp file mp3 lồng tiếng").
3. Once it completes (even with some optional ❌ items, as long as Node +
   ffmpeg + Remotion pass), tell the user they're ready to run `/make-video`.

Do not reimplement any of this logic yourself — `scripts/init.mjs` is the
source of truth (see the design spec's Section E for why each check exists).
