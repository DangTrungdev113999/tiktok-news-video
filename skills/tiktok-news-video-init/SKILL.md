---
name: tiktok-news-video-init
user-invocable: true
description: "One-time machine setup for the tiktok-news-video plugin: verifies/installs Node+ffmpeg+Remotion deps per OS, then saves the workspace folder and ElevenLabs API key you collect in chat and pass via --workspace / the ELEVENLABS_API_KEY env var. Run this before the first /tiktok-news-video on a new machine."
argument-hint: ""
---

# Init — one-time environment setup

Run `node scripts/init.mjs` from the plugin repo root. The script does the real
work: OS detection, dependency checks/installs for ffmpeg + Remotion's headless
Chrome, a pass/fail verification checklist, and writing `config.local.json` +
`.env` into `~/.tiktok-news-video/`.

## YOU collect the two answers; init reads them from flags

The employee types into the **chat box**, not into init's stdin. When you run
init through Bash there is no keyboard attached to it, so any question it asks
reaches nobody. You collect both answers and hand them over:

```
ELEVENLABS_API_KEY="<key>" node scripts/init.mjs --workspace "<đường dẫn>"
```

The two travel differently **on purpose**. A folder path is harmless; an API
key is billed per character, and a command-line argument shows up in the
machine's process list and gets copied verbatim into the logs of whatever tool
ran it. An environment variable does neither. Never pass the key as an
argument, and never echo it back into the conversation.

So the sequence is:

1. Ask the employee to **drag the folder the admin gave them into the chat**.
   The path appears as text. Pass it to `--workspace`, quoted (it will contain
   spaces, and Windows' "Copy as path" wraps it in double quotes — init strips
   those itself).
2. Ask for the **ElevenLabs API key** and put it in `ELEVENLABS_API_KEY` for
   that one command. Init verifies it against `GET /v1/user` and **stops on
   401** rather than saving a dead key.
3. Both land in `~/.tiktok-news-video/` (`config.local.json` + `.env`). You do
   not remember anything — that directory is the memory, and it survives every
   plugin update.

**Without `--workspace`, init refuses to run** instead of quietly falling back
to a default folder. That refusal is deliberate: a silent default discards the
template folder the admin handed out, prints a checkmark anyway, and — because
re-runs never ask again — nobody ever finds out.

On an already-configured machine the saved workspace is reused, so a re-run
needs no flags at all.

`ELEVENLABS_API_KEY` is optional: leave it out if the employee will always
supply their own MP3 narration. The final checklist marks it ❌ and the next
run asks again.

## Everything else is already decided

Everything else has a default the author picked by measuring, so asking would
only make a non-technical user guess at a decision whose right answer is always
the default: the workspace folder and the pace (`4x` = atempo 1.40).

**Init does not ask about the voice at all, and does not set one.** The voice
is picked per video from `<workspace>/voices.json` — see Step 1b of the main
skill's `narration-and-bgm.md`. It was a setting here once; that put the
decision furthest from the moment it matters, and forced every channel one
person runs to sound the same.

Re-running init on an already-configured machine asks **nothing at all** — it
prints what's saved and exits. That is the common case, because every plugin
update lands a fresh copy with no `node_modules` and init has to run again.

The key is the one value no default can supply: it's per-person, secret, and
billed per character. Never share one key between employees.

**To change the defaults**, run `npm run init -- --nang-cao` (or `--advanced`).
That reopens the workspace folder, the API key and the pace. In that mode Enter
*keeps* the saved key rather than clearing it.

For a single video, don't re-run init at all — `synthesizeScript` takes a
`paceLabel` override that never touches the saved config.

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

Then run init with the **absolute** path:

```
"C:\Program Files\nodejs\node.exe" scripts/init.mjs
```

Bare `node` may work too — measured on a real Windows runner, it became
visible in the very next command after winget finished. But that depends on
your Bash tool starting a fresh process each call, which is not guaranteed,
and the absolute path costs nothing and always works. **If `node` alone fails
right after a successful install, that is not a failed install** — the file is
on disk, only the name lookup is stale. Never uninstall and retry; use the
path.

(Windows reads PATH once per process. A *new* process therefore sees the new
entry; a *running* one never will. That second half is why init vendors its
own ffmpeg instead of trusting PATH — the Node process doing the install is
the same one that has to use the result. See `scripts/ffmpeg-path.mjs`.)

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
