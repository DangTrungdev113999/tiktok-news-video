#!/usr/bin/env node
// scripts/probe-asset.mjs
//
// Shells out to `ffprobe` to classify an asset (image vs video) and report
// its dimensions (+ duration for video). Used by the orchestration skill to
// pick a Ken Burns / pan / blur-pad effect per Section F of the design spec.
//
// Usage (CLI):   node scripts/probe-asset.mjs <path-to-asset>
// Usage (import): import { probeAsset } from './probe-asset.mjs'

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Run a command and resolve with stdout, rejecting with a readable error. */
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            `'${cmd}' was not found on PATH. Run \`npm run init\` first to install ffmpeg/ffprobe.`
          )
        );
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${cmd} exited with code ${code}: ${stderr.trim()}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Probe a media asset with ffprobe and classify it.
 * @param {string} assetPath
 * @returns {Promise<{ type: 'image'|'video', width: number, height: number, durationSec?: number }>}
 */
export async function probeAsset(assetPath) {
  const resolved = path.resolve(assetPath);
  try {
    await access(resolved, fsConstants.R_OK);
  } catch {
    throw new Error(`Asset not found or not readable: ${resolved}`);
  }

  let stdout;
  try {
    stdout = await run('ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      resolved,
    ]);
  } catch (err) {
    // Re-throw ENOENT-style errors from run() as-is (already have the
    // "run npm run init" message); wrap anything else.
    throw err;
  }

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error(`Could not parse ffprobe output for ${resolved}`);
  }

  const streams = data.streams || [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  if (!videoStream) {
    throw new Error(`No video/image stream found in ${resolved}`);
  }

  const width = Number(videoStream.width);
  const height = Number(videoStream.height);
  if (!width || !height) {
    throw new Error(`Could not determine dimensions for ${resolved}`);
  }

  const formatName = String(data.format?.format_name || '');
  const formatDuration = Number(data.format?.duration);
  const nbFrames = Number(videoStream.nb_frames);

  // Heuristic for image vs video (codec alone is unreliable — mjpeg/png
  // appear as both a still image AND a video codec). ffprobe reports single
  // images through *_pipe / image2 demuxers and gives them no real duration
  // (N/A, or 0/very close to a single-frame estimate) and nb_frames<=1.
  const looksLikeImageFormat = /(_pipe|image2)/.test(formatName);
  const hasNoRealDuration = !Number.isFinite(formatDuration) || formatDuration <= 0;
  const singleFrame = Number.isFinite(nbFrames) && nbFrames <= 1;

  const isImage = looksLikeImageFormat || (hasNoRealDuration && (singleFrame || !videoStream.avg_frame_rate || videoStream.avg_frame_rate === '0/0'));

  if (isImage) {
    return { type: 'image', width, height };
  }

  const durationSec = Number.isFinite(formatDuration) && formatDuration > 0
    ? formatDuration
    : Number(videoStream.duration) || 0;

  return { type: 'video', width, height, durationSec };
}

function isMain() {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/probe-asset.mjs <path-to-asset>');
    process.exit(1);
  }
  probeAsset(target)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error(`probe-asset: ${err.message}`);
      process.exit(1);
    });
}
