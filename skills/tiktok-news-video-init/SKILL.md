---
name: tiktok-news-video-init
user-invocable: true
description: "One-time machine setup for the tiktok-news-video plugin: verifies/installs Node+ffmpeg+Remotion deps per OS, then prompts for output folder, ElevenLabs API key, voice_id, and narration pace. Run this before the first /tiktok-news-video on a new machine."
argument-hint: ""
---

# Init — one-time environment setup

Run `npm run init` (equivalently `node scripts/init.mjs`) from the plugin
repo root. The script itself does the real work: OS detection, dependency
checks/installs for ffmpeg + Remotion's headless Chrome, a pass/fail
verification checklist, then prompts for the output folder, ElevenLabs API key,
voice_id, and narration pace, and writes `config.local.json` + `.env`.

## It asks for exactly ONE thing: the ElevenLabs API key

Everything else has a default the author picked by measuring, so asking would
only make a non-technical user guess at a decision whose right answer is always
"Enter": the workspace folder (`~/Desktop/tiktok-news-video-workspace`), the
voice (`pGapy9MNHCukzJtjavF0` — Hạnh, chosen after auditioning 14 Vietnamese
voices on one script), and the pace (`4x` = atempo 1.40).

Re-running init on an already-configured machine asks **nothing at all** — it
prints what's saved and exits. That is the common case, because every plugin
update lands a fresh copy with no `node_modules` and init has to run again.

The key is the one value no default can supply: it's per-person, secret, and
billed per character. Never share one key between employees.

**To change the defaults**, run `npm run init -- --nang-cao` (or `--advanced`).
That restores the full four-question flow. In that mode Enter *keeps* the saved
key and voice rather than clearing them.

For a single video, don't re-run init at all — `synthesizeScript` takes
`voiceId` / `paceLabel` overrides that never touch the saved config.

The pace levels are `none / 2x / 3x / 4x / 5x`, and the labels are notch names,
not multipliers — `5x` is 1.5×. `references/narration-pace.md` in the main
skill has the measurements and explains why the stretch exists at all
(`eleven_v3` ignores `voice_settings.speed` outright).

## Step 0: there is no Node.js on the employee's machine

Assume there isn't. These are non-technical users on fresh Windows laptops,
and `init.mjs` is itself a Node script — so this is the one thing that has to
be handled before the plugin can run at all. **You install it. Do not ask the
employee to.**

Run `node -v` first. If it prints a version ≥ 18, skip this whole section.

If it doesn't, install and then **call Node by absolute path**:

```
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
```

Then use `C:\Program Files\nodejs\node.exe` for everything — `node` on its own
will still fail. That is not a quirk of this plugin: **Windows reads PATH once,
when a process starts**, so the PATH entry winget just created does not exist
for your next Bash call. Retrying `node -v` and concluding the install failed
is the trap here; the file is on disk, only the name lookup is stale. (The same
fact is why init vendors its own ffmpeg — see `scripts/ffmpeg-path.mjs`.)

So:

```
"C:\Program Files\nodejs\node.exe" scripts/init.mjs
```

`init.mjs` resolves `npm`/`npx` next to whichever node is running it, so the
absolute path propagates through the Remotion install by itself.

If `winget` is missing too (older Windows 10, or blocked by policy), stop and
say this — installing Node is a normal double-click, not coder work:

> Máy bạn chưa có Node.js — phần mềm nền mà plugin cần. Bạn làm 3 bước này,
> một lần duy nhất:
> 1. Vào https://nodejs.org, tải bản **LTS**
> 2. Cài bằng cách bấm Next đến hết
> 3. **Đóng hẳn app này rồi mở lại**, sau đó gõ lại lệnh init

Step 3 is what makes the new Node visible; without the restart the next attempt
fails identically and the employee concludes the plugin is broken.

## Running it

Your job here is just to:
1. Invoke it (via Bash) and stream its output to the user as it runs — it's
   interactive (prompts), so don't background it.
2. If it reports any ❌ items, explain in plain language what that means for
   the user (e.g. "ffmpeg chưa cài được tự động — bạn cần cài thủ công theo
   hướng dẫn ở trên trước khi làm video" or "chưa có API key ElevenLabs — vẫn
   dùng được plugin nếu bạn luôn tự cung cấp file mp3 lồng tiếng").
   Don't add questions of your own on top — the whole point of the one-question
   flow is that a non-technical employee finishes setup without making choices.
3. Once it completes (even with some optional ❌ items, as long as Node +
   ffmpeg + Remotion pass), tell the user they're ready to run `/tiktok-news-video`.

Do not reimplement any of this logic yourself — `scripts/init.mjs` is the
source of truth (see the design spec's Section E for why each check exists).
