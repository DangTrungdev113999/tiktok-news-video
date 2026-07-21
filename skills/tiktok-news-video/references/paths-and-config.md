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
              field to get WORKSPACE_DIR below. Also holds `voiceId`,
              `narrationPace` (see narration-pace.md) and `bgmLibrary[]`.
              The ElevenLabs API key lives alongside it in
              `<home>/.tiktok-news-video/.env` (ELEVENLABS_API_KEY=...).

              `voiceId` and `narrationPace` are saved defaults, not per-run
              answers -- do not ask about them each time. Override either for
              a single video via synthesizeScript's `voiceId` / `paceLabel`
              options, which never write back to this file.

WORKSPACE_DIR = config.local.json's `workspaceDir` field — a normal, visible
              folder the user chose during init (default suggestion:
              ~/Desktop/tiktok-news-video-workspace). Contains:
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
