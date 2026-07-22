#!/usr/bin/env node
// scripts/voice-library.mjs
//
// A named list of narration voices the user can pick from at make-video time,
// instead of one voice frozen at init.
//
// WHY THE LIST LIVES IN THE WORKSPACE, NOT IN config.local.json
// -------------------------------------------------------------
// config.local.json is rebuilt from scratch by init on every machine, so it
// cannot carry anything TO an employee. The deployment model here is an admin
// handing out a prepared workspace folder; only files inside that folder make
// the trip. So a curated voice list is only useful if it lives there --
// `<workspaceDir>/voices.json`, next to `brand/` and `bgm-library/`.
//
// The parallel with BGM is exact, minus a step: BGM's shippable data is the
// mp3 files in `<workspaceDir>/bgm-library/` and config.local.json merely
// indexes them. A voice has no file at all -- it is an id and a sentence -- so
// the workspace file IS the data. There is nothing left to index.
//
// FILE SHAPE
//   { "voices": [ { "id": "...", "label": "Hạnh — nữ trẻ Bắc, hợp tin tức" } ] }
//
// An OBJECT at the root, not a bare array, for the same reason brand.json is
// an object: the next key that has to be added (a per-brand default, a pace
// override) must not invalidate every voices.json already sitting in an
// employee's folder.
//
// Usage (CLI):
//   node scripts/voice-library.mjs list
//   node scripts/voice-library.mjs check <voiceId>
//   node scripts/voice-library.mjs add <voiceId> <mô tả...>
//
// Usage (import):
//   import { listVoices, addVoice, describeVoice, HOUSE_VOICE } from './voice-library.mjs'

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_DIR, readConfig, getWorkspaceDir } from './workspace.mjs';

export const VOICES_FILENAME = 'voices.json';

/**
 * The one voice this project has actually verified end to end: chosen after
 * auditioning 14 Vietnamese voices on one script (the workspace's
 * `output/voice-casting/README.md` records that audition).
 *
 * It exists so that no code path anywhere can fall back to a voice nobody
 * chose. The value this replaced -- `FHhpndubmejSghqiumSv` -- was "thu-le-vn",
 * whose own ElevenLabs description reads "Vietnamese male voice cloned for
 * cross-lingual INDONESIAN TTS". It was never picked for Vietnamese; it was a
 * leftover default that survived because a `??` chain quietly ended in it.
 */
export const HOUSE_VOICE = Object.freeze({
  id: 'pGapy9MNHCukzJtjavF0',
  label: 'Hạnh — nữ trẻ giọng Bắc, rõ chữ, hợp tin tức (giọng mặc định của plugin)',
});

function voicesPath(workspaceDir) {
  return path.join(workspaceDir, VOICES_FILENAME);
}

/** Read and validate voices.json. Returns null if the file is not there. */
async function readVoicesFile(workspaceDir) {
  let raw;
  try {
    raw = await readFile(voicesPath(workspaceDir), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${voicesPath(workspaceDir)} is not valid JSON: ${err.message}`);
  }

  const list = Array.isArray(parsed?.voices) ? parsed.voices : [];
  return list
    .filter((v) => v && typeof v.id === 'string' && v.id.trim())
    .map((v) => ({ id: v.id.trim(), label: String(v.label ?? '').trim() || v.id.trim() }));
}

async function writeVoicesFile(workspaceDir, voices) {
  await writeFile(voicesPath(workspaceDir), JSON.stringify({ voices }, null, 2) + '\n');
}

/**
 * The voice this machine used BEFORE the library existed, if any.
 *
 * Older installs recorded a single voice in two places -- `voiceId` in
 * config.local.json and `ELEVENLABS_VOICE_ID` in the .env next to it. Both are
 * read here so an upgrade does not silently change whose voice comes out of
 * the speaker.
 *
 * The .env read pulls exactly one line and never touches, logs, or returns
 * ELEVENLABS_API_KEY, which lives in the same file.
 */
/**
 * The ElevenLabs key, read from the same .env `synthesizeScript` reads.
 *
 * NOT `process.env.ELEVENLABS_API_KEY`. That was a real bug, not a style
 * point: nothing in the make-video flow exports the key, so the CLI's
 * validation silently degraded to "chưa có API key — vẫn lưu" on every real
 * invocation, and a mistyped voice_id sailed into the library to fail later at
 * render time. It passed testing only because the test exported the key first,
 * which is a condition the real flow does not create.
 *
 * The value is returned to the caller and handed to `describeVoice` as a
 * header. It is never logged, never echoed, and never placed on a command
 * line -- argv is visible in the machine's process list and is copied verbatim
 * into tool logs.
 */
async function apiKeyFromEnvFile() {
  try {
    const env = await readFile(path.join(CONFIG_DIR, '.env'), 'utf8');
    const m = /^ELEVENLABS_API_KEY=(.*)$/m.exec(env);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

async function legacyVoiceId() {
  const fromConfig = readConfig().voiceId;
  if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim();
  try {
    const env = await readFile(path.join(CONFIG_DIR, '.env'), 'utf8');
    const m = /^ELEVENLABS_VOICE_ID=(.*)$/m.exec(env);
    if (m && m[1].trim()) return m[1].trim();
  } catch {
    /* no .env yet — nothing to migrate */
  }
  return null;
}

/**
 * Every voice available to pick from, in the order they were added.
 *
 * MIGRATION LIVES HERE, NOT IN init.mjs, and that placement is the point:
 * init no longer asks about voices at all, so it can never be the thing that
 * runs for a user who already configured this machine. Putting the migration
 * on the READ path means the first make-video after the upgrade is what
 * carries the old voice across -- which is the first moment it matters.
 *
 * @param {string} [workspaceDir]
 * @returns {Promise<Array<{id: string, label: string}>>}
 */
export async function listVoices(workspaceDir = getWorkspaceDir()) {
  const existing = await readVoicesFile(workspaceDir);
  if (existing) return existing;

  const legacy = await legacyVoiceId();
  if (!legacy) return [];

  const seeded = [
    {
      id: legacy,
      label:
        legacy === HOUSE_VOICE.id
          ? HOUSE_VOICE.label
          : 'Giọng máy này vẫn dùng từ trước (tự chuyển sang từ cấu hình cũ)',
    },
  ];
  await writeVoicesFile(workspaceDir, seeded);
  console.log(`[voice-library] chuyển giọng cũ "${legacy}" vào ${voicesPath(workspaceDir)}`);
  return seeded;
}

/**
 * Look a voice up on ElevenLabs. NEVER throws and never returns a reason to
 * stop: no network is a fact about right now, not evidence that an id is bad.
 *
 * Salvaged wholesale from init.mjs's `askVoiceId`, because the check it did
 * was the valuable half of that prompt. `speaksVietnamese: false` is the trap
 * this project has actually fallen into -- a voice that is not verified for
 * `vi` still produces confident audio, pronouncing Vietnamese with some other
 * language's phonemes. The author heard it instantly; a validator that only
 * checked "does this id exist" would not have.
 *
 * @returns {Promise<{found: boolean, name?: string, traits?: string,
 *   speaksVietnamese?: boolean, languages?: string[], unverified?: string}>}
 */
export async function describeVoice(voiceId, apiKey) {
  if (!apiKey) return { found: false, unverified: 'chưa có API key' };

  let res;
  try {
    res = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`, {
      headers: { 'xi-api-key': apiKey },
    });
  } catch (err) {
    return { found: false, unverified: `lỗi mạng (${err.message})` };
  }

  if (res.status === 400 || res.status === 404) return { found: false };
  if (!res.ok) return { found: false, unverified: `HTTP ${res.status}` };

  const v = await res.json();
  const languages = [
    ...new Set([
      ...(v.verified_languages ?? []).map((l) => l.language),
      ...(v.labels?.language ? [v.labels.language] : []),
    ]),
  ];
  const labels = v.labels ?? {};
  return {
    found: true,
    name: v.name,
    traits: [labels.gender, labels.age, labels.accent, labels.descriptive].filter(Boolean).join(', '),
    languages,
    speaksVietnamese: languages.includes('vi'),
  };
}

/**
 * Append a voice to the library. Re-adding an id that is already there
 * updates its label rather than creating a second row -- two entries pointing
 * at the same voice would make the pick list lie about how many choices there
 * are.
 *
 * `vi` records ElevenLabs' Vietnamese verdict at add time so the PICK list can
 * warn later without a network round-trip (and without a key on this machine).
 * It is deliberately tri-state: `true` verified, `false` explicitly not
 * verified, `null` when the check could not run (no key, no network, HTTP
 * error). `null` is NOT `false` — an unreachable API is not evidence the voice
 * is bad, the same principle `describeVoice` already states.
 *
 * @param {{id: string, label: string, vi?: (boolean|null)}} voice
 * @param {string} [workspaceDir]
 */
export async function addVoice({ id, label, vi = null }, workspaceDir = getWorkspaceDir()) {
  const cleanId = String(id ?? '').trim();
  if (!cleanId) throw new Error('voice id must not be empty');
  const cleanLabel = String(label ?? '').trim();
  if (!cleanLabel) throw new Error('voice label must not be empty — mô tả là thứ duy nhất giúp người sau nhận ra giọng này');
  const viStatus = vi === true ? true : vi === false ? false : null;

  const voices = (await readVoicesFile(workspaceDir)) ?? (await listVoices(workspaceDir));
  const at = voices.findIndex((v) => v.id === cleanId);
  if (at >= 0) voices[at] = { id: cleanId, label: cleanLabel, vi: viStatus };
  else voices.push({ id: cleanId, label: cleanLabel, vi: viStatus });

  await writeVoicesFile(workspaceDir, voices);
  return { id: cleanId, label: cleanLabel, vi: viStatus, path: voicesPath(workspaceDir) };
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
    const voices = await listVoices();
    if (voices.length === 0) {
      console.log('(chưa có giọng nào trong thư viện)');
    } else {
      voices.forEach((v, i) => {
        console.log(`${i + 1}. ${v.label}\n   voice_id: ${v.id}`);
        // Surface the Vietnamese verdict at PICK time, not only at add time.
        // A voice saved with the ⚠️ (add stores it but does not block) must not
        // reappear here looking clean -- that is exactly how this project once
        // shipped an Indonesian-cloned voice reading Vietnamese.
        if (v.vi === false) {
          console.log('   ⚠️  ElevenLabs chưa xác nhận giọng này đọc được tiếng Việt');
        } else if (v.vi !== true) {
          // null (check couldn't run) or legacy rows saved before this field.
          console.log('   (chưa kiểm chứng tiếng Việt)');
        }
      });
    }
  } else if (cmd === 'check') {
    const [id] = rest;
    if (!id) {
      console.error('Usage: node scripts/voice-library.mjs check <voiceId>');
      process.exit(1);
    }
    const info = await describeVoice(id, await apiKeyFromEnvFile());
    console.log(JSON.stringify(info, null, 2));
  } else if (cmd === 'add') {
    const [id, ...labelParts] = rest;
    if (!id || labelParts.length === 0) {
      console.error('Usage: node scripts/voice-library.mjs add <voiceId> <mô tả...>');
      process.exit(1);
    }
    // Kiểm TRƯỚC khi lưu. Một voice_id gõ sai mà lọt vào thư viện sẽ nằm đó
    // im lặng cho tới lúc render và báo lỗi ở một chỗ chẳng liên quan gì.
    const info = await describeVoice(id, await apiKeyFromEnvFile());
    if (!info.found && !info.unverified) {
      console.error(`[voice-library] ❌ ElevenLabs không có voice_id "${id}". Kiểm tra lại rồi thêm.`);
      process.exit(1);
    }
    if (info.unverified) {
      console.log(`[voice-library] ⏭️  Chưa kiểm chứng được giọng (${info.unverified}) — vẫn lưu.`);
    } else {
      console.log(`[voice-library] ✅ Giọng: "${info.name}"${info.traits ? ` — ${info.traits}` : ''}`);
      // Cảnh báo chứ không chặn: người dùng có thể biết rõ hơn cả nhãn của
      // ElevenLabs. Nhưng phải nói ra -- đây đúng là cái bẫy dự án này đã sập
      // một lần, và một giọng sai ngôn ngữ vẫn phát ra âm thanh rất tự tin.
      if (!info.speaksVietnamese) {
        console.log('[voice-library] ⚠️  CẢNH BÁO: ElevenLabs KHÔNG xác nhận giọng này nói tiếng Việt.');
        console.log(`[voice-library]    Ngôn ngữ nó khai báo: ${info.languages.join(', ') || '(không có)'}`);
        console.log('[voice-library]    Nó vẫn đọc ra tiếng, nhưng phát âm chữ Việt bằng bộ âm của tiếng khác.');
      }
    }

    // Tri-state: unverified check -> null (couldn't run, not a verdict);
    // otherwise ElevenLabs' own vi verdict. Persisted so `list` can warn later
    // without a key or network.
    const vi = info.unverified ? null : !!info.speaksVietnamese;
    try {
      const saved = await addVoice({ id, label: labelParts.join(' '), vi });
      console.log(`[voice-library] đã lưu "${saved.label}" (${saved.id}) -> ${saved.path}`);
    } catch (err) {
      console.error(`[voice-library] ERROR: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.error(
      'Usage:\n' +
        '  node scripts/voice-library.mjs list\n' +
        '  node scripts/voice-library.mjs check <voiceId>\n' +
        '  node scripts/voice-library.mjs add <voiceId> <mô tả...>',
    );
    process.exit(1);
  }
}
