#!/usr/bin/env node
/**
 * scripts/init.mjs
 *
 * One-time (per máy) setup cho plugin tiktok-news-video.
 * Chạy bằng: npm run init   (hoặc: node scripts/init.mjs)
 *
 * Việc script này làm:
 *   1. Nhận diện hệ điều hành (macOS / Windows / Linux)
 *   2. Kiểm tra Node.js
 *   3. Kiểm tra / cài ffmpeg
 *   4. Cài dependency cho Remotion + tải sẵn Chrome Headless Shell
 *   5. In bảng kiểm tra tổng hợp (pass/fail)
 *   6. Hỏi cấu hình: thư mục output, ElevenLabs API key, voice_id
 *   7. Ghi config.local.json và .env
 *
 * Toàn bộ script chỉ dùng module có sẵn của Node (fs, path, os, readline,
 * child_process) — không phụ thuộc gói ngoài nào, để chạy được ngay cả khi
 * `npm install` ở thư mục gốc chưa từng chạy.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const REMOTION_DIR = path.join(REPO_ROOT, "remotion");
const REMOTION_PKG = path.join(REMOTION_DIR, "package.json");
const CONFIG_PATH = path.join(REPO_ROOT, "config.local.json");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, ".env.example");

const DEFAULT_VOICE_ID = "FHhpndubmejSghqiumSv";
const MIN_NODE_MAJOR = 18;

const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";
const IS_LINUX = process.platform === "linux";

function log(msg = "") {
  console.log(msg);
}

function section(title) {
  log("");
  log("=".repeat(60));
  log(title);
  log("=".repeat(60));
}

function nodeMajorVersion() {
  return parseInt(process.version.slice(1).split(".")[0], 10);
}

/** Chạy 1 lệnh, không throw — trả về kết quả spawnSync (kể cả khi lệnh không tồn tại). */
function tryRun(cmd, args, opts = {}) {
  try {
    return spawnSync(cmd, args, { encoding: "utf8", ...opts });
  } catch (err) {
    return { error: err, status: null, stdout: "", stderr: String(err) };
  }
}

function checkFfmpeg() {
  const r = tryRun("ffmpeg", ["-version"]);
  if (r.error || r.status !== 0) return null;
  const firstLine = (r.stdout || "").split("\n")[0].trim();
  return firstLine || "ffmpeg (không rõ phiên bản)";
}

function parseEnvFile(content) {
  const out = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

function expandHome(p) {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

/**
 * Tạo một hàm ask(question) đọc từng dòng trả lời từ stdin, theo đúng thứ tự.
 *
 * Cố tình KHÔNG dùng rl.question() lặp lại: rl.question() chỉ gắn listener
 * "line" tại đúng thời điểm gọi, nên nếu người dùng gõ trước (hoặc dữ liệu
 * đã nằm sẵn trong stdin) trong lúc script đang bận chạy lệnh cài đặt chặn
 * luồng (spawnSync như "brew install", "npm install"...), các dòng đến sớm
 * có thể bị rơi mất vì chưa có listener nào đang chờ. Dùng async iterator
 * của readline (for-await) để các dòng nhập được xếp hàng đúng thứ tự bất
 * kể thời điểm chúng đến.
 */
function createAsk(rl) {
  const lineIterator = rl[Symbol.asyncIterator]();
  return async function ask(question) {
    process.stdout.write(question);
    const { value, done } = await lineIterator.next();
    return done ? "" : value;
  };
}

// ---------------------------------------------------------------------------
// Bước 1: Nhận diện hệ điều hành
// ---------------------------------------------------------------------------

function stepDetectOS() {
  section("Bước 1: Nhận diện hệ điều hành");
  let osName = "Không xác định";
  if (IS_MAC) osName = "macOS";
  else if (IS_WIN) osName = "Windows";
  else if (IS_LINUX) osName = "Linux (chưa hỗ trợ chính thức, nhưng sẽ thử chạy)";
  log(`Hệ điều hành: ${osName} (${process.platform}, ${os.arch()})`);
}

// ---------------------------------------------------------------------------
// Bước 2: Kiểm tra Node.js
// ---------------------------------------------------------------------------

function stepCheckNode() {
  section("Bước 2: Kiểm tra Node.js");
  const r = tryRun("node", ["-v"]);
  const versionFromShell = !r.error && r.status === 0 ? (r.stdout || "").trim() : null;
  log(`Phiên bản Node.js đang chạy script này: ${process.version}`);
  if (versionFromShell) log(`Kết quả lệnh "node -v": ${versionFromShell}`);

  const major = nodeMajorVersion();
  if (major < MIN_NODE_MAJOR) {
    log("");
    log(`❌ Node.js quá cũ (cần bản ${MIN_NODE_MAJOR} trở lên, máy đang có ${process.version}).`);
    log("   Vui lòng cài Node.js bản mới tại: https://nodejs.org/ (chọn bản LTS)");
    log("   Sau khi cài xong, mở lại Terminal/PowerShell rồi chạy lại: npm run init");
    process.exit(1);
  }
  log(`✅ Node.js đáp ứng yêu cầu (>= ${MIN_NODE_MAJOR}).`);
}

// ---------------------------------------------------------------------------
// Bước 3: Kiểm tra / cài ffmpeg
// ---------------------------------------------------------------------------

function stepFfmpeg() {
  section("Bước 3: Kiểm tra ffmpeg");
  let info = checkFfmpeg();
  if (info) {
    log(`✅ Đã có ffmpeg: ${info}`);
    return info;
  }

  log("Chưa tìm thấy ffmpeg trên máy này. Đang thử tự cài đặt...");

  if (IS_MAC) {
    const brewCheck = tryRun("brew", ["--version"]);
    if (!brewCheck.error && brewCheck.status === 0) {
      log("Tìm thấy Homebrew — đang chạy: brew install ffmpeg (có thể mất vài phút)...");
      const install = tryRun("brew", ["install", "ffmpeg"], { stdio: "inherit" });
      if (install.status === 0) {
        log("Đã cài xong, đang kiểm tra lại...");
      } else {
        log("⚠️  `brew install ffmpeg` gặp lỗi. Hãy tự mở Terminal và chạy lệnh này để xem chi tiết lỗi.");
      }
    } else {
      log("");
      log("⚠️  Máy chưa cài Homebrew (trình quản lý phần mềm cho macOS).");
      log("   Script này SẼ KHÔNG tự cài Homebrew (cần quyền cao hơn), bạn hãy tự cài theo các bước:");
      log("   1. Mở Terminal, dán lệnh sau rồi Enter:");
      log('      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
      log("      (đây là lệnh cài chính thức từ https://brew.sh)");
      log("   2. Làm theo hướng dẫn trên màn hình để cài xong Homebrew.");
      log("   3. Chạy: brew install ffmpeg");
      log("   4. Chạy lại: npm run init");
    }
  } else if (IS_WIN) {
    const wingetCheck = tryRun("winget", ["--version"]);
    if (!wingetCheck.error && wingetCheck.status === 0) {
      log("Tìm thấy winget (Windows Package Manager) — đang chạy: winget install ffmpeg...");
      const install = tryRun(
        "winget",
        [
          "install",
          "-e",
          "--id",
          "Gyan.FFmpeg",
          "--accept-package-agreements",
          "--accept-source-agreements",
        ],
        { stdio: "inherit" }
      );
      if (install.status === 0) {
        log("Đã cài xong. Nếu bước kiểm tra bên dưới vẫn báo CHƯA sẵn sàng, hãy MỞ LẠI PowerShell/CMD rồi chạy lại npm run init (PATH cần nạp lại).");
      } else {
        log("⚠️  `winget install` gặp lỗi. Xem hướng dẫn cài thủ công bên dưới.");
        printManualFfmpegWindowsInstructions();
      }
    } else {
      log("");
      log("⚠️  Máy chưa có winget (Windows Package Manager).");
      printManualFfmpegWindowsInstructions();
    }
  } else {
    log("");
    log("Linux: hãy tự cài ffmpeg bằng trình quản lý gói của bản phân phối, ví dụ:");
    log("   Ubuntu/Debian: sudo apt update && sudo apt install -y ffmpeg");
    log("   Fedora:        sudo dnf install -y ffmpeg");
  }

  info = checkFfmpeg();
  if (info) log(`✅ Kiểm tra lại: đã có ffmpeg (${info})`);
  else log("❌ ffmpeg vẫn CHƯA sẵn sàng sau bước cài tự động.");
  return info;
}

function printManualFfmpegWindowsInstructions() {
  log("   Cài ffmpeg thủ công theo các bước sau:");
  log("   1. Mở trình duyệt, vào: https://www.gyan.dev/ffmpeg/builds/");
  log('   2. Tải file "release essentials" (tên file dạng ffmpeg-release-essentials.zip)');
  log("   3. Giải nén file zip vừa tải, ví dụ vào thư mục: C:\\ffmpeg");
  log("      (sau khi giải nén sẽ có thư mục con C:\\ffmpeg\\bin chứa ffmpeg.exe)");
  log('   4. Bấm nút Start, gõ "Edit the system environment variables", mở nó ra');
  log('   5. Bấm nút "Environment Variables..."');
  log('   6. Ở khung "System variables" bên dưới, chọn dòng "Path" rồi bấm "Edit"');
  log('   7. Bấm "New", nhập: C:\\ffmpeg\\bin, rồi bấm OK ở tất cả các cửa sổ');
  log("   8. ĐÓNG và MỞ LẠI PowerShell/CMD (bắt buộc, để PATH mới có hiệu lực)");
  log("   9. Gõ thử: ffmpeg -version để kiểm tra, rồi chạy lại: npm run init");
}

// ---------------------------------------------------------------------------
// Bước 4: Cài dependency Remotion + tải Chrome Headless Shell
// ---------------------------------------------------------------------------

function stepRemotion() {
  section("Bước 4: Cài đặt Remotion (bộ máy render video)");

  if (!fs.existsSync(REMOTION_DIR) || !fs.existsSync(REMOTION_PKG)) {
    log("Thư mục remotion/ chưa sẵn sàng (chưa có package.json ở remotion/package.json).");
    log("→ Việc script NÀY SẼ LÀM khi thư mục remotion/ đã sẵn sàng:");
    log(`   1. npm install    (chạy trong: ${REMOTION_DIR})`);
    log("   2. npx remotion browser ensure    (tải sẵn Chrome Headless Shell để render)");
    log("Bỏ qua bước này lần này — chạy lại `npm run init` sau khi thư mục remotion/ đã có package.json.");
    return { installed: false, version: null };
  }

  const npmCmd = IS_WIN ? "npm.cmd" : "npm";
  const npxCmd = IS_WIN ? "npx.cmd" : "npx";

  // shell:true is required on Windows: npm/npx ship as .cmd batch files, and
  // since Node's CVE-2024-27980 fix, spawning a .cmd/.bat without shell:true
  // throws EINVAL instead of running it. Harmless on macOS/Linux (real
  // binaries), so it's fine to always pass it here — no untrusted/interpolated
  // arguments go through this shell.
  log(`Đang chạy "npm install" trong ${REMOTION_DIR} (có thể mất vài phút)...`);
  const npmInstall = tryRun(npmCmd, ["install"], {
    cwd: REMOTION_DIR,
    stdio: "inherit",
    shell: IS_WIN,
  });

  let browserOk = false;
  if (npmInstall.status === 0) {
    log('Đang tải Chrome Headless Shell cho Remotion ("npx remotion browser ensure")...');
    const browserEnsure = tryRun(npxCmd, ["remotion", "browser", "ensure"], {
      cwd: REMOTION_DIR,
      stdio: "inherit",
      shell: IS_WIN,
    });
    browserOk = browserEnsure.status === 0;
    if (!browserOk) {
      log('⚠️  Tải Chrome Headless Shell gặp lỗi. Thử lại thủ công: cd remotion && npx remotion browser ensure');
    }
  } else {
    log('⚠️  "npm install" trong remotion/ gặp lỗi. Kiểm tra lại thông báo lỗi phía trên.');
  }

  const version = getRemotionVersion(npxCmd);

  return { installed: npmInstall.status === 0 && browserOk, version };
}

/**
 * Lấy số phiên bản Remotion CLI đang cài trong remotion/.
 * Dùng "remotion versions" thay vì "remotion --version" vì bản CLI hiện tại
 * in số phiên bản ra dòng đầu của "--version" nhưng vẫn thoát với status 1
 * (kèm theo in cả phần trợ giúp) — "versions" thoát status 0 và rõ ràng hơn.
 */
function getRemotionVersion(npxCmd) {
  const r = tryRun(npxCmd, ["remotion", "versions"], { cwd: REMOTION_DIR, shell: IS_WIN });
  if (r.error || r.status !== 0) return null;
  const match = (r.stdout || "").match(/On version:\s*(\S+)/);
  if (match) return match[1];
  const firstLine = (r.stdout || "").split("\n")[0].trim();
  return firstLine || "(không rõ số phiên bản)";
}

// ---------------------------------------------------------------------------
// Bước 6: Hỏi cấu hình (idempotent — hỏi lại nếu đã cấu hình trước đó)
// ---------------------------------------------------------------------------

async function stepConfigure(ask) {
  section("Bước 6: Cấu hình");

  let existingConfig = null;
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    } catch {
      existingConfig = null;
    }
  }
  let existingEnv = {};
  if (fs.existsSync(ENV_PATH)) {
    existingEnv = parseEnvFile(fs.readFileSync(ENV_PATH, "utf8"));
  }

  const hasExisting = existingConfig || Object.keys(existingEnv).length > 0;

  let doConfigure = true;
  if (hasExisting) {
    log("Đã tìm thấy cấu hình trước đó:");
    if (existingConfig?.outputDir) log(`  - Thư mục output: ${existingConfig.outputDir}`);
    if (existingConfig?.voiceId || existingEnv.ELEVENLABS_VOICE_ID) {
      log(`  - Voice ID: ${existingConfig?.voiceId || existingEnv.ELEVENLABS_VOICE_ID}`);
    }
    log(`  - ElevenLabs API key: ${existingEnv.ELEVENLABS_API_KEY ? "đã có" : "chưa có"}`);
    const answer = await ask("\nBạn có muốn cấu hình lại không? (y/N): ");
    doConfigure = answer.trim().toLowerCase().startsWith("y");
  }

  if (!doConfigure) {
    log("Giữ nguyên cấu hình hiện tại (không ghi đè).");
    return {
      outputDir: existingConfig?.outputDir || null,
      voiceId: existingConfig?.voiceId || existingEnv.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID,
      apiKey: existingEnv.ELEVENLABS_API_KEY || "",
      bgmLibrary: Array.isArray(existingConfig?.bgmLibrary) ? existingConfig.bgmLibrary : [],
      wrote: false,
    };
  }

  // --- Thư mục output ---
  const defaultOutputDir = path.join(REPO_ROOT, "output");
  const outAnswer = await ask(
    `\nBạn muốn lưu video đã render ở đâu?\n(Enter để dùng mặc định: ${defaultOutputDir})\n> `
  );
  let outputDir = expandHome(outAnswer.trim() || defaultOutputDir);
  outputDir = path.resolve(outputDir);

  if (!fs.existsSync(outputDir)) {
    const createAnswer = await ask(
      `Thư mục "${outputDir}" chưa tồn tại. Tạo thư mục này luôn không? (Y/n): `
    );
    if (createAnswer.trim().toLowerCase().startsWith("n")) {
      log("Bỏ qua — bạn cần tự tạo thư mục này trước khi render video.");
    } else {
      fs.mkdirSync(outputDir, { recursive: true });
      log(`✅ Đã tạo thư mục: ${outputDir}`);
    }
  } else {
    log(`✅ Thư mục đã tồn tại: ${outputDir}`);
  }

  // --- ElevenLabs API key ---
  log("\nElevenLabs API key dùng để tự động tạo giọng đọc (TTS) cho video.");
  log("Nếu bạn luôn tự cung cấp file MP3 lời đọc riêng, có thể bỏ qua bước này (nhấn Enter).");
  const apiKeyAnswer = await ask("Nhập ElevenLabs API key (Enter để bỏ qua): ");
  const apiKey = apiKeyAnswer.trim();

  // --- Voice ID ---
  const voiceAnswer = await ask(
    `\nNhập ElevenLabs voice_id (Enter để dùng mặc định: ${DEFAULT_VOICE_ID}): `
  );
  const voiceId = voiceAnswer.trim() || DEFAULT_VOICE_ID;

  return {
    outputDir,
    voiceId,
    apiKey,
    bgmLibrary: Array.isArray(existingConfig?.bgmLibrary) ? existingConfig.bgmLibrary : [],
    wrote: true,
  };
}

function writeConfigFiles({ outputDir, voiceId, apiKey, bgmLibrary }) {
  const configObj = { outputDir, voiceId, bgmLibrary: bgmLibrary || [] };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(configObj, null, 2) + "\n", "utf8");

  let envContent;
  if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    envContent = fs.readFileSync(ENV_EXAMPLE_PATH, "utf8");
  } else {
    envContent = "ELEVENLABS_API_KEY=\nELEVENLABS_VOICE_ID=\n";
  }
  if (/^ELEVENLABS_API_KEY=.*$/m.test(envContent)) {
    envContent = envContent.replace(/^ELEVENLABS_API_KEY=.*$/m, `ELEVENLABS_API_KEY=${apiKey}`);
  } else {
    envContent += `\nELEVENLABS_API_KEY=${apiKey}\n`;
  }
  if (/^ELEVENLABS_VOICE_ID=.*$/m.test(envContent)) {
    envContent = envContent.replace(/^ELEVENLABS_VOICE_ID=.*$/m, `ELEVENLABS_VOICE_ID=${voiceId}`);
  } else {
    envContent += `ELEVENLABS_VOICE_ID=${voiceId}\n`;
  }
  fs.writeFileSync(ENV_PATH, envContent, "utf8");
}

// ---------------------------------------------------------------------------
// Bước 5 (in checklist sau khi có kết quả) — được gọi ở cuối, sau bước 6,
// để checklist cũng phản ánh được trạng thái ElevenLabs key.
// ---------------------------------------------------------------------------

function printFinalChecklist({ ffmpegInfo, remotionResult, config }) {
  section("Kết quả kiểm tra tổng hợp");

  const items = [];

  const major = nodeMajorVersion();
  items.push({
    ok: major >= MIN_NODE_MAJOR,
    text: `Node.js ${process.version} ${major >= MIN_NODE_MAJOR ? "— sẵn sàng" : `— quá cũ, cần >= ${MIN_NODE_MAJOR}`}`,
  });

  items.push({
    ok: !!ffmpegInfo,
    text: ffmpegInfo
      ? `ffmpeg đã cài đặt: ${ffmpegInfo}`
      : "ffmpeg CHƯA sẵn sàng — xem hướng dẫn cài đặt ở Bước 3 phía trên, rồi chạy lại `npm run init`. Nếu bạn đang ở Claude Code Desktop hoặc ChatGPT app và ffmpeg cứ báo thiếu dù đã cài, khả năng cao phiên đang chạy là Remote/cloud — hãy đổi sang phiên Local.",
  });

  if (!fs.existsSync(REMOTION_PKG)) {
    items.push({
      ok: false,
      text: "Remotion renderer CHƯA sẵn sàng — thư mục remotion/ chưa có package.json (phần này có thể đang được dựng riêng); chạy lại `npm run init` sau khi remotion/ sẵn sàng",
    });
  } else if (remotionResult.installed && remotionResult.version) {
    items.push({ ok: true, text: `Remotion renderer đã sẵn sàng (CLI ${remotionResult.version})` });
  } else {
    items.push({
      ok: false,
      text: "Remotion renderer CHƯA sẵn sàng — chạy thủ công trong thư mục remotion/: npm install && npx remotion browser ensure",
    });
  }

  items.push({
    ok: !!config.apiKey,
    text: config.apiKey
      ? "Đã lưu ElevenLabs API key"
      : "ElevenLabs API key CHƯA được thiết lập — bạn sẽ cần key này để tự động tạo giọng đọc (hoặc luôn tự cung cấp file MP3 lời đọc riêng thì có thể bỏ qua)",
  });

  for (const item of items) {
    log(`${item.ok ? "✅" : "❌"} ${item.text}`);
  }

  log("");
  log(`Thư mục output: ${config.outputDir || "(chưa cấu hình)"}`);
  log(`Voice ID mặc định: ${config.voiceId}`);
  if (config.wrote) {
    log(`\nĐã ghi cấu hình vào:\n  - ${CONFIG_PATH}\n  - ${ENV_PATH}`);
  }

  const allCriticalOk = items[0].ok; // Node bắt buộc; các mục khác chỉ cảnh báo
  log("");
  if (allCriticalOk) {
    log("Xong! Bạn có thể bắt đầu tạo video (xem lệnh /make-video trong Claude Code).");
  }
  if (items.some((i) => !i.ok)) {
    log("Lưu ý: một vài mục ở trên còn thiếu (❌) — bạn vẫn có thể dùng thử, nhưng hãy xử lý các mục đó trước khi render video thật.");
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  log("tiktok-news-video — thiết lập lần đầu cho máy này (npm run init)");
  log(
    "Lưu ý nếu bạn đang chạy trong Claude Code Desktop hoặc ChatGPT app: cả 2 app đều cho chọn phiên làm việc kiểu Local hoặc Remote/cloud. Pipeline này cần quyền Bash + ffmpeg + đọc/ghi file THẬT trên máy bạn, nên PHẢI chọn Local — Remote/cloud sẽ không thấy được ảnh/video của bạn và không có ffmpeg."
  );

  stepDetectOS();
  stepCheckNode();
  const ffmpegInfo = stepFfmpeg();
  const remotionResult = stepRemotion();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = createAsk(rl);
  let config;
  try {
    config = await stepConfigure(ask);
  } finally {
    rl.close();
  }

  if (config.wrote) {
    writeConfigFiles(config);
  }

  printFinalChecklist({ ffmpegInfo, remotionResult, config });
}

main().catch((err) => {
  console.error("\n❌ Có lỗi không mong muốn xảy ra khi chạy init:");
  console.error(err?.stack || err);
  process.exit(1);
});
