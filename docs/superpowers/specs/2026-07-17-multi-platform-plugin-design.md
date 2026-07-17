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

## Addendum (same day): dev workflow, data persistence, and verified update SOP

A follow-up round of work, triggered by the plugin author asking to develop
against the live Desktop folder while keeping staff installs in sync. Full
operational detail lives in `MAINTAINER.md` (dev-only) and the "Khi có bản
cập nhật mới" section of `SETUP.md` (staff-facing); this section records the
design rationale and what was actually verified, not assumed.

### Critical bug found and fixed: code vs. data separation

An advisor review (before any implementation) flagged that every script
resolved `config.local.json`/`.env`/`assets/`/`bgm-library/`/`output/`
relative to `REPO_ROOT` (`path.resolve(__dirname, "..")`). For an installed
plugin, that directory is a version-pinned cache path
(`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`) that Claude
Code replaces wholesale on every update. Reproduced live: ran `init.mjs` from
inside the actual cache directory, watched `config.local.json` land there,
then confirmed a copy of the code in an unrelated directory couldn't see it.
Combined with enabling frequent updates (below), this would have silently
wiped every staff member's ElevenLabs key and workspace config on their
first update.

Fix (`scripts/workspace.mjs`): `CONFIG_DIR` = `~/.tiktok-news-video`
(home-directory-based, identical regardless of which plugin version is
running or which platform invoked it) holds `config.local.json`/`.env`.
`WORKSPACE_DIR` = a normal, visible folder chosen once during init (default
`~/Desktop/tiktok-news-video-workspace`), recorded as a field inside that
config, holds `assets/`, `bgm-library/`, `output/`. Plugin code
(`scripts/`, `knowledge/`, `remotion/`) keeps resolving relative to wherever
it's actually installed — that's supposed to change on update, only the data
needed to stop doing that. Verified the fix directly: copied `scripts/` to
`/tmp/fake-plugin-cache-v2` (simulating a fresh version directory) and
confirmed it read the same persisted config instead of starting blank.

### Verified (not assumed): how staff actually receive updates

Removed `.claude-plugin/plugin.json`'s pinned `"version": "0.1.0"` — Claude
Code's docs state an explicit version means new commits are never detected
as updates. Omitting it should fall back to git-commit-SHA versioning.

Tested the real update path end to end on the dev machine: pushed a trivial
commit, then ran `claude plugin marketplace update` +
`claude plugin update tiktok-news-video@tiktok-news-video-marketplace`.
Confirmed via `git log` in the local marketplace clone that the commit *was*
pulled — but `installed_plugins.json`'s `gitCommitSha` did not advance and
the CLI reported "already at the latest version" twice in a row. An
uninstall + fresh install, by contrast, picked up the new commit correctly
every time. Conclusion: `/plugin update` is not reliable for this
relative-path-in-git-marketplace source shape (at least in the tested
Claude Code version); the verified, reliable staff SOP is
uninstall-then-reinstall, which is safe now that user data lives outside the
plugin's cache entirely.

For Codex, tested `codex plugin marketplace upgrade` followed by re-running
`codex plugin add` (no uninstall needed) — this correctly refreshed the
cached plugin content to the new commit. Codex's `plugin.json` requires an
explicit `version` field (no commit-SHA fallback documented), so
`.codex-plugin/plugin.json`'s version must still be bumped manually on every
release intended for Codex/ChatGPT-app users; `MAINTAINER.md` carries this
as a release-checklist item.

### Local dev loop: skills-directory plugins

Claude Code loads any folder under `~/.claude/skills/` (or a project's
`.claude/skills/`) containing `.claude-plugin/plugin.json` as a plugin named
`<name>@skills-dir` — discovered in place, no marketplace, no cache copy.
Symlinked `~/.claude/skills/tiktok-news-video -> ~/Desktop/tiktok-news-video`
for this. Confirmed one real constraint: a skills-dir plugin and a
marketplace-installed plugin sharing the same `name` collide, and merely
*disabling* the marketplace copy isn't enough — it still "holds" the name.
The marketplace-installed copy was fully uninstalled on the dev machine so
the live skills-dir copy could load; `MAINTAINER.md` documents temporarily
swapping back to a real marketplace install when the author needs to verify
the exact experience a staff member would get.

### Not verified this round

Driving the actual ChatGPT desktop app UI (install flow, `$`/`@` skill
invocation, its own "check for updates" button) — everything Codex-side was
verified through the `codex` CLI, which shares the plugin format but not
necessarily every UI affordance. Flagged explicitly in `MAINTAINER.md` as
the plugin author's own follow-up.
