#!/usr/bin/env node
// scripts/align-audio.mjs
//
// Path 2 of the design spec's audio pipeline (docs/superpowers/specs/
// 2026-07-17-tiktok-news-video-design.md, Section D): user provided their
// own MP3 narration. We do NOT transcribe-then-fuzzy-match against the
// script (that breaks on Vietnamese diacritics/homophones per the spec) —
// instead we get word-level timestamps for the ACTUAL audio and walk them
// IN ORDER against the known, scene-segmented script text. Output shape
// must match scripts/tts-elevenlabs.mjs's: an array of
// { startSec, endSec } per scene, one entry per input scene, in order.
//
// Usage (CLI):
//   node scripts/align-audio.mjs <audio.mp3> <sceneTexts.json> <outTimings.json> [--mock]
//   sceneTexts.json: ["scene 1 text", "scene 2 text", ...] OR [{ "text": "..." }, ...]
//
// Usage (import):
//   import { alignAudioToScenes, transcribeWithTimestamps } from './align-audio.mjs'

import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_DIR } from './workspace.mjs';

const PAD_BEFORE_SEC = 0.06; // same convention as tts-elevenlabs.mjs, for a
const PAD_AFTER_SEC = 0.10; // consistent converged timing shape (Section D)

// ---------------------------------------------------------------------------
// .env parsing (manual — no `dotenv` dependency; duplicated from
// tts-elevenlabs.mjs on purpose, these are two independently invokable CLI
// scripts and the task scope is 4 standalone files, not a shared lib)
// ---------------------------------------------------------------------------

async function readEnvFile(configDir = CONFIG_DIR) {
  const envPath = path.join(configDir, '.env');
  let raw;
  try {
    raw = await readFile(envPath, 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transcription providers — structured so swapping ElevenLabs Scribe for a
// local Whisper fallback later is a one-function change (per the design
// spec's fallback plan: "local Whisper (large-v3) forced-alignment via
// whisper-timestamped or stable-ts").
//
// Both implementations must resolve to the SAME normalized shape:
//   Array<{ word: string, start: number, end: number }>   (seconds)
// ---------------------------------------------------------------------------

/**
 * ElevenLabs Speech-to-Text (Scribe). Endpoint/params verified against
 * ElevenLabs' current docs (fetched 2026-07-17):
 *   POST https://api.elevenlabs.io/v1/speech-to-text
 *   multipart/form-data: model_id ("scribe_v1" or "scribe_v2"), file,
 *   timestamps_granularity ("word"|"character"|"none"), language_code (optional).
 *   Response: { language_code, text, words: [{ text, start, end, type }] }
 *   (type is "word" or "spacing" — filter to "word" only).
 * UNVERIFIED (flagged per design spec Section D): Vietnamese transcription
 * accuracy for Scribe is not confirmed in the docs — this is the "to be
 * verified during implementation" item the spec calls out. If Vietnamese
 * word timing/accuracy proves unreliable in real testing, swap this
 * function's call site (in `transcribeWithTimestamps` below) for a Whisper
 * implementation — the rest of the pipeline (matching, padding) is
 * provider-agnostic.
 */
async function transcribeWithElevenLabsScribe(audioPath, { apiKey }) {
  const fileBuffer = await readFile(audioPath);
  // Content-Type is intentionally NOT set manually below — `fetch` computes
  // the correct multipart boundary itself. Setting it by hand silently
  // corrupts the upload.
  const blob = new Blob([fileBuffer]);
  const form = new FormData();
  // scribe_v1 is listed as DEPRECATED on ElevenLabs' current models page
  // (checked 2026-07-17); scribe_v2 is the current model. Vietnamese
  // word-timing accuracy on scribe_v2 is still unverified (no live key
  // available in this environment) -- confirm on first real run.
  form.append('model_id', 'scribe_v2');
  form.append('timestamps_granularity', 'word');
  form.append('file', blob, path.basename(audioPath));

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs Speech-to-Text request failed (${res.status} ${res.statusText}): ${bodyText.slice(0, 500)}`);
  }

  const json = await res.json();
  if (!Array.isArray(json.words)) {
    throw new Error('ElevenLabs Speech-to-Text response missing words[]');
  }

  return json.words
    .filter((w) => w.type === 'word' || w.type === undefined)
    .map((w) => ({ word: String(w.text ?? '').trim(), start: Number(w.start), end: Number(w.end) }))
    .filter((w) => w.word.length > 0);
}

/**
 * Placeholder for the documented fallback path. Not implemented in v1 —
 * wire this in if ElevenLabs Scribe's Vietnamese word timing proves
 * unreliable during real testing (design spec Section D fallback note).
 * Should resolve to the same Array<{word,start,end}> shape as the ElevenLabs
 * implementation above so `transcribeWithTimestamps` can swap providers
 * without touching the matching logic.
 */
async function transcribeWithWhisper(_audioPath, _opts) {
  throw new Error(
    'Whisper fallback (whisper-timestamped / stable-ts) is not implemented yet. ' +
    'See docs/superpowers/specs/2026-07-17-tiktok-news-video-design.md Section D for the plan.'
  );
}

/**
 * Provider-agnostic entry point used by alignAudioToScenes(). Defaults to
 * ElevenLabs Scribe; pass { provider: 'whisper' } once that's implemented.
 * @returns {Promise<Array<{word:string,start:number,end:number}>>}
 */
export async function transcribeWithTimestamps(audioPath, opts = {}) {
  const provider = opts.provider ?? 'elevenlabs';
  if (provider === 'elevenlabs') {
    return transcribeWithElevenLabsScribe(audioPath, opts);
  }
  if (provider === 'whisper') {
    return transcribeWithWhisper(audioPath, opts);
  }
  throw new Error(`Unknown transcription provider: ${provider}`);
}

// ---------------------------------------------------------------------------
// Sequential word matching (NOT global fuzzy search — walks forward only, so
// repeated words/phrases across scenes can't cause a match to jump backward
// or skip ahead to the wrong occurrence).
// ---------------------------------------------------------------------------

/** Lowercase, strip punctuation, collapse whitespace. Keeps Vietnamese diacritics. */
function normalizeWord(w) {
  return String(w)
    .toLowerCase()
    .normalize('NFC')
    .replace(/[.,!?;:"'“”‘’()\[\]{}…\-–—]/g, '')
    .trim();
}

function tokenize(text) {
  return String(text)
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean);
}

// Needleman-Wunsch scores. Only their ratios matter. A match must be worth
// more than two gaps, otherwise the optimal path prefers skipping both sides
// over pairing words that genuinely correspond.
const SCORE_MATCH = 2;
const SCORE_MISMATCH = -1;
const SCORE_GAP = -1;

/**
 * Globally align two normalized token sequences and return, for each token of
 * `a`, the index in `b` it pairs with (or -1 where it aligns to a gap).
 *
 * O(n*m) time and memory. For this pipeline that is a few hundred by a few
 * hundred -- around 150k cells for a 90-second script -- so the simple full
 * matrix is the right call over any banded or linear-space variant.
 */
function globalAlign(a, b) {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const score = new Float64Array((n + 1) * width);
  // 0 = diagonal (pair), 1 = up (a consumed, gap in b), 2 = left (b consumed)
  const back = new Uint8Array((n + 1) * width);

  for (let i = 1; i <= n; i++) {
    score[i * width] = i * SCORE_GAP;
    back[i * width] = 1;
  }
  for (let j = 1; j <= m; j++) {
    score[j] = j * SCORE_GAP;
    back[j] = 2;
  }

  for (let i = 1; i <= n; i++) {
    const ai = a[i - 1];
    const row = i * width;
    const prevRow = row - width;
    for (let j = 1; j <= m; j++) {
      const diag = score[prevRow + j - 1] + (ai === b[j - 1] ? SCORE_MATCH : SCORE_MISMATCH);
      const up = score[prevRow + j] + SCORE_GAP;
      const left = score[row + j - 1] + SCORE_GAP;
      let best = diag;
      let dir = 0;
      if (up > best) { best = up; dir = 1; }
      if (left > best) { best = left; dir = 2; }
      score[row + j] = best;
      back[row + j] = dir;
    }
  }

  const pairedWith = new Int32Array(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const dir = back[i * width + j];
    if (i > 0 && j > 0 && dir === 0) {
      // Only record a pairing when the tokens actually agree. A mismatch step
      // still advances both sides -- that is how the alignment absorbs a
      // misheard word -- but it must not be treated as a located anchor.
      if (a[i - 1] === b[j - 1]) pairedWith[i - 1] = j - 1;
      i--; j--;
    } else if (i > 0 && (dir === 1 || j === 0)) {
      i--;
    } else {
      j--;
    }
  }
  return pairedWith;
}

/**
 * Walk `transcriptWords` against `sceneTexts` and return one raw
 * {startSec, endSec} span per scene (no padding applied yet).
 *
 * Uses a GLOBAL alignment, not a greedy forward walk, and the difference is
 * not academic. The greedy version searched a 12-word lookahead window and,
 * on a miss, advanced one position blind. A single bad stretch shifted the
 * cursor permanently -- there was no mechanism to ever recover -- so the error
 * compounded scene after scene. Measured on the 2026-07-21 Hạnh narration:
 * scene 10 opened mid-sentence, scene 12 was reading scene 13's words, and
 * scene 13 collapsed to a single word and ZERO duration.
 *
 * The trigger there was numerals. A script says `24`, `207`, `2019`; speech-
 * to-text hears "hai mươi tư", "hai trăm lẻ bảy", "hai nghìn không trăm mười
 * chín". One script token against three transcript tokens, repeatedly. A
 * global alignment charges those as gaps and carries on correctly aligned;
 * a greedy cursor treats them as position debt it never repays.
 */
function matchWordsToScenes(transcriptWords, sceneTexts) {
  const normTranscript = transcriptWords.map((w) => normalizeWord(w.word));

  // Flatten every scene's tokens into one sequence, remembering which scene
  // each token came from -- the alignment must see the script as one
  // continuous utterance, exactly as it was spoken.
  const scriptTokens = [];
  const tokenScene = [];
  sceneTexts.forEach((text, sceneIdx) => {
    for (const t of tokenize(text)) {
      scriptTokens.push(t);
      tokenScene.push(sceneIdx);
    }
  });

  if (scriptTokens.length === 0 || transcriptWords.length === 0) {
    return sceneTexts.map(() => ({ startIdx: 0, endIdx: 0, start: 0, end: 0 }));
  }

  const pairedWith = globalAlign(scriptTokens, normTranscript);

  // Per scene, the first and last transcript indices any of its tokens landed on.
  const firstIdx = sceneTexts.map(() => -1);
  const lastIdx = sceneTexts.map(() => -1);
  for (let k = 0; k < pairedWith.length; k++) {
    const j = pairedWith[k];
    if (j < 0) continue;
    const s = tokenScene[k];
    if (firstIdx[s] === -1) firstIdx[s] = j;
    lastIdx[s] = j;
  }

  // A scene where nothing matched (all its words misheard) gets wedged between
  // its neighbours rather than dropped, so the timeline stays ordered and
  // total.
  for (let s = 0; s < sceneTexts.length; s++) {
    if (firstIdx[s] !== -1) continue;
    let prev = -1;
    for (let t = s - 1; t >= 0; t--) if (lastIdx[t] !== -1) { prev = lastIdx[t]; break; }
    let next = transcriptWords.length - 1;
    for (let t = s + 1; t < sceneTexts.length; t++) if (firstIdx[t] !== -1) { next = firstIdx[t]; break; }
    const anchor = Math.min(Math.max(prev + 1, 0), next);
    firstIdx[s] = anchor;
    lastIdx[s] = anchor;
  }

  // Enforce monotonic, non-overlapping spans. The alignment is monotonic by
  // construction, but a scene whose only matches were spurious could still
  // reach backwards; clamping here means downstream code never has to wonder.
  const spans = [];
  let floor = 0;
  for (let s = 0; s < sceneTexts.length; s++) {
    const startIdx = Math.min(Math.max(firstIdx[s], floor), transcriptWords.length - 1);
    const endIdx = Math.min(Math.max(lastIdx[s], startIdx), transcriptWords.length - 1);
    spans.push({
      startIdx,
      endIdx,
      start: transcriptWords[startIdx].start,
      end: transcriptWords[endIdx].end,
    });
    floor = endIdx + 1 <= transcriptWords.length - 1 ? endIdx + 1 : endIdx;
  }
  return spans;
}

/**
 * Slice per-scene word-level timing out of the full transcript, for karaoke
 * captions. Timestamps are absolute seconds within the provided audio (the
 * same timeline the narration track plays from frame 0), NOT gap-closed like
 * `timings` — captions must track real speech, not an extended scene hold.
 * @returns {Array<Array<{text:string,startSec:number,endSec:number}>>}
 */
function extractWordsFromSpans(transcriptWords, spans) {
  return spans.map(({ startIdx, endIdx }) =>
    transcriptWords
      .slice(startIdx, endIdx + 1)
      .map((w) => ({ text: w.word, startSec: round3(w.start), endSec: round3(w.end) }))
      .filter((w) => w.text.length > 0)
  );
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function applyPadding(spans) {
  const timings = [];
  let prevEnd = 0;
  for (const span of spans) {
    const t0 = Math.max(prevEnd, span.start - PAD_BEFORE_SEC);
    const t1 = span.end + PAD_AFTER_SEC;
    timings.push({ startSec: round3(t0), endSec: round3(t1) });
    prevEnd = t1;
  }
  return timings;
}

// ---------------------------------------------------------------------------
// ffprobe duration helper + mock mode
// ---------------------------------------------------------------------------

async function probeAudioDurationSec(audioPath) {
  // probeAsset() classifies image-vs-video via its ffprobe video-stream
  // heuristic, which doesn't apply to audio-only files. Do a minimal,
  // audio-specific ffprobe call here instead.
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`'ffprobe' was not found on PATH. Run \`npm run init\` first.`));
      } else reject(err);
    });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited with code ${code}: ${stderr.trim()}`));
      const dur = parseFloat(stdout.trim());
      if (!Number.isFinite(dur)) return reject(new Error(`Could not parse audio duration for ${audioPath}`));
      resolve(dur);
    });
  });
}

/**
 * Mock mode: no live STT call. Probe the REAL provided audio's duration with
 * ffprobe (not fabricated) and split it proportionally by each scene's word
 * count — "even-split-by-duration" of the actual known audio length, so the
 * ±2s sanity check downstream stays meaningful even without a live key.
 */
function mockTimingsFromDuration(sceneTexts, totalDurationSec) {
  const weights = sceneTexts.map((t) => Math.max(1, tokenize(t).length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const timings = [];
  let cursor = 0;
  for (let i = 0; i < sceneTexts.length; i++) {
    const share = (weights[i] / totalWeight) * totalDurationSec;
    const startSec = cursor;
    const endSec = i === sceneTexts.length - 1 ? totalDurationSec : cursor + share;
    timings.push({ startSec: round3(startSec), endSec: round3(endSec) });
    cursor = endSec;
  }
  return timings;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * @param {string} audioPath - path to the user-provided MP3
 * @param {Array<string|{text:string}>} sceneTexts - ordered scene texts
 * @param {object} [opts]
 * @param {boolean} [opts.mock]
 * @param {string} [opts.apiKey]
 * @returns {Promise<{ timings: Array<{startSec:number,endSec:number}>, words: Array<Array<{text:string,startSec:number,endSec:number}>>, mode: 'live'|'mock' }>}
 *   `words` is one array per scene (same order/length as `timings`) — empty
 *   per-scene arrays in mock mode (no real transcript to slice words from).
 */
export async function alignAudioToScenes(audioPath, sceneTexts, opts = {}) {
  if (!Array.isArray(sceneTexts) || sceneTexts.length === 0) {
    throw new Error('alignAudioToScenes requires a non-empty sceneTexts[] array');
  }
  const texts = sceneTexts.map((s) => (typeof s === 'string' ? s : s.text ?? ''));

  const env = await readEnvFile();
  const apiKey = opts.apiKey ?? env.ELEVENLABS_API_KEY ?? '';
  const useMock = Boolean(opts.mock) || !apiKey;

  const totalDurationSec = await probeAudioDurationSec(audioPath);

  if (useMock) {
    console.log(
      `[align-audio] MOCK MODE ${opts.mock ? '(--mock flag)' : '(no ELEVENLABS_API_KEY found)'} — ` +
      `using real probed duration (${totalDurationSec.toFixed(2)}s) split proportionally by word ` +
      `count per scene. NOT real forced alignment.`
    );
    const timings = mockTimingsFromDuration(texts, totalDurationSec);
    return { timings, words: texts.map(() => []), mode: 'mock' };
  }

  console.log('[align-audio] LIVE MODE — calling ElevenLabs Speech-to-Text (Scribe)');
  const transcriptWords = await transcribeWithTimestamps(audioPath, { apiKey, provider: 'elevenlabs' });
  if (transcriptWords.length === 0) {
    throw new Error('Transcription returned zero words — cannot align scenes to empty transcript');
  }

  const spans = matchWordsToScenes(transcriptWords, texts);
  const timings = applyPadding(spans);
  const words = extractWordsFromSpans(transcriptWords, spans);

  // Sanity check per design spec Section I: sum of scene durations should
  // roughly match total audio duration (±2s) — flag rather than silently
  // ship a likely mis-alignment.
  // Per-scene check FIRST, because the total-duration check below cannot see
  // this class of failure at all: when a scene's words get swallowed by its
  // neighbour, the spans still tile the audio perfectly and the totals still
  // agree. That is exactly how the 2026-07-21 misalignment shipped a scene 13
  // of ZERO seconds without tripping any warning.
  const starved = timings
    .map((t, i) => ({ i, sec: t.endSec - t.startSec, words: words[i].length }))
    .filter((s) => s.sec < 0.5 || s.words < 2);
  if (starved.length > 0) {
    console.warn(
      `[align-audio] WARNING: ${starved.length} scene(s) got almost no audio — ` +
      starved.map((s) => `#${s.i + 1} (${s.sec.toFixed(2)}s, ${s.words} words)`).join(', ') +
      `. That usually means the transcript drifted and a neighbouring scene ate their words. ` +
      `Check the script for numerals (24, 207, 2019): speech-to-text spells them out, so one ` +
      `script token can face several transcript tokens.`
    );
  }

  const sumDurations = timings.reduce((acc, t) => acc + (t.endSec - t.startSec), 0);
  if (Math.abs(sumDurations - totalDurationSec) > 2) {
    console.warn(
      `[align-audio] WARNING: sum of scene durations (${sumDurations.toFixed(2)}s) differs from ` +
      `actual audio duration (${totalDurationSec.toFixed(2)}s) by more than 2s — possible ` +
      `mis-alignment, please review before rendering.`
    );
  }

  return { timings, words, mode: 'live' };
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
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const flags = Object.fromEntries(
    args
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [k, v] = a.slice(2).split('=');
        return [k, v ?? true];
      })
  );

  const [audioPath, sceneTextsPath, outTimingsPath, outWordsPath] = positional;
  if (!audioPath || !sceneTextsPath || !outTimingsPath) {
    console.error('Usage: node scripts/align-audio.mjs <audio.mp3> <sceneTexts.json> <outTimings.json> [outWords.json] [--mock]');
    process.exit(1);
  }

  const sceneTexts = JSON.parse(await readFile(path.resolve(sceneTextsPath), 'utf8'));

  alignAudioToScenes(path.resolve(audioPath), sceneTexts, { mock: Boolean(flags.mock) })
    .then(async ({ timings, words, mode }) => {
      await writeFile(path.resolve(outTimingsPath), JSON.stringify(timings, null, 2));
      if (outWordsPath) await writeFile(path.resolve(outWordsPath), JSON.stringify(words, null, 2));
      console.log(`[align-audio] mode=${mode} timings=${outTimingsPath}`);
      console.log(JSON.stringify(timings, null, 2));
    })
    .catch((err) => {
      console.error(`[align-audio] ERROR: ${err.message}`);
      process.exit(1);
    });
}
