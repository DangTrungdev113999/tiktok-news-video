# Multi-platform plugin distribution (Claude Code + Codex/ChatGPT app)

## Goal

Make the existing tiktok-news-video plugin installable on Claude Code (CLI +
desktop app) AND Codex CLI / ChatGPT desktop app, so colleagues can install it
by pasting a few params into each app's own "Add plugin marketplace" UI, then
run the init flow which asks for their own ElevenLabs key.

## Platform scope (researched via official docs, not assumed)

Sources: code.claude.com/docs/en/desktop.md, /en/plugin-marketplaces,
/en/plugins-reference (Anthropic, official); learn.chatgpt.com/docs/build-plugins,
/docs/build-skills (OpenAI, official); support.claude.com articles on org
plugin management (Anthropic, official).

| Platform | Plugin manifest | Local shell/filesystem access? | In scope? |
|---|---|---|---|
| Claude Code CLI | `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` | Yes, always (terminal process) | Yes — already built, unchanged |
| Claude Code Desktop (the **Code tab** of the unified Claude Desktop app) | Same manifest as CLI — confirmed official: "Desktop and CLI read the same configuration files... Settings in `~/.claude.json` and `~/.claude/settings.json` are shared", marketplace state lives once per user in `~/.claude/plugins/known_marketplaces.json`. Installed via in-session "+ → Plugins → Add plugin" GUI, not Settings. | **Conditional** — starting a session requires choosing an Environment: **Local**, Remote, SSH, or WSL. Only **Local** has real disk/ffmpeg access; **Remote** runs on Anthropic-managed cloud infrastructure. | Yes, with a documented caveat — same shape as the ChatGPT-app caveat below |
| Codex CLI | `.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json` | Yes (local terminal agent) | Yes — added this round |
| ChatGPT desktop app (Plugins tab, i.e. Codex embedded in the ChatGPT app) | Same as Codex CLI — confirmed same manifest format, same "Add plugin marketplace" dialog (Source / Git ref / Sparse paths); skill invocation docs are inconsistent about `$name` vs `@name` for this surface specifically, so SETUP.md tells users to try both. | **Conditional** — the app supports both local and cloud/remote tasks; only local has real ffmpeg/filesystem access. | Yes, with a documented caveat |
| Claude (consumer chat/Cowork tabs) — reached via the SAME Desktop app's **Settings → Customize → Plugins** panel, confirmed via a live screenshot of that exact dialog ("Add from a repository: Sync a plugin marketplace from a GitHub repository or git URL" — no local-path option shown) | Separate, org/consumer-scoped marketplace system (support.claude.com: "install and use plugins in chat on the web, the Chat tab in Claude Desktop, and Claude Cowork") | No — chat/Cowork sandbox, no Bash/ffmpeg/filesystem access | **Out of scope** — installable there, but the init skill would have no shell to run `scripts/init.mjs` at all. Users must be told explicitly not to use this panel for this plugin — it looks identical to the right one but is a different registry entirely. |

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

`SETUP.md` explicitly warns that **both** Claude Code Desktop and the
ChatGPT desktop app require choosing a **Local** session/environment, not
Remote/cloud, before running the init skill — otherwise the plugin installs
and appears fine, then fails opaquely (no ffmpeg, no access to the user's
asset files) because the session has no local shell. It also explicitly
tells users which of Claude Desktop's two distinct Plugins UIs to use
(in-session "+ → Plugins" for the Code tab) and which to avoid (Settings →
Customize → Plugins, which is the Chat/Cowork-scoped, sandboxed one).

`scripts/init.mjs` now also prints this same Local-vs-Remote warning up
front and in the ffmpeg-missing failure message, since that's the most
likely place someone would hit the cloud-sandbox case and be confused about
why a supposedly working ffmpeg install still fails.

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
