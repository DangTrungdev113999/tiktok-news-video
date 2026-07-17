#!/usr/bin/env node
// scripts/bgm-library.mjs
//
// Section E of the design spec (docs/superpowers/specs/
// 2026-07-17-tiktok-news-video-design.md): a small saved-BGM library. The
// orchestration skill asks "Bạn có file BGM muốn dùng không?" and either
// picks from listBgm() or calls saveBgm() with a new upload.
//
// Usage (CLI):
//   node scripts/bgm-library.mjs list
//   node scripts/bgm-library.mjs save <sourcePath> <name>
//
// Usage (import):
//   import { listBgm, saveBgm } from './bgm-library.mjs'

import { readdir, copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_PATH, getWorkspaceDir } from './workspace.mjs';

/**
 * List saved BGM track names (without the .mp3 extension) in
 * <workspaceDir>/bgm-library/.
 * @param {string} [workspaceDir] - defaults to the persisted workspace folder.
 * @returns {Promise<string[]>}
 */
export async function listBgm(workspaceDir = getWorkspaceDir()) {
  const bgmDir = path.join(workspaceDir, 'bgm-library');
  let entries;
  try {
    entries = await readdir(bgmDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.mp3'))
    .map((e) => e.name.slice(0, -4))
    .sort((a, b) => a.localeCompare(b));
}

/** Strip a leading/trailing quote-like wrapper and a trailing .mp3, if present. */
function sanitizeName(name) {
  let n = String(name).trim();
  if (n.toLowerCase().endsWith('.mp3')) n = n.slice(0, -4);
  // Keep filenames simple/safe: drop path separators the user might have
  // pasted in by mistake.
  n = n.replace(/[\\/]/g, '-').trim();
  return n;
}

/**
 * Copy a user-provided MP3 into <workspaceDir>/bgm-library/<name>.mp3 and
 * register it in config.local.json's bgmLibrary array (if that file already
 * exists — it's owned/created by scripts/init.mjs, so we read-modify-write
 * gracefully if present and skip that part entirely if it's not there yet).
 * @param {string} sourcePath
 * @param {string} name
 * @param {string} [workspaceDir] - defaults to the persisted workspace folder.
 * @returns {Promise<{ name: string, destPath: string }>}
 */
export async function saveBgm(sourcePath, name, workspaceDir = getWorkspaceDir()) {
  const resolvedSource = path.resolve(sourcePath);
  try {
    await access(resolvedSource, fsConstants.R_OK);
  } catch {
    throw new Error(`BGM source file not found or not readable: ${resolvedSource}`);
  }

  const cleanName = sanitizeName(name);
  if (!cleanName) {
    throw new Error('BGM name must not be empty');
  }

  const bgmDir = path.join(workspaceDir, 'bgm-library');
  await mkdir(bgmDir, { recursive: true });
  const destPath = path.join(bgmDir, `${cleanName}.mp3`);
  await copyFile(resolvedSource, destPath);

  await registerInConfig(cleanName);

  return { name: cleanName, destPath };
}

async function registerInConfig(name) {
  let raw;
  try {
    raw = await readFile(CONFIG_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      // config.local.json is created by scripts/init.mjs — not our job to
      // create it. Skip registration gracefully.
      console.log(
        `[bgm-library] config.local.json not found — skipping bgmLibrary registration (run \`npm run init\` to create it).`
      );
      return;
    }
    throw err;
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    console.warn('[bgm-library] config.local.json is not valid JSON — skipping bgmLibrary registration.');
    return;
  }

  if (!Array.isArray(config.bgmLibrary)) config.bgmLibrary = [];
  if (!config.bgmLibrary.includes(name)) {
    config.bgmLibrary.push(name);
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function isMain() {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === 'list') {
    const names = await listBgm();
    if (names.length === 0) {
      console.log('(no saved BGM tracks yet)');
    } else {
      for (const n of names) console.log(n);
    }
  } else if (cmd === 'save') {
    const [sourcePath, name] = rest;
    if (!sourcePath || !name) {
      console.error('Usage: node scripts/bgm-library.mjs save <sourcePath> <name>');
      process.exit(1);
    }
    try {
      const { name: savedName, destPath } = await saveBgm(sourcePath, name);
      console.log(`[bgm-library] saved "${savedName}" -> ${destPath}`);
    } catch (err) {
      console.error(`[bgm-library] ERROR: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.error('Usage:\n  node scripts/bgm-library.mjs list\n  node scripts/bgm-library.mjs save <sourcePath> <name>');
    process.exit(1);
  }
}
