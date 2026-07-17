# Multi-platform plugin distribution (Claude Code + Codex/ChatGPT app)

## Goal

Make the existing tiktok-news-video plugin installable on Claude Code (CLI +
desktop app) AND Codex CLI / ChatGPT desktop app, so colleagues can install it
by pasting a few params into each app's own "Add plugin marketplace" UI, then
run the init flow which asks for their own ElevenLabs key.

## Platform scope (researched, not assumed)

| Platform | Plugin manifest | Local shell/filesystem access? | In scope? |
|---|---|---|---|
| Claude Code (CLI + desktop app) | `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` | Yes | Yes — already built, unchanged |
| Codex CLI | `.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json` | Yes (local terminal agent) | Yes — added this round |
| ChatGPT desktop app (Plugins tab) | same as Codex — confirmed same manifest format, same "Add plugin marketplace" dialog (Source / Git ref / Sparse paths) | **Conditional** — the app supports both local tasks (full shell+filesystem on the user's machine) and cloud/remote tasks (OpenAI-managed sandbox, no access to local files). Only a **local task** works for this pipeline. | Yes, with a documented caveat |
| Claude.ai / Claude (consumer chat app, Customize menu / Cowork) | Separate, org-admin-gated marketplace (private/internal GitHub sync or ZIP upload); no local-path self-serve add | No — chat sandbox, no Bash/ffmpeg/filesystem access | **Out of scope** — cannot run this pipeline regardless of manifest format |

## Architecture: one shared skill tree, two manifest layers

No generator script, no repo split. `skills/`, `knowledge/`, `scripts/`,
`remotion/` remain the single source of truth. Two independent manifest
layers point at the same `skills/` directory:

- `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` (existing)
- `.codex-plugin/plugin.json` (`skills: "./skills/"`, `interface.displayName`
  etc. for the install-card UI) + `.agents/plugins/marketplace.json`
  (repo-scoped registry, single plugin entry with `source: {source: "local",
  path: "."}`, resolved against the cloned marketplace root — verified working
  via a real `codex plugin marketplace add` + `codex plugin add` against the
  pushed GitHub repo)

A single-plugin repo with no generator was chosen over a registry-driven
multi-plugin generator (as seen in reference multi-platform marketplaces)
because there is exactly one plugin and the two manifests rarely change —
generating them would be machinery with no payoff at this scale.

## Skill naming: `init` → `tiktok-news-video-init`

Claude Code namespaces every skill by its plugin (`tiktok-news-video:init`),
so a generic name never collides with another installed plugin. Codex does
not namespace — skills are invoked directly by directory name (`$init` /
`@init`), so a generic name risks colliding with another installed Codex
plugin's own "init" skill. Renamed the directory (and the `name:` frontmatter
field, and both `commands/*.md` references) to `tiktok-news-video-init`. The
main pipeline skill keeps its name (`tiktok-news-video`) since it was already
specific.

## Hosting

Pushed to a new public GitHub repo, `DangTrungdev113999/tiktok-news-video`
(chosen over private+collaborator-access or local-folder-path distribution,
for simplicity — no git auth setup needed for non-technical colleagues).
Verified no secrets (the user's personal ElevenLabs key used for local
testing) exist anywhere in git history or tracked files before pushing.

## Install instructions (SETUP.md)

Both platforms' copy-paste params documented in `SETUP.md`:
- Claude Code: `/plugin marketplace add DangTrungdev113999/tiktok-news-video`
  then `/plugin install tiktok-news-video@tiktok-news-video-marketplace`
- Codex CLI / ChatGPT app: Source =
  `DangTrungdev113999/tiktok-news-video`, Git ref = `main`, Sparse paths =
  blank

`SETUP.md` explicitly warns ChatGPT-app users to start a **local task**, not
a cloud task, before running the init skill — otherwise the plugin installs
and appears fine, then fails opaquely (no ffmpeg, no access to the user's
asset files) because the session has no local shell.

`scripts/init.mjs` now also prints this same warning up front and in the
ffmpeg-missing failure message, since that's the most likely place someone
would hit the cloud-sandbox case and be confused about why a supposedly
working ffmpeg install still fails.

## Validation performed (not just schema authored)

Both install paths were exercised for real against the pushed GitHub repo,
not just eyeballed:
- `claude plugin marketplace add DangTrungdev113999/tiktok-news-video` →
  `claude plugin install tiktok-news-video@tiktok-news-video-marketplace` —
  succeeded; confirmed both skills present under
  `~/.claude/plugins/cache/tiktok-news-video-marketplace/tiktok-news-video/0.1.0/skills/`.
  This also fixes the original bug from the prior session, where hand-editing
  `~/.claude/settings.json`'s `extraKnownMarketplaces`/`enabledPlugins` alone
  did not register the plugin — the actual registration authority is
  `~/.claude/plugins/known_marketplaces.json`, written only by the documented
  `/plugin marketplace add` flow (or its non-interactive `claude plugin
  marketplace add` equivalent), never by hand-editing settings.json.
- `codex plugin marketplace add DangTrungdev113999/tiktok-news-video --ref
  main` → `codex plugin add tiktok-news-video@tiktok-news-video-marketplace`
  — succeeded; confirmed via `codex plugin list --json` showing `"installed":
  true, "enabled": true"` and the full skill tree present under
  `~/.codex/plugins/cache/tiktok-news-video-marketplace/tiktok-news-video/0.1.0/`.

Not validated in this round (deferred to the user, per their own request):
actually running `$tiktok-news-video-init` inside the ChatGPT desktop app
end-to-end, since that requires driving that specific app's UI, which the
user wants to try themselves first.

## Out of scope (explicit)

- Claude.ai consumer chat app (Customize menu, Cowork) — architecturally
  cannot run this pipeline (no local shell/filesystem), regardless of
  manifest format. Not attempted.
- A manifest generator/registry script — YAGNI at one-plugin scale; revisit
  only if this repo grows into a multi-plugin marketplace.
