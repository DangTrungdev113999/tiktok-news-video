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
//   node scripts/bgm-library.mjs save <sourcePath> <name> [mô tả...]
//
// Usage (import):
//   import { listBgm, saveBgm } from './bgm-library.mjs'

import { readdir, copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_PATH, getWorkspaceDir } from './workspace.mjs';

const execFileP = promisify(execFile);

// Below this integrated loudness a track, mixed at the house-fixed 25%, tends
// to vanish under the narration -- exactly the "I hear no BGM at all" report
// that motivated measuring this at all. The list surfaces it so the user can
// avoid a quiet-mastered track BEFORE it ships, instead of after.
const LUFS_QUIET_THRESHOLD = -20;

/** Sidecar metadata for the BGM library, keyed by track name (no extension). */
function bgmIndexPath(workspaceDir) {
  return path.join(workspaceDir, 'bgm-library', 'index.json');
}

async function readBgmIndex(workspaceDir) {
  try {
    const raw = await readFile(bgmIndexPath(workspaceDir), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Missing or corrupt index must never break listing/saving -- it is pure
    // enrichment over the .mp3 files, which stay the source of truth.
    return {};
  }
}

async function writeBgmIndex(workspaceDir, index) {
  await mkdir(path.join(workspaceDir, 'bgm-library'), { recursive: true });
  await writeFile(bgmIndexPath(workspaceDir), JSON.stringify(index, null, 2) + '\n');
}

/**
 * Integrated loudness (LUFS) of a track, via ffmpeg's loudnorm analysis pass,
 * rounded to 0.1. Returns null on ANY failure (ffmpeg missing, odd input) --
 * measurement is enrichment, never a precondition for saving the file.
 */
async function measureLufs(filePath) {
  try {
    const { stderr } = await execFileP(
      'ffmpeg',
      ['-hide_banner', '-nostats', '-i', filePath, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
      { maxBuffer: 8 * 1024 * 1024 }
    );
    const m = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
    if (!m) return null;
    const lufs = Number.parseFloat(JSON.parse(m[0]).input_i);
    return Number.isFinite(lufs) ? Math.round(lufs * 10) / 10 : null;
  } catch {
    return null;
  }
}

/**
 * List saved BGM tracks in <workspaceDir>/bgm-library/, each enriched from the
 * sidecar index.json with a `description` and integrated loudness `lufs` (both
 * `null` for a track dropped in by hand or saved before this metadata existed
 * -- re-save it to enrich). The .mp3 files remain the source of truth for
 * WHICH tracks exist; the index only annotates them.
 *
 * @param {string} [workspaceDir] - defaults to the persisted workspace folder.
 * @returns {Promise<Array<{name: string, description: (string|null), lufs: (number|null)}>>}
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
  const index = await readBgmIndex(workspaceDir);
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.mp3'))
    .map((e) => e.name.slice(0, -4))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      description: typeof index[name]?.description === 'string' && index[name].description ? index[name].description : null,
      lufs: typeof index[name]?.lufs === 'number' ? index[name].lufs : null,
    }));
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
 * The copy is the only hard step. `description` (a short mood note in the
 * user's words) and the measured loudness are written to the sidecar
 * index.json as enrichment — if the loudness measurement fails it stores null
 * and the save still succeeds.
 *
 * @param {string} sourcePath
 * @param {string} name
 * @param {string} [description] - short mood note, stored in index.json.
 * @param {string} [workspaceDir] - defaults to the persisted workspace folder.
 * @returns {Promise<{ name: string, destPath: string, description: string, lufs: (number|null) }>}
 */
export async function saveBgm(sourcePath, name, description = '', workspaceDir = getWorkspaceDir()) {
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

  const cleanDescription = String(description ?? '').trim();
  const lufs = await measureLufs(destPath);
  const index = await readBgmIndex(workspaceDir);
  index[cleanName] = { description: cleanDescription, lufs };
  await writeBgmIndex(workspaceDir, index);

  await registerInConfig(cleanName);

  return { name: cleanName, destPath, description: cleanDescription, lufs };
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
    const tracks = await listBgm();
    if (tracks.length === 0) {
      console.log('(no saved BGM tracks yet)');
    } else {
      for (const t of tracks) {
        console.log(t.name);
        console.log(`   mô tả: ${t.description || '(chưa có mô tả)'}`);
        if (t.lufs != null) {
          const quiet = t.lufs < LUFS_QUIET_THRESHOLD ? ' ⚠️ hơi nhỏ, ở mức BGM 25% dễ chìm dưới giọng' : '';
          console.log(`   độ to: ${t.lufs} LUFS${quiet}`);
        } else {
          console.log('   độ to: (chưa đo — lưu lại để đo)');
        }
      }
    }
  } else if (cmd === 'save') {
    const [sourcePath, name, ...descParts] = rest;
    if (!sourcePath || !name) {
      console.error('Usage: node scripts/bgm-library.mjs save <sourcePath> <name> [mô tả...]');
      process.exit(1);
    }
    try {
      const saved = await saveBgm(sourcePath, name, descParts.join(' '));
      console.log(`[bgm-library] saved "${saved.name}" -> ${saved.destPath}`);
      if (saved.lufs != null) {
        const quiet = saved.lufs < LUFS_QUIET_THRESHOLD ? ' ⚠️ hơi nhỏ, ở mức BGM 25% dễ chìm dưới giọng' : '';
        console.log(`[bgm-library] độ to đo được: ${saved.lufs} LUFS${quiet}`);
      } else {
        console.log('[bgm-library] (không đo được độ to — file vẫn được lưu bình thường)');
      }
    } catch (err) {
      console.error(`[bgm-library] ERROR: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.error('Usage:\n  node scripts/bgm-library.mjs list\n  node scripts/bgm-library.mjs save <sourcePath> <name> [mô tả...]');
    process.exit(1);
  }
}
