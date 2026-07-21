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
 * On Windows, `homedir()/Desktop` is frequently NOT the desktop the user sees.
 * OneDrive's Known Folder Move is on by default on many Microsoft 365 and
 * Windows 11 corporate machines, which relocates the real Desktop to
 * `%OneDrive%\Desktop`. Defaulting past that would silently create a second,
 * invisible folder and then tell an employee to put their photos "on the
 * Desktop" -- into a folder that does not appear on their desktop.
 *
 * So prefer OneDrive's Desktop when the environment says one exists AND it is
 * really there. This is only the default offered at init; the user can type
 * any path, and whatever they pick is echoed back as an absolute path.
 */
function desktopDir() {
  if (process.platform === 'win32') {
    const oneDrive = process.env.OneDrive || process.env.OneDriveCommercial || process.env.OneDriveConsumer;
    if (oneDrive) {
      const candidate = path.join(oneDrive, 'Desktop');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return path.join(os.homedir(), 'Desktop');
}

export const DEFAULT_WORKSPACE_DIR = path.join(desktopDir(), 'tiktok-news-video-workspace');

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
