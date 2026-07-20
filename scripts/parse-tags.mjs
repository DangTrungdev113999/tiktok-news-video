#!/usr/bin/env node
// scripts/parse-tags.mjs
//
// Parses ONE asset line of a scene script into structured data.
//
//   anh_1.jpg (30%) | focus_object: nguoi thu 1 tu trai sang
//
// The grammar and the registry of keys live in
// skills/tiktok-news-video/references/tags/README.md -- this file is the
// executable half of that contract. Adding a key means adding a row there,
// writing its reference file, and adding it to KNOWN_KEYS below.
//
// Deliberately does NOT resolve anything. `focus_object`'s value is free-form
// Vietnamese that only a look at the image can turn into coordinates; that
// happens in the skill, at build time. This parser just says what the author
// wrote.

/**
 * Tag keys this pipeline implements. A key outside this set is returned in
 * `unknownKeys` so the skill can tell the user rather than guess: a silently
 * ignored tag looks exactly like a tag that worked.
 */
export const KNOWN_KEYS = new Set(['focus_object']);

/** Bare flags -- tags written as the key alone, with no value. */
export const KNOWN_FLAGS = new Set([]);

const SHARE_RE = /\((\d+(?:\.\d+)?)\s*%\)/;

/**
 * @param {string} line one asset line, e.g. 'anh_1.jpg (30%) | focus_object: ...'
 * @returns {{filename: string, share?: number, tags: Record<string,string>,
 *            flags: string[], unknownKeys: string[], warnings: string[]}}
 */
export function parseAssetLine(line) {
  const warnings = [];
  const unknownKeys = [];
  const tags = {};
  const flags = [];

  const parts = String(line).split('|').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`parseAssetLine: empty line`);
  }

  // Head: the filename, optionally followed by a (30%) duration share.
  let head = parts[0];
  let share;
  const shareMatch = head.match(SHARE_RE);
  if (shareMatch) {
    share = Number(shareMatch[1]);
    head = head.replace(SHARE_RE, '').trim();
  }
  const filename = head;
  if (!filename || filename.includes(' ')) {
    throw new Error(
      `parseAssetLine: "${parts[0]}" doesn't look like a filename -- expected ` +
      `"<file> (<share>%)" before the first "|"`
    );
  }

  for (const part of parts.slice(1)) {
    const colon = part.indexOf(':');

    if (colon === -1) {
      // No colon -> a bare flag.
      if (KNOWN_FLAGS.has(part)) flags.push(part);
      else unknownKeys.push(part);
      continue;
    }

    const key = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();

    if (!KNOWN_KEYS.has(key)) {
      unknownKeys.push(key);
      continue;
    }
    if (!value) {
      warnings.push(`"${key}" on ${filename} has no value -- ignored`);
      continue;
    }
    if (tags[key] !== undefined) {
      warnings.push(`"${key}" appears twice on ${filename} -- using the first`);
      continue;
    }
    tags[key] = value;
  }

  return { filename, ...(share !== undefined ? { share } : {}), tags, flags, unknownKeys, warnings };
}

/**
 * Parse every asset line of one screen.
 *
 * @param {string[]} lines
 * @returns {{assets: object[], unknownKeys: string[], warnings: string[]}}
 *   `unknownKeys` and `warnings` are merged across the screen so the skill can
 *   report them in one go instead of once per line.
 */
export function parseScreenAssets(lines) {
  const assets = lines.map((l) => parseAssetLine(l));
  return {
    assets,
    unknownKeys: [...new Set(assets.flatMap((a) => a.unknownKeys))],
    warnings: assets.flatMap((a) => a.warnings),
  };
}
