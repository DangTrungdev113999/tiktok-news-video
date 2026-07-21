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

## If the command dies with "command not found"

`npm`/`node` missing means the machine has no Node.js, and **nothing in this
plugin can run** — `init.mjs` is itself a Node script, so it cannot install its
own interpreter. This is the one prerequisite no script can cover.

When that happens: **stop, and do not try another command.** Guessing at
`winget install OpenJS.NodeJS` or a package manager is wrong twice over — a
PATH change from a fresh install does not reach the next Bash call anyway, so
even a successful install looks like another failure. Instead say, in
Vietnamese:

> Máy bạn chưa có Node.js — đây là phần mềm nền mà plugin cần để chạy, và
> plugin không tự cài nó được. Bạn làm 3 bước này, một lần duy nhất:
> 1. Vào https://nodejs.org, tải bản **LTS**
> 2. Cài bằng cách bấm Next đến hết
> 3. **Đóng hẳn app này rồi mở lại**, sau đó gõ lại lệnh init
>
> (Không chắc máy đã có chưa thì cứ cài — cài đè lên không sao cả.)

Then end the turn. The app restart in step 3 is what makes the new Node
visible; without it the next attempt fails identically and the user concludes
the plugin is broken.

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
