#!/usr/bin/env node
// scripts/brand-kit.mjs
//
// Multi-brand kit resolution (docs/superpowers/specs/
// 2026-07-18-multi-brand-kit-design.md). The plugin owner hand-designs a
// brand kit per TikTok channel and hands the whole folder to whichever
// employee runs that channel -- so this is a pure directory-scan, not a
// register-via-CLI flow like the old single-brandKit model: a brand
// "activates" the moment its folder is dropped into
// <workspaceDir>/brand/<slug>/, no command required.
//
// Each brand folder must contain:
//   hook-bg.jpg   -- background image for the hook card
//   brand.json    -- {displayName, badgeLabel, badgeGradient[3],
//                     badgeShadow, headlineShadow[3], headlineStroke}
//
// Usage (CLI):
//   node scripts/brand-kit.mjs list
//   node scripts/brand-kit.mjs get <slug>
//
// Usage (import):
//   import { listBrands, getBrand } from './brand-kit.mjs'

import { readdir, readFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getWorkspaceDir } from './workspace.mjs';

const HOOK_BG_FILENAME = 'hook-bg.jpg';
const MANIFEST_FILENAME = 'brand.json';
const REQUIRED_MANIFEST_FIELDS = [
  'displayName',
  'badgeLabel',
  'badgeGradient',
  'badgeShadow',
  'headlineShadow',
  'headlineStroke',
];

/**
 * Validate one brand folder and return its resolved shape, or throw with a
 * short reason (missing file, invalid JSON, missing field) -- callers turn
 * this into a per-slug {slug, error} entry rather than letting one bad
 * folder crash the whole scan.
 */
async function resolveBrandFolder(brandDir, slug) {
  const hookBgPath = path.join(brandDir, HOOK_BG_FILENAME);
  try {
    await access(hookBgPath, fsConstants.R_OK);
  } catch {
    throw new Error(`missing ${HOOK_BG_FILENAME}`);
  }

  const manifestPath = path.join(brandDir, MANIFEST_FILENAME);
  let raw;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch {
    throw new Error(`missing ${MANIFEST_FILENAME}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    throw new Error(`${MANIFEST_FILENAME} is not valid JSON`);
  }

  const missing = REQUIRED_MANIFEST_FIELDS.filter((f) => manifest[f] === undefined);
  if (missing.length > 0) {
    throw new Error(`${MANIFEST_FILENAME} missing field(s): ${missing.join(', ')}`);
  }

  return {
    slug,
    displayName: manifest.displayName,
    badgeLabel: manifest.badgeLabel,
    badgeGradient: manifest.badgeGradient,
    badgeShadow: manifest.badgeShadow,
    headlineShadow: manifest.headlineShadow,
    headlineStroke: manifest.headlineStroke,
    hookBgPath: path.posix.join('brand', slug, HOOK_BG_FILENAME),
  };
}

/**
 * Scan <workspaceDir>/brand/*\/ for brand folders. Returns
 * { brands: [...resolved], invalid: [{slug, error}] } so callers can both
 * use the valid ones and surface which folders are broken -- a non-tech
 * employee who mis-copied a folder needs to see why it's missing from the
 * picker, not have it silently vanish.
 * @param {string} [workspaceDir] - defaults to the persisted workspace folder.
 */
export async function listBrands(workspaceDir = getWorkspaceDir()) {
  const brandRoot = path.join(workspaceDir, 'brand');
  let entries;
  try {
    entries = await readdir(brandRoot, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return { brands: [], invalid: [] };
    throw err;
  }

  const brands = [];
  const invalid = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const slug = entry.name;
    try {
      brands.push(await resolveBrandFolder(path.join(brandRoot, slug), slug));
    } catch (err) {
      invalid.push({ slug, error: err.message });
    }
  }
  return { brands, invalid };
}

/**
 * Resolve one brand by slug. Throws a clear error if it doesn't exist or is
 * invalid (callers should have already offered a valid slug via listBrands,
 * so this is a sanity check, not the primary validation path).
 * @param {string} slug
 * @param {string} [workspaceDir] - defaults to the persisted workspace folder.
 */
export async function getBrand(slug, workspaceDir = getWorkspaceDir()) {
  const { brands, invalid } = await listBrands(workspaceDir);
  const found = brands.find((b) => b.slug === slug);
  if (found) return found;
  const invalidMatch = invalid.find((b) => b.slug === slug);
  if (invalidMatch) throw new Error(`Brand "${slug}" is invalid: ${invalidMatch.error}`);
  throw new Error(`Brand "${slug}" not found in ${path.join(workspaceDir, 'brand')}`);
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
    const { brands, invalid } = await listBrands();
    if (brands.length === 0 && invalid.length === 0) {
      console.log('(no brand folders yet)');
    } else {
      for (const b of brands) console.log(`${b.slug}\t${b.displayName}`);
      for (const b of invalid) console.log(`${b.slug}\t[INVALID: ${b.error}]`);
    }
  } else if (cmd === 'get') {
    const [slug] = rest;
    if (!slug) {
      console.error('Usage: node scripts/brand-kit.mjs get <slug>');
      process.exit(1);
    }
    try {
      const brand = await getBrand(slug);
      console.log(JSON.stringify(brand, null, 2));
    } catch (err) {
      console.error(`[brand-kit] ERROR: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.error('Usage:\n  node scripts/brand-kit.mjs list\n  node scripts/brand-kit.mjs get <slug>');
    process.exit(1);
  }
}
