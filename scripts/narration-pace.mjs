#!/usr/bin/env node
// scripts/narration-pace.mjs
//
// ONE table describing how much the narration gets sped up, shared by the
// init prompt and by the TTS path, so the choice a user makes and the number
// the pipeline applies cannot drift apart.
//
// WHY THIS EXISTS AT ALL -- `eleven_v3` ignores `voice_settings.speed`.
// Measured 2026-07-21, same sentence, same voice, three repeats per setting:
//
//     speed 0.7 -> 12.88 / 12.56 / 11.84 s   (mean 12.43)
//     speed 1.0 -> 12.64 / 12.88 / 12.48 s   (mean 12.67)
//     speed 1.2 -> 13.28 / 12.56 / 12.88 s   (mean 12.91)
//
// A working `speed` would make the 0.7 take roughly 1.7x the length of the
// 1.2 take -- about 21s against 12s. Instead all three sit inside 12.4-12.9s
// and the means drift the WRONG way, well within v3's own run-to-run spread
// (11.84 to 13.28 across identical calls). The parameter does nothing.
//
// So with v3, pace can only come from a time-stretch after synthesis.
// `ffmpeg`'s atempo preserves pitch (no chipmunk) but is WSOLA underneath:
// it works by overlapping and re-splicing waveform windows, and the harder
// you push it the more that shows up as a slight warble on held vowels and
// clipped breaths between clauses.
//
// The alternative is a different model. `eleven_turbo_v2_5` and
// `eleven_flash_v2_5` both honour `speed` AND support Vietnamese. What they
// do NOT support is v3's audio tags -- `[excited]`, `[emphasized]` -- which
// they would read out loud as literal text.
//
// AND THE TRAP THAT COST A ROUND OF WORK: `eleven_multilingual_v2` honours
// `speed` but does NOT support Vietnamese. `GET /v1/models` is explicit --
// 29 languages, no `vi` -- and the samples came back pronouncing Vietnamese
// with some other language's phonetics. The author heard it instantly.
// Before ever proposing a model, check `vi` is in its `languages`.
// A model that reads fast in the wrong language is worth nothing.

import { spawn } from 'node:child_process';
import { binaryPath, missingMessage } from './ffmpeg-path.mjs';

/**
 * The levels offered at init. Labels are the author's ("2x".."5x"); the real
 * atempo factor is `tempo`. The labels are deliberately NOT literal
 * multipliers -- "5x" means the fifth notch, 1.5x -- so every place that
 * shows a label to a user MUST show `tempo` and `describe()` alongside it.
 */
export const PACE_LEVELS = [
  { label: 'none', tempo: 1.0 },
  { label: '2x', tempo: 1.2 },
  { label: '3x', tempo: 1.3 },
  { label: '4x', tempo: 1.4 },
  { label: '5x', tempo: 1.5 },
];

export const DEFAULT_PACE_LABEL = '4x';

/** Speech rate of an unstretched v3 Vietnamese take, words per minute. */
const TYPICAL_RAW_WPM = 193;

/** Look up a level by label. Unknown or missing label falls back to `none`. */
export function paceLevel(label) {
  return PACE_LEVELS.find((l) => l.label === label) ?? PACE_LEVELS[0];
}

/**
 * A one-line, honest description of what a level does, for the init prompt.
 * Quotes a real speech rate rather than a bare multiplier, because "2x"
 * meaning 1.2x is misleading on its face.
 */
export function describe(level) {
  if (level.tempo === 1) {
    return `giữ nguyên tốc độ ElevenLabs đọc ra (~${TYPICAL_RAW_WPM} từ/phút) — không xử lý gì thêm, giọng nguyên vẹn tuyệt đối`;
  }
  const wpm = Math.round(TYPICAL_RAW_WPM * level.tempo);
  const shorter = Math.round((1 - 1 / level.tempo) * 100);
  const note =
    level.tempo <= 1.2
      ? 'nhanh nhẹ, gần như không nghe ra dấu vết xử lý'
      : level.tempo <= 1.3
        ? 'nhanh rõ rệt, vẫn an toàn với hầu hết giọng'
        : level.tempo <= 1.4
          ? 'nhịp tin tức TikTok, mức đã dùng cho tập bản quyền/mascot'
          : 'rất nhanh, dồn dập — nghe kỹ đuôi từ xem có rung không';
  return `atempo ${level.tempo.toFixed(2)}x → ~${wpm} từ/phút, tập ngắn lại ~${shorter}% — ${note}`;
}

/**
 * Speed up an audio file in place-ish (src -> dest) and return the factor.
 * atempo accepts 0.5-2.0 in one pass; every level here is inside that, so no
 * filter chaining is needed.
 */
export function stretchAudio(srcPath, destPath, tempo) {
  if (!(tempo > 0.5 && tempo <= 2)) {
    throw new Error(`narration-pace: atempo factor ${tempo} is outside ffmpeg's single-pass range (0.5, 2]`);
  }
  return new Promise((resolve, reject) => {
    const args = ['-y', '-loglevel', 'error', '-i', srcPath, '-filter:a', `atempo=${tempo.toFixed(4)}`, '-q:a', '2', destPath];
    const child = spawn(binaryPath('ffmpeg'), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      reject(err.code === 'ENOENT' ? new Error(missingMessage('ffmpeg')) : err);
    });
    child.on('close', (code) => (code === 0 ? resolve(tempo) : reject(new Error(`ffmpeg atempo failed (${code}): ${stderr.slice(-500)}`))));
  });
}

/**
 * Rescale a timeline onto the stretched audio. Every timestamp is divided by
 * the same factor, which is exactly right: atempo is a uniform stretch, so
 * word N's position as a fraction of the whole is unchanged.
 *
 * This has to happen for BOTH `timings` and `words` or the karaoke drifts
 * further out of sync the longer the video runs.
 */
export function rescaleTimeline({ timings, words }, tempo) {
  const s = (n) => Math.round((n / tempo) * 1000) / 1000;
  return {
    timings: timings.map((t) => ({ ...t, startSec: s(t.startSec), endSec: s(t.endSec) })),
    words: words.map((scene) => scene.map((w) => ({ ...w, startSec: s(w.startSec), endSec: s(w.endSec) }))),
  };
}
