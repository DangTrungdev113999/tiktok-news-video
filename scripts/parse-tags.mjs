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
export const KNOWN_FLAGS = new Set(['fill_full_screen']);

/**
 * Keys that are valid BOTH bare and with a value -- bare means "use the
 * default". They land in `tags` like any other key, with `''` as the value when
 * written bare, so a consumer tests presence with `'zoom_in' in tags` rather
 * than truthiness.
 */
export const KNOWN_OPTIONAL_KEYS = new Set([
  'zoom_in',
  'zoom_out',
  'slide_left_right',
  'slide_right_left',
]);

/**
 * The keys that decide what the camera does. At most one may apply to an
 * asset; when an author writes several, the FIRST entry here wins and the rest
 * are reported. Ordered most-specific first -- an aimed move at a named
 * subject beats a survey of the whole picture, which beats a bare zoom.
 */
export const MOTION_KEYS = [
  'focus_object',
  'slide_left_right',
  'slide_right_left',
  'zoom_in',
  'zoom_out',
];

const SHARE_RE = /\((\d+(?:\.\d+)?)\s*%\)/;

/** Looks like someone meant it as a key: an identifier followed by a colon. */
const UNKNOWN_KEY_RE = /^([A-Za-z][\w-]*)\s*:/;

function keyPattern() {
  // Longest first: `zoom_in` is a prefix of nothing here, but a future key
  // that IS a prefix of another would otherwise match the shorter one and
  // leave the remainder stranded in the previous value.
  const keys = [...KNOWN_KEYS, ...KNOWN_FLAGS, ...KNOWN_OPTIONAL_KEYS].sort(
    (a, b) => b.length - a.length
  );
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
    if (!value && !KNOWN_OPTIONAL_KEYS.has(hit.key)) {
      warnings.push(`"${hit.key}" on ${filename} has no value -- ignored`);
      return;
    }
    if (tags[hit.key] !== undefined) {
      warnings.push(`"${hit.key}" appears twice on ${filename} -- using the first`);
      return;
    }
    tags[hit.key] = value;
  });

  // Only one tag may own the camera. Reported rather than resolved here: this
  // module says what the author wrote, and dropping a tag silently is exactly
  // the failure mode the unknown-key rule exists to prevent.
  const motionsPresent = MOTION_KEYS.filter((k) => k in tags);
  if (motionsPresent.length > 1) {
    warnings.push(
      `${filename} carries ${motionsPresent.length} motion tags (${motionsPresent.join(', ')}) -- ` +
      `only "${motionsPresent[0]}" applies, the rest are ignored`
    );
  }

  return {
    filename,
    ...(share !== undefined ? { share } : {}),
    tags,
    flags,
    ...(motionsPresent.length > 0 ? { motionKey: motionsPresent[0] } : {}),
    unknownKeys,
    warnings,
  };
}

/**
 * `50%`, `50 %`, `50` -> 0.5. Returns null for anything else (including an
 * empty value, which is how an optional-value key says "use the default").
 */
export function parsePercent(value) {
  const m = String(value ?? '').match(/(\d+(?:[.,]\d+)?)\s*%?/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n / 100 : null;
}

const ANCHOR_RE = /\b(top|bottom|tren|tr[eê]n|d[uư][oơ]i|duoi)\b\s*(\d+(?:[.,]\d+)?)\s*%?/i;

/**
 * The `slide_*` value: `20% 20%, top 20%`. Every part optional.
 *
 * Returns insets as fractions (NOT resolved into from/to positions -- which
 * edge each one counts from depends on which of the two slide tags it came
 * from, and that is the caller's business), plus the anchor as the CENTRE of
 * the named band, normalised against the picture.
 *
 *   top 20%    -> band [0, 0.2]    -> anchorY 0.1
 *   bottom 20% -> band [0.8, 1]    -> anchorY 0.9
 *
 * The anchor clause is pulled out FIRST, so its own percentage can never be
 * mistaken for one of the two insets no matter which order they were written
 * in. Anything left over that isn't a number is reported, not guessed at.
 */
export function parseSlideValue(value) {
  const warnings = [];
  let text = String(value ?? '').trim();
  if (!text) return { warnings };

  let anchorY;
  const anchorMatch = text.match(ANCHOR_RE);
  if (anchorMatch) {
    const fraction = Number(anchorMatch[2].replace(',', '.')) / 100;
    const fromTop = /^(top|tr[eê]n|tren)$/i.test(anchorMatch[1]);
    if (fraction > 0 && fraction <= 1) {
      anchorY = fromTop ? fraction / 2 : 1 - fraction / 2;
    } else {
      warnings.push(`slide anchor "${anchorMatch[0].trim()}" is not between 0% and 100% -- ignored`);
    }
    text = text.replace(ANCHOR_RE, ' ');
  }

  const numbers = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*%?/g)].map((m) =>
    Number(m[1].replace(',', '.')) / 100
  );
  const leftovers = text
    .replace(/[\d.,%\s|]+/g, ' ')
    .trim();
  if (leftovers) {
    warnings.push(`didn't understand "${leftovers}" in the slide value -- ignored`);
  }

  if (numbers.length > 2) {
    warnings.push(`slide takes at most two insets, got ${numbers.length} -- using the first two`);
  }

  return {
    ...(numbers.length > 0 ? { startInset: numbers[0] } : {}),
    ...(numbers.length > 1 ? { endInset: numbers[1] } : {}),
    ...(anchorY !== undefined ? { anchorY } : {}),
    warnings,
  };
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
