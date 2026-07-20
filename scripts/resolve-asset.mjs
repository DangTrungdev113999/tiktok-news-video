#!/usr/bin/env node
// scripts/resolve-asset.mjs
//
// Turns what the author typed into a real path under `assets/`.
//
//   anh_1.jpg   anh_1   ảnh 1   Anh 1   anh-1   ANH_1   ->  ban-quyen/anh_1.jpg
//
// The contract this implements (and `scripts/clean-source.mjs` produces) is
// skills/tiktok-news-video/references/asset-naming.md. Read that first; this
// file is only the executable half.
//
// Deliberately NOT general fuzzy matching. It canonicalises (diacritics, case,
// separators) and drops the extension, then compares the resulting stem WHOLE.
// A genuine typo therefore still fails as a missing asset instead of being
// matched to whatever was closest -- silently rendering the wrong photo is a
// worse outcome than an error the author can read.

import { readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Vietnamese-insensitive, separator-insensitive, extension-less form.
 * `Ảnh 1.JPG` and `anh-1` both land on `anh_1`.
 */
export function canonicalStem(name) {
  const withoutExt = name.replace(/\.[A-Za-z0-9]+$/, '');
  return withoutExt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining accents
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[\s\-_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Every file under `assets/`, as paths relative to it. */
async function listAssetFiles(assetsDir) {
  const out = [];
  async function walk(rel) {
    let entries;
    try {
      entries = await readdir(path.join(assetsDir, rel), { withFileTypes: true });
    } catch {
      return; // assets/ itself may not exist yet -- the caller reports that
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const childRel = rel ? path.posix.join(rel, e.name) : e.name;
      if (e.isDirectory()) await walk(childRel);
      else out.push(childRel);
    }
  }
  await walk('');
  return out;
}

/**
 * Build the lookup once per run; resolving N scenes must not walk the tree N
 * times. Returns `{ resolve(typed) -> {path} | {error} }`.
 */
export async function buildAssetIndex(workspaceDir) {
  const assetsDir = path.resolve(workspaceDir, 'assets');
  const files = await listAssetFiles(assetsDir);

  const literal = new Set(files.map((f) => f.split(path.sep).join('/')));
  // canonical stem -> every file that claims it. A path is indexed under both
  // its bare stem (`anh_1`) and its folder-qualified stem (`ban_quyen/anh_1`),
  // so the author can disambiguate by writing the folder.
  const byStem = new Map();
  const add = (key, file) => {
    if (!byStem.has(key)) byStem.set(key, []);
    byStem.get(key).push(file);
  };
  for (const file of literal) {
    const parts = file.split('/');
    const stem = canonicalStem(parts.pop());
    add(stem, file);
    if (parts.length) add([...parts.map(canonicalStem), stem].join('/'), file);
  }

  return {
    files: [...literal],

    /**
     * @returns {{path: string} | {error: string}} -- path is relative to
     * `assets/`. Never guesses: 0 or 2+ candidates are both errors.
     */
    resolve(typed) {
      const raw = String(typed ?? '').trim();
      if (!raw) return { error: 'empty asset name' };

      // 1. Literal wins. An author who typed the whole path is never
      //    second-guessed, and existing projects keep working unchanged.
      const asPosix = raw.split(path.sep).join('/').replace(/^\.\//, '');
      if (literal.has(asPosix)) return { path: asPosix };

      // 2. Canonical stem, compared WHOLE -- `anh_1` matches neither
      //    `anh_1_des.jpg` nor `anh_10.jpg`.
      const key = asPosix.split('/').map(canonicalStem).join('/');

      const hits = byStem.get(key) ?? [];
      if (hits.length === 1) return { path: hits[0] };
      if (hits.length === 0) return { error: `no file in assets/ matches "${raw}"` };
      return {
        error:
          `"${raw}" is ambiguous -- ${hits.length} files match: ${hits.join(', ')}. ` +
          `Write the folder too, e.g. "${hits[0].replace(/\.[^.]+$/, '')}".`,
      };
    },
  };
}
