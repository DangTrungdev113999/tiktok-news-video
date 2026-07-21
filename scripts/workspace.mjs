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
 * Fallback workspace folder, offered when the user just presses Enter at init.
 *
 * Init ASKS for this folder (the employee drags a prepared template folder
 * into the chat box), so this is only a fallback -- not a location anything
 * is expected to guess correctly.
 *
 * The home directory, deliberately: it always exists and it is never one of
 * Windows' redirectable known folders. An earlier version tried to locate the
 * real Desktop across OneDrive Known Folder Move and Group Policy
 * redirection. That was solving a problem nobody had -- the folder is handed
 * in, not discovered.
 */
export const DEFAULT_WORKSPACE_DIR = path.join(os.homedir(), 'tiktok-news-video-workspace');

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
