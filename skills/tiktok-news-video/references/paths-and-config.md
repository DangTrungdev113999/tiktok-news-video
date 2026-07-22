# Paths — CODE vs WORKSPACE

Read carefully: this is not one folder.

This plugin's **code** and the user's **data** live in two different places on
purpose, and mixing them up silently loses the user's config/assets/output on
the next plugin update (see `scripts/workspace.mjs` for the full reason).
Never hardcode `~/Desktop/tiktok-news-video` — that's only true for the plugin
author's own dev copy, not for an installed plugin (which runs from a
version-pinned cache directory).

```
CODE_ROOT   = the directory two levels above the SKILL.md file
              (skills/tiktok-news-video/SKILL.md -> up 2 = plugin root).
              Resolve this from the actual file path the skill loaded from
              -- do not assume it equals any fixed path.
              Contains: scripts/, knowledge/, remotion/ (the engine/code —
              read-only from this skill's perspective).

CONFIG_FILE = <home>/.tiktok-news-video/config.local.json
              where <home> is whatever `os.homedir()` returns — NOT the
              literal string "~". Write `~` into a shell command and cmd
              passes it through unexpanded, so the existence test fails, the
              run concludes "first time on this machine", and it re-triggers
              init on a machine that was already set up. Resolve the real
              path in Node (`path.join(os.homedir(), '.tiktok-news-video')`)
              or use %USERPROFILE% on Windows / $HOME on macOS.
              Fixed home-directory path, independent of CODE_ROOT and stable
              across every plugin update. Read this file's `workspaceDir`
              field to get WORKSPACE_DIR below. Also holds
              `narrationPace` (see narration-pace.md), `bgmLibrary[]` and
              `ffmpegDir`.

              It may also still hold a legacy `voiceId`. Do NOT read it: the
              voice is chosen per video from `<WORKSPACE_DIR>/voices.json`
              (see narration-and-bgm.md, Step 2b). Init no longer writes the
              key, and voice-library.mjs migrates any surviving one into
              voices.json on first use.

              `ffmpegDir` is set only when init had to fetch ffmpeg itself
              (Windows, nothing on PATH) — it points at `<CONFIG_DIR>/bin`.
              Never spawn a bare `ffmpeg`/`ffprobe`: go through
              `scripts/ffmpeg-path.mjs`'s `binaryPath()`, which prefers this
              directory over PATH. A vendored copy is used precisely because
              PATH is read once at process start, so a just-installed ffmpeg
              is invisible to the session that installed it.
              The ElevenLabs API key lives alongside it in
              `<home>/.tiktok-news-video/.env` (ELEVENLABS_API_KEY=...).

              `narrationPace` is a saved default, not a per-run answer --
              do not ask about it each time. Override it for a single video
              via synthesizeScript's `paceLabel`, which never writes back to
              this file. The VOICE is the opposite: ask every TTS run.

WORKSPACE_DIR = config.local.json's `workspaceDir` field. Default:
              `<home>/tiktok-news-video-workspace` on Windows,
              `<home>/Desktop/tiktok-news-video-workspace` on macOS.

              The Windows default is deliberately NOT on the Desktop: OneDrive
              Known Folder Move relocates Desktop into the sync root on most
              corporate machines, which would upload every asset and every MP4
              and can hold a handle on a file Remotion is still writing.
              `%USERPROFILE%` itself is never a redirected known folder.
              Nobody has to navigate here: assets arrive via clean-source, and
              render.mjs reveals the finished MP4 in Explorer/Finder.
              Contains:
                $WORKSPACE_DIR/assets/         user's reusable image/video library
                $WORKSPACE_DIR/bgm-library/    saved BGM tracks
                $WORKSPACE_DIR/brand/          one subfolder per brand kit
                $WORKSPACE_DIR/output/         rendered videos, <dated-slug>/ per run
```

## Passing workspaceDir around

Every script that touches assets/bgm-library/output/config takes
`workspaceDir` as an explicit argument (never infers it from its own
location) — see each script's own usage comment.

`scripts/render.mjs` needs BOTH: it resolves the Remotion engine from its own
CODE_ROOT but writes `--public-dir=<workspaceDir>` so `staticFile()` calls
resolve against the user's data, not the plugin's code.

## First run on a machine

If `<home>/.tiktok-news-video/config.local.json` doesn't exist yet, this is the
first run — hand off to the `tiktok-news-video-init` skill before anything
else. Do not attempt to render without it.

## Where the house rules live

`$CODE_ROOT/knowledge/` holds the content/style laws that outlive any single
run — read the relevant one before the step that uses it:

| File | Read before |
|---|---|
| `knowledge/elevenlabs-v3-tts.md` | Step 2 (narration) |
| `knowledge/effect-catalog.md` | Step 4 (motion classification) |

`skills/tiktok-news-video/references/` (this folder) holds the *operational*
detail for each pipeline step. `knowledge/` is the law; `references/` is the
procedure.
