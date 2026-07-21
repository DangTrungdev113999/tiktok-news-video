#!/usr/bin/env node
// scripts/workspace.mjs
//
// Splits "plugin code" from "user data" so a plugin update never destroys a
// user's ElevenLabs key, workspace choice, saved BGM, or output videos.
//
// When this plugin runs as an INSTALLED plugin (Claude Code marketplace,
// Codex, ChatGPT app), the running script's own directory
// (path.resolve(__dirname, "..")) is a version-pinned cache directory --
// e.g. ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/. Every new
// version gets a fresh directory, so anything written next to the code
// (config.local.json, .env, assets/, output/) is silently orphaned on the
// very next update. Verified empirically: running scripts/init.mjs from
// inside that cache dir writes config.local.json there, and a version bump
// creates an entirely new, empty directory next to it.
//
// Fix: config lives in a fixed, home-directory-based location that has
// nothing to do with where the code happens to be installed -- so it's the
// same path no matter which plugin version is currently running, and the
// same path across Claude Code, Codex, and the ChatGPT app. The user's
// actual assets/BGM/output live in a normal, visible folder the user picked
// during init (default: ~/Desktop/tiktok-news-video-workspace), whose path
// is the one thing recorded in that fixed config location.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_DIR = path.join(os.homedir(), '.tiktok-news-video');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.local.json');
export const ENV_PATH = path.join(CONFIG_DIR, '.env');
/**
 * Suggested workspace folder.
 *
 * On WINDOWS this deliberately does NOT go on the Desktop.
 *
 * "Desktop" on Windows is not a fixed path. OneDrive's Known Folder Move is
 * on by default on many Microsoft 365 / Windows 11 corporate machines and
 * relocates it to `%OneDrive%\Desktop`; Group Policy folder redirection can
 * point it at a network share; and `%USERPROFILE%\Desktop` may survive as a
 * stale leftover in both cases. An earlier version of this function chased
 * the moving target by preferring `%OneDrive%\Desktop` -- which resolved the
 * path correctly and thereby made the real problem worse:
 *
 * A workspace on a KFM desktop is a workspace INSIDE OneDrive sync. This
 * folder holds every source photo, every intermediate, and every rendered
 * MP4. Syncing it means uploading hundreds of MB per episode, and -- the part
 * that actually breaks things -- OneDrive can hold a handle on a file that
 * Remotion is still writing, which surfaces as an unexplained EPERM
 * mid-render.
 *
 * `%USERPROFILE%` itself is never a redirected known folder, so a sibling of
 * Desktop is both stable and unsynced. The employee never has to navigate
 * here anyway: assets arrive via clean-source, and the finished video is
 * revealed in Explorer at the end of a render.
 *
 * macOS keeps the Desktop default -- iCloud Desktop sync is opt-in there, and
 * this is where the author's existing workspace already lives.
 */
function defaultWorkspaceDir() {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'tiktok-news-video-workspace');
  }
  return path.join(os.homedir(), 'Desktop', 'tiktok-news-video-workspace');
}

export const DEFAULT_WORKSPACE_DIR = defaultWorkspaceDir();

/** Read config.local.json from the fixed CONFIG_DIR. Returns {} if missing/invalid. */
export function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Resolve the user's workspace folder (holds assets/, bgm-library/, output/).
 * Throws with an actionable message if init.mjs hasn't set one yet, since
 * every caller needs a real answer, not a silent fallback that could point
 * at the wrong place.
 */
export function getWorkspaceDir() {
  const config = readConfig();
  if (!config.workspaceDir) {
    throw new Error(
      'No workspace folder configured yet. Run the init skill first (it writes workspaceDir to ' +
        `${CONFIG_PATH}).`
    );
  }
  return config.workspaceDir;
}

export function ensureWorkspaceSubdirs(workspaceDir) {
  for (const sub of ['assets', 'bgm-library', 'brand', 'output']) {
    fs.mkdirSync(path.join(workspaceDir, sub), { recursive: true });
  }
}
