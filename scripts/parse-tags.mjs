#!/usr/bin/env node
// scripts/parse-tags.mjs
//
// Parses ONE asset line of a scene script into structured data.
//
// The canonical form is pipe-separated with a colon after each key:
//
//   anh_1.jpg (30%) | focus_object: nguoi thu 1 tu trai sang
//
// but the parser is deliberately LENIENT, because the people typing these
// lines are not programmers and a syntax error that rejects an otherwise
// clear line is a worse outcome than a slightly ambiguous parse. All of these
// mean the same thing:
//
//   anh_1.jpg | focus_object: nguoi thu 1
//   anh_1.jpg : focus_object nguoi thu 1
//   anh_1 focus_object nguoi thu 1
//
// The rules that make that safe: the filename is always the first token, and
// a tag always starts at a REGISTERED key. Everything between one key and the
// next is that key's value, so free-form Vietnamese needs no quoting or
// escaping.
//
// The grammar and the registry of keys live in
// skills/tiktok-news-video/references/tags/README.md -- this file is the
// executable half of that contract.
//
// Deliberately does NOT resolve anything. `focus_object`'s value is free-form
// Vietnamese that only a look at the image (and Step 2's word timing) can turn
// into numbers; that happens in the skill, at build time. This parser just
// says what the author wrote.

/**
 * Tag keys this pipeline implements. A key outside this set is returned in
 * `unknownKeys` so the skill can tell the user rather than guess: a silently
 * ignored tag looks exactly like a tag that worked.
 */
export const KNOWN_KEYS = new Set(['focus_object']);

/** Bare flags -- tags written as the key alone, with no value. */
export const KNOWN_FLAGS = new Set([]);

const SHARE_RE = /\((\d+(?:\.\d+)?)\s*%\)/;

/** Looks like someone meant it as a key: an identifier followed by a colon. */
const UNKNOWN_KEY_RE = /^([A-Za-z][\w-]*)\s*:/;

function keyPattern() {
  const keys = [...KNOWN_KEYS, ...KNOWN_FLAGS];
  if (keys.length === 0) return null;
  // A key must start at a token boundary and may be followed by ':' or not.
  return new RegExp(`(?:^|[\\s|])(${keys.join('|')})\\s*:?\\s*`, 'g');
}

/**
 * @param {string} line one asset line
 * @returns {{filename: string, share?: number, tags: Record<string,string>,
 *            flags: string[], unknownKeys: string[], warnings: string[]}}
 */
export function parseAssetLine(line) {
  const warnings = [];
  const unknownKeys = [];
  const tags = {};
  const flags = [];

  let text = String(line).trim();
  if (!text) throw new Error('parseAssetLine: empty line');

  // Pull the (30%) share out wherever it sits.
  let share;
  const shareMatch = text.match(SHARE_RE);
  if (shareMatch) {
    share = Number(shareMatch[1]);
    text = text.replace(SHARE_RE, ' ');
  }

  // Give every pipe breathing room so it tokenises like any other separator.
  text = text.replace(/\|/g, ' | ').trim();

  // The filename is the first token, minus any separator stuck to it.
  const [rawFilename, ...restTokens] = text.split(/\s+/);
  const filename = rawFilename.replace(/[:|]+$/, '');
  if (!filename || filename === '|') {
    throw new Error(`parseAssetLine: no filename at the start of "${line}"`);
  }

  // Drop a separator the author put between the filename and the first tag.
  let rest = restTokens.join(' ').replace(/^[\s:|]+/, '');

  const pattern = keyPattern();
  if (!rest || !pattern) {
    return { filename, ...(share !== undefined ? { share } : {}), tags, flags, unknownKeys, warnings };
  }

  // Locate every registered key; the text between two keys is the first
  // one's value. This is what lets a value contain spaces, commas, quotes and
  // Vietnamese diacritics without any escaping.
  const hits = [];
  for (const m of rest.matchAll(pattern)) {
    hits.push({ key: m[1], valueStart: m.index + m[0].length, keyStart: m.index });
  }

  const cleanValue = (s) => s.replace(/^[\s:|]+|[\s|]+$/g, '');

  if (hits.length === 0) {
    collectUnknown(rest, unknownKeys);
  } else {
    collectUnknown(rest.slice(0, hits[0].keyStart), unknownKeys);
  }

  hits.forEach((hit, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].keyStart : rest.length;
    const value = cleanValue(rest.slice(hit.valueStart, end));

    if (KNOWN_FLAGS.has(hit.key)) {
      if (value) warnings.push(`"${hit.key}" on ${filename} is a flag but was given a value -- value ignored`);
      flags.push(hit.key);
      return;
    }
    if (!value) {
      warnings.push(`"${hit.key}" on ${filename} has no value -- ignored`);
      return;
    }
    if (tags[hit.key] !== undefined) {
      warnings.push(`"${hit.key}" appears twice on ${filename} -- using the first`);
      return;
    }
    tags[hit.key] = value;
  });

  return { filename, ...(share !== undefined ? { share } : {}), tags, flags, unknownKeys, warnings };
}

/**
 * Anything in a tag position that isn't a registered key. Reported rather than
 * dropped -- an author who typed a key we haven't built yet needs to hear
 * that, not watch it vanish.
 */
function collectUnknown(chunk, unknownKeys) {
  for (const piece of chunk.split('|')) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const named = trimmed.match(UNKNOWN_KEY_RE);
    unknownKeys.push(named ? named[1] : trimmed.split(/\s+/)[0]);
  }
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
