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
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(HERE);

const PAD_BEFORE_SEC = 0.06; // same convention as tts-elevenlabs.mjs, for a
const PAD_AFTER_SEC = 0.10; // consistent converged timing shape (Section D)

// ---------------------------------------------------------------------------
// .env parsing (manual — no `dotenv` dependency; duplicated from
// tts-elevenlabs.mjs on purpose, these are two independently invokable CLI
// scripts and the task scope is 4 standalone files, not a shared lib)
// ---------------------------------------------------------------------------

async function readEnvFile(repoRoot = REPO_ROOT) {
  const envPath = path.join(repoRoot, '.env');
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

const LOOKAHEAD = 12; // how far forward to search for a word match before giving up and advancing positionally

/**
 * Walk `transcriptWords` (in order) against `sceneTexts` (in order) and
 * return one raw {startSec, endSec} span per scene (no padding applied yet).
 */
function matchWordsToScenes(transcriptWords, sceneTexts) {
  const normTranscript = transcriptWords.map((w) => normalizeWord(w.word));
  let cursor = 0; // pointer into transcriptWords
  const spans = [];

  for (const sceneText of sceneTexts) {
    const sceneWords = tokenize(sceneText);
    if (sceneWords.length === 0 || transcriptWords.length === 0) {
      // Degenerate case (empty scene text, or ran out of transcript words) —
      // collapse to a zero-length span anchored at the current cursor so
      // downstream padding still produces a valid, ordered timeline.
      const anchorIdx = Math.min(cursor, transcriptWords.length - 1);
      const anchor = transcriptWords[anchorIdx] ?? { start: 0, end: 0 };
      spans.push({ startIdx: anchorIdx, endIdx: anchorIdx, start: anchor.start, end: anchor.end });
      continue;
    }

    let startIdx = null;
    let lastMatchedIdx = cursor;

    for (const target of sceneWords) {
      let found = -1;
      const windowEnd = Math.min(normTranscript.length, cursor + LOOKAHEAD);
      for (let j = cursor; j < windowEnd; j++) {
        if (normTranscript[j] === target) {
          found = j;
          break;
        }
      }
      if (found === -1) {
        // No match nearby — advance positionally by one so we still make
        // forward progress without a text match (best-effort degrade).
        if (startIdx === null) startIdx = cursor;
        lastMatchedIdx = Math.min(cursor, transcriptWords.length - 1);
        cursor = Math.min(cursor + 1, transcriptWords.length - 1);
      } else {
        if (startIdx === null) startIdx = found;
        lastMatchedIdx = found;
        cursor = found + 1;
      }
    }

    const endIdx = Math.max(lastMatchedIdx, startIdx);
    spans.push({
      startIdx,
      endIdx,
      start: transcriptWords[startIdx].start,
      end: transcriptWords[endIdx].end,
    });
  }

  return spans;
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
 * @returns {Promise<{ timings: Array<{startSec:number,endSec:number}>, mode: 'live'|'mock' }>}
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
    return { timings, mode: 'mock' };
  }

  console.log('[align-audio] LIVE MODE — calling ElevenLabs Speech-to-Text (Scribe)');
  const words = await transcribeWithTimestamps(audioPath, { apiKey, provider: 'elevenlabs' });
  if (words.length === 0) {
    throw new Error('Transcription returned zero words — cannot align scenes to empty transcript');
  }

  const spans = matchWordsToScenes(words, texts);
  const timings = applyPadding(spans);

  // Sanity check per design spec Section I: sum of scene durations should
  // roughly match total audio duration (±2s) — flag rather than silently
  // ship a likely mis-alignment.
  const sumDurations = timings.reduce((acc, t) => acc + (t.endSec - t.startSec), 0);
  if (Math.abs(sumDurations - totalDurationSec) > 2) {
    console.warn(
      `[align-audio] WARNING: sum of scene durations (${sumDurations.toFixed(2)}s) differs from ` +
      `actual audio duration (${totalDurationSec.toFixed(2)}s) by more than 2s — possible ` +
      `mis-alignment, please review before rendering.`
    );
  }

  return { timings, mode: 'live' };
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

  const [audioPath, sceneTextsPath, outTimingsPath] = positional;
  if (!audioPath || !sceneTextsPath || !outTimingsPath) {
    console.error('Usage: node scripts/align-audio.mjs <audio.mp3> <sceneTexts.json> <outTimings.json> [--mock]');
    process.exit(1);
  }

  const sceneTexts = JSON.parse(await readFile(path.resolve(sceneTextsPath), 'utf8'));

  alignAudioToScenes(path.resolve(audioPath), sceneTexts, { mock: Boolean(flags.mock) })
    .then(async ({ timings, mode }) => {
      await writeFile(path.resolve(outTimingsPath), JSON.stringify(timings, null, 2));
      console.log(`[align-audio] mode=${mode} timings=${outTimingsPath}`);
      console.log(JSON.stringify(timings, null, 2));
    })
    .catch((err) => {
      console.error(`[align-audio] ERROR: ${err.message}`);
      process.exit(1);
    });
}
