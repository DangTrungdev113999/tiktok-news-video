#!/usr/bin/env node
// scripts/clean-source.mjs
//
// Renames a folder of source material into the scheme the scene script can
// address by number, and drops a marker copy beside every image:
//
//   IMG_4471.HEIC  ->  anh_1.heic  +  anh_1_des.heic
//   clip final.MOV ->  video_1.mov
//
// The scheme (and why each rule is the way it is) lives in
// skills/tiktok-news-video/references/asset-naming.md. This file is its
// executable half; `scripts/resolve-asset.mjs` is the other.
//
//   node scripts/clean-source.mjs <folder> [--dry-run]
//
// Renaming a human's files is hard to undo, so this always prints the full
// old -> new mapping, and `--dry-run` prints it without touching anything.

import { readdir, rename, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif', '.bmp', '.tif', '.tiff', '.avif']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);

/** `img2` before `img10` -- plain string sort gets this backwards. */
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Decide every rename for a folder listing. Pure, so the plan can be printed,
 * checked for collisions, and tested without a filesystem.
 *
 * @param {string[]} names  filenames (not paths) already present in the folder
 * @returns {{plan: Array<{from,to,des?}>, skipped: string[], alreadyClean: boolean}}
 */
export function planRenames(names) {
  const skipped = [];
  const sources = [];

  for (const name of names) {
    if (name.startsWith('.')) continue;
    const ext = path.extname(name).toLowerCase();
    const kind = IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : null;
    if (!kind) {
      skipped.push(name);
      continue;
    }
    // A marker copy is an OUTPUT of this tool, never an input -- feeding one
    // back in would renumber it away from the picture it describes.
    if (/_des$/i.test(path.basename(name, path.extname(name)))) continue;
    sources.push({ name, kind, ext });
  }

  sources.sort((a, b) => collator.compare(a.name, b.name));

  const counters = { image: 0, video: 0 };
  const plan = sources.map((s) => {
    const n = ++counters[s.kind];
    const stem = s.kind === 'image' ? `anh_${n}` : `video_${n}`;
    return {
      from: s.name,
      to: `${stem}${s.ext}`,
      // Videos get no marker copy: a still marker on moving footage means
      // nothing to point at.
      ...(s.kind === 'image' ? { des: `${stem}_des${s.ext}` } : {}),
    };
  });

  return { plan, skipped, alreadyClean: plan.every((p) => p.from === p.to) && plan.length > 0 };
}

export async function cleanSource(folder, { dryRun = false } = {}) {
  const dir = path.resolve(folder);
  const st = await stat(dir).catch(() => null);
  if (!st?.isDirectory()) throw new Error(`not a folder: ${dir}`);

  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => e.name);

  const { plan, skipped, alreadyClean } = planRenames(names);
  if (plan.length === 0) throw new Error(`no images or videos found in ${dir}`);

  // A second run over a folder where new sources have been dropped in would
  // renumber the pictures out from under markers the employee already drew.
  // Refuse rather than silently mis-pair `anh_2_des` with a different photo.
  const existingDes = names.filter((n) => /_des\.[^.]+$/i.test(n));
  if (existingDes.length > 0 && !alreadyClean) {
    throw new Error(
      `${dir} already holds marker copies (${existingDes.join(', ')}) but the numbering would ` +
        `change. Renaming now would point each _des file at a different picture. ` +
        `Move the new sources into their own folder, or delete the _des files first.`,
    );
  }

  if (!dryRun && !alreadyClean) {
    // Two passes through a temp name: renaming straight to the target can
    // clobber a source that has not been visited yet (a folder already
    // holding `anh_2.jpg` first, `anh_1.jpg` second is enough to lose one).
    const tmp = plan.map((p, i) => ({ ...p, tmp: `.clean-source-${i}${path.extname(p.to)}` }));
    for (const p of tmp) await rename(path.join(dir, p.from), path.join(dir, p.tmp));
    for (const p of tmp) await rename(path.join(dir, p.tmp), path.join(dir, p.to));
  }

  // Marker copies are made (or refreshed only when absent) after the renames,
  // so a re-run never overwrites markers the employee has already drawn on.
  const desCreated = [];
  for (const p of plan) {
    if (!p.des) continue;
    const target = path.join(dir, p.des);
    if (await stat(target).catch(() => null)) continue;
    if (!dryRun) await copyFile(path.join(dir, p.to), target);
    desCreated.push(p.des);
  }

  return { dir, plan, skipped, desCreated, alreadyClean };
}

// CLI
//
// `file://${process.argv[1]}` is a macOS-only accident. It works there because
// a POSIX path already starts with "/", so "file://" + "/Users/..." lands on
// the three slashes a file URL needs. On Windows argv[1] is "C:\Users\..." and
// the comparison is ALWAYS false -- verified, not assumed.
//
// The failure was silent and therefore worse than a crash: the script printed
// nothing, renamed nothing, created no `_des` copies, and exited 0. The agent
// reported success on a folder it had never touched, and the whole `anh_1` /
// `target N` naming contract collapsed further downstream.
//
// `pathToFileURL` is what the other six CLI scripts in this repo already use.
// The try/catch matches them too: under `node -e` there is no argv[1] and
// pathToFileURL(undefined) throws.
function isMain() {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const folder = args.find((a) => !a.startsWith('--'));
  if (!folder) {
    console.error('usage: node scripts/clean-source.mjs <folder> [--dry-run]');
    process.exit(1);
  }
  let r;
  try {
    r = await cleanSource(folder, { dryRun });
  } catch (err) {
    // The failures here are all things the employee can act on -- a stack
    // trace buries the sentence that tells them what to do.
    console.error(`clean-source: ${err.message}`);
    process.exit(1);
  }
  console.log(`${dryRun ? '[dry-run] ' : ''}${r.dir}`);
  for (const p of r.plan) {
    console.log(`  ${p.from}  ->  ${p.to}${p.des ? `  (+ ${p.des})` : ''}`);
  }
  if (r.skipped.length) console.log(`  skipped (not image/video): ${r.skipped.join(', ')}`);
}
