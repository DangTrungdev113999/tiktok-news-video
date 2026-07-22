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
// and MAY contain:
//   logo.svg      -- the badge mark (falls back to a © glyph)
//
// Optional is load-bearing here, not politeness: a brand kit grows one key at
// a time, and if each new key were required, every addition would invalidate
// every brand folder already in the field. See
// docs/superpowers/specs/2026-07-22-brand-as-design-kit-design.md.
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

const MANIFEST_FILENAME = 'brand.json';

/**
 * Background for the hook scene. OPTIONAL, and .svg leads for the same reason
 * it does for the logo: the renderer is Chrome.
 *
 * This used to be a required hook-bg.jpg, which quietly made two decisions no
 * one had agreed to -- that every channel's cover is a photograph, and that a
 * *hook-screen* asset is a precondition for the brand existing at all. A brand
 * whose cover is drawn rather than photographed could not be created, and one
 * that wants no cover art had to supply a file anyway.
 */
const HOOK_BG_FILENAMES = [
  'hook-bg.svg',
  'hook-bg.png',
  'hook-bg.jpg',
  'hook-bg.jpeg',
  'hook-bg.webp',
];

/**
 * The channel's mark, drawn inside the badge disc. OPTIONAL, and .svg comes
 * first on purpose: the renderer is Chrome, so vector markup costs nothing to
 * load and stays sharp at any badge size.
 *
 * Optional is the whole point. Before this, every brand wore the literal
 * character `©`, hardcoded in HookCard.tsx -- a copyright symbol on channels
 * that have nothing to do with copyright. A brand that drops a logo.svg in
 * gets its own mark; one that doesn't keeps the old glyph and needs no edits.
 */
const LOGO_FILENAMES = ['logo.svg', 'logo.png'];
/**
 * Karaoke caption geometry a brand may override. OPTIONAL, and partial: only
 * the keys a brand actually sets travel in the spec, and the renderer merges
 * them over CAPTION in remotion/src/layout.ts.
 *
 * Partial on purpose. Copying the default numbers into this file would mean
 * every future tweak to layout.ts silently disagrees with a stale copy on the
 * node side -- and the disagreement would only show up as a video that looks
 * subtly wrong, which is the hardest kind of bug to trace back here.
 *
 * NOT in this list: font family. That is brand-wide typography, not caption
 * geometry -- layout.ts exists precisely so the headline and the captions can
 * never load different families again, so a per-brand font has to move all of
 * them at once and needs a font-loading gate. Separate slice.
 */
const CAPTION_KEYS = ['left', 'rightInset', 'bottomInset', 'fontSize', 'lineHeight', 'wordGap'];

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

  const caption = resolveCaptionOverrides(manifest.caption);

  // Optional files are probed, never required: a missing one yields null and
  // the renderer falls back, rather than knocking the whole brand out of the
  // picker.
  const [logoPath, hookBgPath] = await Promise.all([
    firstReadable(brandDir, slug, LOGO_FILENAMES),
    firstReadable(brandDir, slug, HOOK_BG_FILENAMES),
  ]);

  return {
    slug,
    displayName: manifest.displayName,
    badgeLabel: manifest.badgeLabel,
    badgeGradient: manifest.badgeGradient,
    badgeShadow: manifest.badgeShadow,
    headlineShadow: manifest.headlineShadow,
    headlineStroke: manifest.headlineStroke,
    hookBgPath,
    logoPath,
    caption,
  };
}

/**
 * Validate `brand.json`'s optional `caption` block and return only the keys it
 * actually sets (or null when there is no block at all).
 *
 * An unknown key is an ERROR, not a shrug. A brand author who writes
 * `botomInset` otherwise gets a video that ignores the setting with no
 * explanation anywhere, and the natural conclusion is "the feature doesn't
 * work" rather than "I misspelled it". Failing here surfaces it at Step 1,
 * with the misspelling quoted, before anything has been rendered or paid for.
 *
 * Position values are NOT bounds-checked here -- see build-spec.mjs, which
 * clamps them to TikTok's safe zone and warns. Out of bounds is renderable;
 * it just renders somewhere the platform's own UI covers up.
 */
function resolveCaptionOverrides(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${MANIFEST_FILENAME}: "caption" must be an object`);
  }

  const unknown = Object.keys(raw).filter((k) => !CAPTION_KEYS.includes(k));
  if (unknown.length > 0) {
    throw new Error(
      `${MANIFEST_FILENAME}: unknown caption key(s) ${unknown.map((k) => `"${k}"`).join(', ')} ` +
        `(allowed: ${CAPTION_KEYS.join(', ')})`,
    );
  }

  const out = {};
  for (const key of CAPTION_KEYS) {
    if (raw[key] === undefined) continue;
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`${MANIFEST_FILENAME}: caption.${key} must be a positive number (got ${JSON.stringify(value)})`);
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * First readable candidate in `filenames`, as a workspace-relative POSIX path
 * (what staticFile() wants), or null if none exist.
 *
 * POSIX join, not path.join: these strings end up in spec.json and are handed
 * to staticFile(), which builds a URL. On Windows a backslash is a literal
 * character there, not a separator, so the asset silently fails to load.
 */
async function firstReadable(brandDir, slug, filenames) {
  for (const filename of filenames) {
    try {
      await access(path.join(brandDir, filename), fsConstants.R_OK);
      return path.posix.join('brand', slug, filename);
    } catch {
      // not this one; try the next
    }
  }
  return null;
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
