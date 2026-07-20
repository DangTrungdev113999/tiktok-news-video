#!/usr/bin/env node
// scripts/brand-kit.mjs
//
// The hook-card overlay (remotion/src/HookCard.tsx) needs two brand assets
// (a gradient card template + a logo) that are the SAME across every video
// for a given channel -- not per-video content like assets/, and not
// user-picked-per-run like bgm-library/. Configured ONCE (like voiceId), then
// reused automatically by every future make-video run without re-asking, the
// same reasoning bgm-library.mjs uses for saved BGM tracks.
//
// Usage (CLI):
//   node scripts/brand-kit.mjs set <hookBgSourcePath> <logoSourcePath>
//   node scripts/brand-kit.mjs get
//
// Usage (import):
//   import { setBrandKit, getBrandKit } from './brand-kit.mjs'

import { copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_PATH, getWorkspaceDir } from './workspace.mjs';

const HOOK_BG_FILENAME = 'hook-bg.jpg';
const LOGO_FILENAME = 'logo.jpg';

/**
 * Copy the two brand assets into <workspaceDir>/brand/ and register their
 * (workspace-relative) paths in config.local.json's `brandKit` field.
 * @param {string} hookBgSourcePath
 * @param {string} logoSourcePath
 * @param {string} [workspaceDir] - defaults to the persisted workspace folder.
 * @returns {Promise<{hookBgPath: string, logoPath: string}>}
 */
export async function setBrandKit(hookBgSourcePath, logoSourcePath, workspaceDir = getWorkspaceDir()) {
  const resolvedHookBg = path.resolve(hookBgSourcePath);
  const resolvedLogo = path.resolve(logoSourcePath);
  for (const p of [resolvedHookBg, resolvedLogo]) {
    try {
      await access(p, fsConstants.R_OK);
    } catch {
      throw new Error(`Brand asset source file not found or not readable: ${p}`);
    }
  }

  const brandDir = path.join(workspaceDir, 'brand');
  await mkdir(brandDir, { recursive: true });
  await copyFile(resolvedHookBg, path.join(brandDir, HOOK_BG_FILENAME));
  await copyFile(resolvedLogo, path.join(brandDir, LOGO_FILENAME));

  const brandKit = {
    hookBgPath: path.posix.join('brand', HOOK_BG_FILENAME),
    logoPath: path.posix.join('brand', LOGO_FILENAME),
  };
  await registerInConfig(brandKit);
  return brandKit;
}

/** Read the registered brand kit from config.local.json, or null if not set yet. */
export async function getBrandKit() {
  let raw;
  try {
    raw = await readFile(CONFIG_PATH, 'utf8');
  } catch {
    return null;
  }
  try {
    const config = JSON.parse(raw);
    return config.brandKit ?? null;
  } catch {
    return null;
  }
}

async function registerInConfig(brandKit) {
  let raw;
  try {
    raw = await readFile(CONFIG_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(
        `[brand-kit] config.local.json not found — skipping brandKit registration (run \`npm run init\` to create it).`
      );
      return;
    }
    throw err;
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    console.warn('[brand-kit] config.local.json is not valid JSON — skipping brandKit registration.');
    return;
  }

  config.brandKit = brandKit;
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
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

  if (cmd === 'set') {
    const [hookBgSourcePath, logoSourcePath] = rest;
    if (!hookBgSourcePath || !logoSourcePath) {
      console.error('Usage: node scripts/brand-kit.mjs set <hookBgSourcePath> <logoSourcePath>');
      process.exit(1);
    }
    try {
      const brandKit = await setBrandKit(hookBgSourcePath, logoSourcePath);
      console.log(`[brand-kit] saved -> ${JSON.stringify(brandKit)}`);
    } catch (err) {
      console.error(`[brand-kit] ERROR: ${err.message}`);
      process.exit(1);
    }
  } else if (cmd === 'get') {
    const brandKit = await getBrandKit();
    console.log(brandKit ? JSON.stringify(brandKit, null, 2) : '(no brand kit configured yet)');
  } else {
    console.error(
      'Usage:\n  node scripts/brand-kit.mjs set <hookBgSourcePath> <logoSourcePath>\n  node scripts/brand-kit.mjs get'
    );
    process.exit(1);
  }
}
