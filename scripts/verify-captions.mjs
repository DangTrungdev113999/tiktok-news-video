#!/usr/bin/env node
// scripts/verify-captions.mjs
//
// Does the karaoke say what the author wrote?
//
// This exists because on 2026-07-21 a video shipped with captions reading
// "Tinh Hà X2" for "Tinh Hà Say Hi", "DatViet Work" for "DatVietVAC", and
// every numeral spelled out -- "hai mươi tư" where the script said "24". The
// forced-alignment path was building caption text out of the speech-to-text
// transcript instead of out of the script.
//
// Every check that ran that day passed. The black-band scan, the safe-zone
// measurement and the smoke test all measure GEOMETRY; not one of them reads
// a character. That is the hole this fills, and it is why the check is a
// script rather than a line of advice in a reference file: prose asking a
// future agent to "check the captions" is exactly what was already there.
//
// Usage:
//   node scripts/verify-captions.mjs <spec.json> <sceneTexts.json>
//     sceneTexts.json: ["screen 1 text", ...] or [{ "text": "..." }, ...]
//                      IN SCREEN ORDER, including the hook screen.
//
// Exit code 0 = captions are the author's words. 1 = they are not.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Compare the way the renderer will: ignore case and punctuation, keep
 * Vietnamese diacritics, and keep digits as digits.
 *
 * Diacritics matter -- "hình ảnh" against "hinh anh" is a real defect, not a
 * formatting difference. Digits matter most of all: collapsing them is what
 * would hide the exact bug this script was written for.
 */
function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFC')
    .replace(/[.,!?;:"'“”‘’()\[\]{}…\-–—]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The spec's caption groups are a flat list across the whole video, so they
 * cannot be attributed to a screen without re-deriving the chunking. Compare
 * the full stream instead: concatenate every caption word in order and check
 * it against every script word in order, skipping the hook screen (which is
 * deliberately caption-free -- see hook-and-brand.md).
 */
export function verifyCaptions(spec, sceneTexts, { hookScreenIndex = 0 } = {}) {
  const captionWords = (spec.captions ?? []).flatMap((group) =>
    (group.words ?? []).flatMap((w) => normalize(w.text))
  );

  // Which script screens to leave out of the comparison: the hook, plus any
  // screen the hook was held over (those show the hook headline, not captions).
  // build-spec.mjs records them on the spec; fall back to just the hook screen
  // for specs written before that field existed.
  const skip = new Set(
    Array.isArray(spec.captionSkipScreens) ? spec.captionSkipScreens : [hookScreenIndex]
  );

  const scriptWords = sceneTexts
    .map((s, i) => ({ text: typeof s === 'string' ? s : s.text ?? '', i }))
    .filter(({ i }) => !skip.has(i))
    .flatMap(({ text }) => normalize(text));

  const diffs = [];
  const n = Math.max(captionWords.length, scriptWords.length);
  for (let k = 0; k < n; k++) {
    if (captionWords[k] !== scriptWords[k]) {
      diffs.push({
        at: k,
        script: scriptWords[k] ?? '(hết chữ)',
        caption: captionWords[k] ?? '(hết chữ)',
        context: scriptWords.slice(Math.max(0, k - 4), k + 4).join(' '),
      });
      if (diffs.length >= 20) break; // enough to diagnose; the rest is noise
    }
  }

  return { ok: diffs.length === 0, captionWordCount: captionWords.length, scriptWordCount: scriptWords.length, diffs };
}

function isMain() {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  const [specPath, textsPath] = process.argv.slice(2);
  if (!specPath || !textsPath) {
    console.error('Usage: node scripts/verify-captions.mjs <spec.json> <sceneTexts.json>');
    process.exit(1);
  }
  const spec = JSON.parse(await readFile(path.resolve(specPath), 'utf8'));
  const texts = JSON.parse(await readFile(path.resolve(textsPath), 'utf8'));
  const result = verifyCaptions(spec, texts);

  console.log(`[verify-captions] ${result.captionWordCount} caption words vs ${result.scriptWordCount} script words`);
  if (result.ok) {
    console.log('[verify-captions] PASS — the karaoke is the author\'s words.');
    process.exit(0);
  }
  console.error(`[verify-captions] FAIL — ${result.diffs.length} mismatch(es):`);
  for (const d of result.diffs) {
    console.error(`  #${d.at}  script "${d.script}"  ->  caption "${d.caption}"`);
    console.error(`         around: ...${d.context}...`);
  }
  console.error(
    '\nOn the user-MP3 path this usually means caption text came from the transcript\n' +
    'instead of the script. Do not ship it: the author will read their own words back\n' +
    'as whatever speech-to-text guessed.'
  );
  process.exit(1);
}
