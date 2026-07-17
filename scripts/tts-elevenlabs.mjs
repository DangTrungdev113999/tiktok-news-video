#!/usr/bin/env node
// scripts/tts-elevenlabs.mjs
//
// Path 1 of the design spec's audio pipeline (docs/superpowers/specs/
// 2026-07-17-tiktok-news-video-design.md, Section D): no user-provided MP3
// -> synthesize the whole approved script in ONE ElevenLabs v3 call and
// derive per-scene {startSec, endSec} from the returned character timestamps.
// Algorithm is exactly `knowledge/elevenlabs-v3-tts.md`'s "Single-request
// whole-script synthesis" section — read that doc before changing this file.
//
// Usage (CLI):
//   node scripts/tts-elevenlabs.mjs <scenes.json> <outAudio.mp3> <outTimings.json> [--mock] [--voice-id=...]
//   scenes.json: [{ "text": "...", "ttsText": "...[optional]" }, ...]
//
// Usage (import):
//   import { synthesizeScript } from './tts-elevenlabs.mjs'

import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(HERE);

// NOTE (checked again 2026-07-17 via ElevenLabs docs + web search): the
// `/with-timestamps` endpoint's documented OpenAPI schema only enumerates
// `eleven_multilingual_v2` as a model_id example, it does NOT explicitly
// list `eleven_v3`. Corroborating signal: third-party services (e.g.
// WaveSpeedAI's "Eleven V3 Timing") sell v3-plus-timestamps as their OWN
// product layered on top of ElevenLabs — that only makes sense to build if
// ElevenLabs' own `/with-timestamps` endpoint does NOT natively support v3.
// This is suggestive, not confirmed either way without a real API call.
// The design spec + knowledge doc both call for eleven_v3 (expressive
// model, audio tag support), so we use it here as instructed — but this is
// THE first thing to verify on the first real key run. If it 400s or the
// 1:1-alignment assertion below fails, the fallback is: synthesize with
// eleven_v3 (no timestamps), then run the resulting audio through
// align-audio.mjs's forced-alignment path (same machinery as the
// user-provided-MP3 case) to get per-scene timing instead of trusting a
// timestamped v3 call. Kept as a single constant so swapping model_id is a
// one-line change if v3 turns out unsupported here.
const MODEL_ID = 'eleven_v3';
const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75 };

const PAD_BEFORE_SEC = 0.06; // t0 = max(prevEnd, start - 0.06)
const PAD_AFTER_SEC = 0.10; // t1 = end + 0.10

// ---------------------------------------------------------------------------
// .env parsing (manual — no `dotenv` dependency, per task constraints)
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
    // Strip one layer of matching surrounding quotes, if present.
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
// Building the concatenated script + per-scene offset bookkeeping
// ---------------------------------------------------------------------------

const SEPARATOR = '\n\n';

/**
 * Build the single concatenated TTS string and record each scene's
 * [startOffset, endOffset) in that string *while building it* — never
 * re-search for scene text after the fact (that's the repeated-text bug
 * Path 2 exists to avoid).
 */
function buildConcatenatedScript(scenes) {
  let full = '';
  const offsets = []; // [{ start, end }] indices into `full`
  scenes.forEach((scene, i) => {
    const ttsText = scene.ttsText ?? scene.text ?? '';
    const start = full.length;
    full += ttsText;
    const end = full.length;
    offsets.push({ start, end });
    if (i < scenes.length - 1) full += SEPARATOR;
  });
  return { full, offsets };
}

/**
 * Given a scene's raw [start, end) char range (which may include a leading
 * `[tag]` run), find the first "spoken" character index — i.e. skip past any
 * number of leading `[...]` bracket groups (optionally separated by
 * whitespace), matching the knowledge doc's "bracket-depth scan".
 */
function findFirstSpokenCharIndex(full, start, end) {
  let i = start;
  while (i < end) {
    // Skip whitespace between tags / before speech.
    while (i < end && /\s/.test(full[i])) i++;
    if (i < end && full[i] === '[') {
      const close = full.indexOf(']', i);
      if (close === -1 || close >= end) {
        // Unclosed bracket within range — bail, treat rest as spoken.
        break;
      }
      i = close + 1;
      continue;
    }
    break;
  }
  return Math.min(i, end - 1 >= start ? end - 1 : start);
}

function findLastSpokenCharIndex(full, start, end) {
  // end is exclusive; last char index is end-1. Trailing whitespace doesn't
  // matter much for the "last char" timestamp, but trim it for cleanliness.
  let i = end - 1;
  while (i > start && /\s/.test(full[i])) i--;
  return Math.max(i, start);
}

// ---------------------------------------------------------------------------
// Live ElevenLabs call
// ---------------------------------------------------------------------------

async function callElevenLabsWithTimestamps({ text, voiceId, apiKey }) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: VOICE_SETTINGS,
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs TTS request failed (${res.status} ${res.statusText}): ${bodyText.slice(0, 500)}`);
  }

  const json = await res.json();
  if (!json.audio_base64) {
    throw new Error('ElevenLabs response missing audio_base64');
  }
  if (!json.alignment || !Array.isArray(json.alignment.characters)) {
    throw new Error('ElevenLabs response missing alignment.characters — cannot derive scene timing');
  }
  return json;
}

// ---------------------------------------------------------------------------
// Mock mode (no API key / --mock): silent audio sized by even char-count split
// ---------------------------------------------------------------------------

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`'ffmpeg' was not found on PATH. Run \`npm run init\` first.`));
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-800)}`));
      else resolve();
    });
  });
}

async function generateSilentAudio(outAudioPath, durationSec) {
  const dur = Math.max(0.5, durationSec);
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `anullsrc=channel_layout=mono:sample_rate=44100`,
    '-t', String(dur),
    '-q:a', '9',
    outAudioPath,
  ]);
}

/** Strip [tag] runs to estimate "spoken" character weight for mock timing. */
function stripTags(str) {
  return str.replace(/\[[^\]]*\]/g, '').trim();
}

function mockTimings(scenes, secondsPerChar = 0.06) {
  // Naive even-split-by-character-count estimate, purely so the rest of the
  // pipeline (Remotion spec.json, smoke test) has a real, playable interface
  // to exercise without a live key.
  const weights = scenes.map((s) => Math.max(1, stripTags(s.ttsText ?? s.text ?? '').length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const totalSec = Math.max(3, totalWeight * secondsPerChar);
  const timings = [];
  let cursor = 0;
  for (let i = 0; i < scenes.length; i++) {
    const share = (weights[i] / totalWeight) * totalSec;
    const startSec = cursor;
    const endSec = i === scenes.length - 1 ? totalSec : cursor + share;
    timings.push({ startSec: round3(startSec), endSec: round3(endSec) });
    cursor = endSec;
  }
  return { timings, totalSec };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * @param {Array<{text: string, ttsText?: string}>} scenes
 * @param {object} opts
 * @param {string} opts.outAudioPath - where to write the resulting mp3
 * @param {string} [opts.voiceId]
 * @param {string} [opts.apiKey]
 * @param {boolean} [opts.mock]
 * @returns {Promise<{ audioPath: string, timings: Array<{startSec:number,endSec:number}>, mode: 'live'|'mock' }>}
 */
export async function synthesizeScript(scenes, opts = {}) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error('synthesizeScript requires a non-empty scenes[] array');
  }
  const outAudioPath = opts.outAudioPath;
  if (!outAudioPath) throw new Error('opts.outAudioPath is required');

  const env = await readEnvFile();
  const apiKey = opts.apiKey ?? env.ELEVENLABS_API_KEY ?? '';
  const voiceId = opts.voiceId ?? env.ELEVENLABS_VOICE_ID ?? 'FHhpndubmejSghqiumSv';
  const useMock = Boolean(opts.mock) || !apiKey;

  if (useMock) {
    console.log(
      `[tts-elevenlabs] MOCK MODE ${opts.mock ? '(--mock flag)' : '(no ELEVENLABS_API_KEY found)'} — generating silent placeholder audio, timings are a naive even-split-by-character-count estimate, NOT real speech timing.`
    );
    const { timings, totalSec } = mockTimings(scenes);
    await generateSilentAudio(outAudioPath, totalSec);
    return { audioPath: outAudioPath, timings, mode: 'mock' };
  }

  console.log(`[tts-elevenlabs] LIVE MODE — calling ElevenLabs voice_id=${voiceId}, model=${MODEL_ID}`);

  const { full, offsets } = buildConcatenatedScript(scenes);
  const response = await callElevenLabsWithTimestamps({ text: full, voiceId, apiKey });

  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } =
    response.alignment;

  // Assert 1:1 mapping before trusting any offset math — if this doesn't
  // hold, every timestamp derived below is garbage.
  const joined = characters.join('');
  if (characters.length !== full.length || joined !== full) {
    throw new Error(
      `ElevenLabs alignment.characters (len=${characters.length}) does not map 1:1 onto the ` +
      `concatenated input string (len=${full.length}). Refusing to derive scene timing from ` +
      `misaligned data. This endpoint/model combo is not fully verified (see MODEL_ID comment ` +
      `above) — likely causes to check, in order: (1) accidentally reading ` +
      `\`normalized_alignment\` instead of \`alignment\` (normalized text is post-number-expansion ` +
      `and will never match raw offsets); (2) eleven_v3's \`/with-timestamps\` alignment may strip ` +
      `\`[tag]\` brackets instead of timing them silently as v2/turbo do — inspect \`characters\` ` +
      `around a known tag position to check; (3) the API may collapse/normalize whitespace ` +
      `(e.g. the \\n\\n scene separators) rather than echoing it verbatim. Compare \`joined\` ` +
      `against \`full\` character-by-character to see which of these it is.`
    );
  }

  // Write the actual audio out.
  const audioBuffer = Buffer.from(response.audio_base64, 'base64');
  await writeFile(outAudioPath, audioBuffer);

  // Derive per-scene timings from the character offsets recorded while
  // building the concatenated string.
  const timings = [];
  let prevEnd = 0;
  for (const { start, end } of offsets) {
    const firstSpoken = findFirstSpokenCharIndex(full, start, end);
    const lastSpoken = findLastSpokenCharIndex(full, start, end);
    const rawStart = starts[firstSpoken];
    const rawEnd = ends[lastSpoken];
    const t0 = Math.max(prevEnd, rawStart - PAD_BEFORE_SEC);
    const t1 = rawEnd + PAD_AFTER_SEC;
    timings.push({ startSec: round3(t0), endSec: round3(t1) });
    prevEnd = t1;
  }

  // Sanity check per knowledge doc §5: sum of scene durations should roughly
  // equal the full synthesized audio duration (±2s). We don't have a hard
  // "full audio duration" from the API response directly, so approximate it
  // with the last character's end time.
  const audioDurationEstimate = ends[ends.length - 1] ?? 0;
  const sumDurations = timings.reduce((acc, t) => acc + (t.endSec - t.startSec), 0);
  if (Math.abs(sumDurations - audioDurationEstimate) > 2) {
    console.warn(
      `[tts-elevenlabs] WARNING: sum of scene durations (${sumDurations.toFixed(2)}s) differs from ` +
      `estimated audio duration (${audioDurationEstimate.toFixed(2)}s) by more than 2s — possible ` +
      `mis-alignment, please review before rendering.`
    );
  }

  return { audioPath: outAudioPath, timings, mode: 'live' };
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

  const [scenesPath, outAudioPath, outTimingsPath] = positional;
  if (!scenesPath || !outAudioPath || !outTimingsPath) {
    console.error(
      'Usage: node scripts/tts-elevenlabs.mjs <scenes.json> <outAudio.mp3> <outTimings.json> [--mock] [--voice-id=...]'
    );
    process.exit(1);
  }

  const scenes = JSON.parse(await readFile(path.resolve(scenesPath), 'utf8'));

  synthesizeScript(scenes, {
    outAudioPath: path.resolve(outAudioPath),
    voiceId: flags['voice-id'],
    mock: Boolean(flags.mock),
  })
    .then(async ({ audioPath, timings, mode }) => {
      await writeFile(path.resolve(outTimingsPath), JSON.stringify(timings, null, 2));
      console.log(`[tts-elevenlabs] mode=${mode} audio=${audioPath} timings=${outTimingsPath}`);
      console.log(JSON.stringify(timings, null, 2));
    })
    .catch((err) => {
      console.error(`[tts-elevenlabs] ERROR: ${err.message}`);
      process.exit(1);
    });
}
