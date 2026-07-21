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
 *   6. Hỏi cấu hình: thư mục workspace (assets/bgm-library/output), ElevenLabs
 *      API key, voice_id
 *   7. Ghi config.local.json và .env
 *
 * config.local.json/.env KHÔNG nằm cạnh code (REPO_ROOT) -- khi plugin này
 * chạy như một plugin đã cài (Claude Code marketplace / Codex / ChatGPT
 * app), REPO_ROOT là một thư mục cache gắn với PHIÊN BẢN, bị thay mới hoàn
 * toàn mỗi lần update. Ghi state ở đó nghĩa là mất key + cấu hình mỗi lần
 * update. Thay vào đó dùng CONFIG_DIR (scripts/workspace.mjs) -- một thư mục
 * cố định theo home directory, không đổi dù code có update bao nhiêu lần.
 * Assets/bgm-library/output cũng KHÔNG nằm cạnh code -- chúng nằm trong một
 * thư mục "workspace" bình thường, hiển thị, do người dùng chọn lúc init
 * (mặc định: ~/Desktop/tiktok-news-video-workspace), với đường dẫn đó được
 * ghi lại trong CONFIG_DIR.
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONFIG_DIR, CONFIG_PATH, ENV_PATH, DEFAULT_WORKSPACE_DIR, ensureWorkspaceSubdirs } from "./workspace.mjs";
import { binaryPath } from "./ffmpeg-path.mjs";
import { PACE_LEVELS, DEFAULT_PACE_LABEL, describe, paceLevel } from "./narration-pace.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const REMOTION_DIR = path.join(REPO_ROOT, "remotion");
const REMOTION_PKG = path.join(REMOTION_DIR, "package.json");
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, ".env.example");

// Hạnh -- nữ trẻ giọng Bắc, "Smooth, Clear and Feminine". Chọn 2026-07-21
// sau khi thu thử 14 giọng Việt trên cùng một kịch bản.
//
// Giá trị cũ (FHhpndubmejSghqiumSv) là "thu-le-vn", mà mô tả chính thức của
// nó trên ElevenLabs là "Vietnamese male voice cloned for cross-lingual
// Indonesian TTS" -- một giọng clone để đọc tiếng INDONESIA. Nó chưa bao giờ
// được ai chọn cho tiếng Việt; nó chỉ là giá trị còn sót lại. Đừng khôi phục.
const DEFAULT_VOICE_ID = "pGapy9MNHCukzJtjavF0";
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

/**
 * ffmpeg VÀ ffprobe đều chạy được chứ? Phải hỏi cả hai: chúng đi cùng nhau
 * trong mọi bản cài, nhưng plugin gọi ffprobe (đo asset, đo độ dài audio)
 * nhiều hơn gọi ffmpeg — kiểm mỗi ffmpeg thì bỏ lọt đúng cái hay dùng.
 */
function checkFfmpeg() {
  const ffmpegBin = binaryPath("ffmpeg");
  const r = tryRun(ffmpegBin, ["-version"]);
  if (r.error || r.status !== 0) return null;
  const probe = tryRun(binaryPath("ffprobe"), ["-version"]);
  if (probe.error || probe.status !== 0) return null;
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

export function expandHome(p) {
  // Strip a wrapping quote pair FIRST. Windows 11's "Copy as path" (the
  // default in Explorer's context menu) puts the path on the clipboard
  // already wrapped in double quotes: "C:\Users\nv\Desktop\ws". `"` is an
  // illegal NTFS filename character, so without this the very first question
  // of init ends in an unhandled mkdirSync throw and a stack trace -- which
  // tells a non-technical employee nothing. macOS's "Copy as Pathname" adds
  // no quotes, which is why this was never seen on the author's machine.
  p = String(p).trim().replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1").trim();
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

async function stepFfmpeg() {
  section("Bước 3: Kiểm tra ffmpeg");
  let info = checkFfmpeg();
  if (info) {
    log(`✅ Đã có ffmpeg: ${info}`);
    return { info, ffmpegDir: null };
  }

  log("Chưa tìm thấy ffmpeg trên máy này. Đang thử tự cài đặt...");

  // Windows đi đường tải-thẳng TRƯỚC winget. Cả hai đều tải chừng ấy dữ liệu,
  // nhưng winget cài vào PATH — mà PATH chỉ nạp lúc tiến trình khởi động, nên
  // nó luôn kết thúc bằng "đóng app, mở lại, chạy init lần nữa". Bản tải
  // thẳng dùng được ngay trong chính phiên này.
  if (IS_WIN) {
    const dir = await downloadFfmpegWindows();
    if (dir) {
      // Ghi vào config NGAY, trước Bước 6: checkFfmpeg() bên dưới phân giải
      // đường dẫn qua config, và bước 4 (Remotion) cũng có thể cần tới.
      saveFfmpegDir(dir);
      info = checkFfmpeg();
      if (info) {
        log(`✅ Kiểm tra lại: ffmpeg đã dùng được (${info})`);
        return { info, ffmpegDir: dir };
      }
      log("⚠️  Tải xong nhưng chạy thử vẫn lỗi — thử tiếp bằng winget.");
    }
  }

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
        // winget chỉ thêm một shim vào PATH, mà PATH thì tiến trình này đọc
        // xong từ lúc khởi động. File thật vẫn nằm trên đĩa — tìm ra nó thì
        // không phải bắt người dùng restart app rồi chạy init lần hai.
        const found = findWingetFfmpegDir();
        if (found) {
          saveFfmpegDir(found);
          log(`✅ Đã cài xong ffmpeg và tìm thấy tại: ${found}`);
          log("   (không cần khởi động lại app)");
          const info = checkFfmpeg();
          if (info) return { info, ffmpegDir: found };
        }
        log("Đã cài xong ffmpeg, nhưng chưa dùng được ngay trong phiên này (Windows cần nạp lại PATH). Hãy ĐÓNG HẲN rồi MỞ LẠI ứng dụng bạn đang dùng, sau đó chạy lại init một lần nữa.");
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

  // Chốt cuối: quét đĩa xem có bản nào đã nằm sẵn ở chỗ quen thuộc mà chỉ vì
  // PATH chưa nạp nên không thấy — kể cả bản người dùng tự giải nén vào
  // C:\ffmpeg\bin theo hướng dẫn thủ công ở lần chạy trước.
  if (IS_WIN && !checkFfmpeg()) {
    const found = findWingetFfmpegDir();
    if (found) saveFfmpegDir(found);
  }

  info = checkFfmpeg();
  if (info) log(`✅ Kiểm tra lại: đã có ffmpeg (${info})`);
  else log("❌ ffmpeg vẫn CHƯA sẵn sàng sau bước cài tự động.");
  return { info, ffmpegDir: null };
}

/**
 * Ghi ffmpegDir vào config ngay lúc tải xong, không đợi Bước 6.
 *
 * Bước 6 mới là chỗ ghi config đầy đủ, nhưng nó chạy SAU — mà từ giây phút
 * tải xong trở đi, mọi lệnh gọi ffmpeg đều phải tìm thấy đường dẫn này. Nên
 * hợp nhất vào file config hiện có (nếu đã có) thay vì ghi đè.
 */
function saveFfmpegDir(dir) {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    cfg = {};
  }
  cfg.ffmpegDir = dir;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

/**
 * Tải bản ffmpeg tĩnh về thư mục của plugin — KHÔNG đụng tới PATH.
 *
 * Đây là đường thoát cho hai tình huống mà winget không giải quyết được, và
 * cả hai đều rất hay gặp trên máy công ty:
 *   - máy không có winget (Windows 10 bản cũ, hoặc bị policy chặn)
 *   - winget cài xong nhưng PATH chưa nạp lại, nên phải restart app rồi chạy
 *     init lần hai — bước mà người dùng không rành kỹ thuật hay bỏ dở
 *
 * Tải thẳng vào CONFIG_DIR/bin thì không cần quyền Administrator, không cần
 * restart, và đường dẫn được ghi vào config để mọi script dùng lại (xem
 * scripts/ffmpeg-path.mjs).
 *
 * @returns {Promise<string|null>} thư mục chứa ffmpeg.exe, hoặc null nếu hỏng
 */
async function downloadFfmpegWindows() {
  const binDir = path.join(CONFIG_DIR, "bin");
  const workDir = path.join(CONFIG_DIR, "ffmpeg-download");
  const zipPath = path.join(workDir, "ffmpeg.zip");

  try {
    const url = await resolveFfmpegZipUrl();
    log("Đang tải sẵn ffmpeg về thư mục của plugin (khoảng 80MB, vài phút tuỳ mạng)...");
    log(`   Nguồn: ${url}`);
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });

    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      log(`⚠️  Tải thất bại (HTTP ${res.status}).`);
      return null;
    }
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));

    log("Đang giải nén...");
    // Expand-Archive có sẵn trong mọi bản Windows còn được hỗ trợ; không cần
    // cài thêm công cụ giải nén nào.
    const unzip = tryRun(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${workDir}' -Force`,
      ],
      { stdio: "inherit" }
    );
    if (unzip.error || unzip.status !== 0) {
      log("⚠️  Giải nén thất bại.");
      return null;
    }

    // Zip của gyan.dev bung ra một thư mục có tên kèm số phiên bản
    // (ffmpeg-7.1-essentials_build/bin) — nên tìm ffmpeg.exe thay vì đoán tên.
    const found = findFile(workDir, "ffmpeg.exe", 4);
    if (!found) {
      log("⚠️  Giải nén xong nhưng không thấy ffmpeg.exe trong đó.");
      return null;
    }

    fs.mkdirSync(binDir, { recursive: true });
    const srcDir = path.dirname(found);
    for (const exe of ["ffmpeg.exe", "ffprobe.exe"]) {
      const src = path.join(srcDir, exe);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(binDir, exe));
    }
    fs.rmSync(workDir, { recursive: true, force: true });

    if (!fs.existsSync(path.join(binDir, "ffprobe.exe"))) {
      log("⚠️  Bản tải về thiếu ffprobe.exe — plugin cần cả hai.");
      return null;
    }
    log(`✅ Đã cài ffmpeg riêng cho plugin tại: ${binDir}`);
    log("   (không cần khởi động lại app, dùng được ngay)");
    return binDir;
  } catch (err) {
    log(`⚠️  Không tải được ffmpeg: ${err.message}`);
    return null;
  }
}

/**
 * Chọn URL zip ffmpeg để tải.
 *
 * KHÔNG dùng www.gyan.dev nữa: CI Windows thật trả về HTTP 503 chỉ sau 0,4
 * giây — host đó từ chối thẳng chứ không phải mạng chậm. Bản build vẫn là của
 * cùng tác giả, nhưng lấy từ GitHub Releases: đây chính là nơi winget tải về,
 * và một mạng công ty đã cho cài plugin từ GitHub thì cũng cho tải chỗ này.
 *
 * Hỏi API để lấy bản mới nhất, và có một URL ghim sẵn để rơi vào khi API bị
 * chặn hoặc hết hạn ngạch (API GitHub giới hạn theo IP khi gọi không token).
 */
const FFMPEG_ZIP_FALLBACK =
  "https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-essentials_build.zip";

async function resolveFfmpegZipUrl() {
  try {
    const res = await fetch("https://api.github.com/repos/GyanD/codexffmpeg/releases/latest", {
      headers: { "User-Agent": "tiktok-news-video-init", Accept: "application/vnd.github+json" },
    });
    if (res.ok) {
      const json = await res.json();
      const asset = (json.assets ?? []).find((a) => /essentials_build\.zip$/i.test(a.name ?? ""));
      if (asset?.browser_download_url) return asset.browser_download_url;
    }
  } catch {
    // Không nói gì — bản ghim bên dưới vẫn dùng được.
  }
  return FFMPEG_ZIP_FALLBACK;
}

/**
 * winget cài xong rồi, nhưng ffmpeg nằm ở đâu?
 *
 * winget thêm một shim vào PATH — mà PATH thì tiến trình này đã đọc xong từ
 * lúc khởi động, nên shim đó vô hình. File thật thì vẫn nằm trên đĩa. Tìm ra
 * nó và ghi lại đường dẫn là cứu được cả nhánh winget ngay trong phiên này,
 * thay vì bắt người dùng khởi động lại app.
 */
function findWingetFfmpegDir() {
  const roots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages"),
    process.env.ProgramData && path.join(process.env.ProgramData, "chocolatey", "bin"),
    "C:\\ffmpeg\\bin",
  ].filter(Boolean);

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const hit = findFile(root, "ffmpeg.exe", 5);
    if (hit && fs.existsSync(path.join(path.dirname(hit), "ffprobe.exe"))) {
      return path.dirname(hit);
    }
  }
  return null;
}

/** Tìm một file theo tên, đi sâu tối đa `maxDepth` cấp. */
function findFile(dir, name, maxDepth) {
  if (maxDepth < 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && e.name === name) return path.join(dir, e.name);
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = findFile(path.join(dir, e.name), name, maxDepth - 1);
      if (hit) return hit;
    }
  }
  return null;
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

/**
 * `name` nằm cạnh file node đang chạy thì trả về đường dẫn tuyệt đối, không
 * thì trả lại chính `name` để PATH lo (trường hợp máy đã có Node sẵn).
 */
export function siblingOfNode(name) {
  const candidate = path.join(path.dirname(process.execPath), name);
  return fs.existsSync(candidate) ? candidate : name;
}

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

  // npm/npx nằm CẠNH file node đang chạy — tìm ở đó trước, đừng trông vào PATH.
  //
  // Máy nhân viên không có Node sẵn. Agent cài Node rồi gọi init bằng đường
  // dẫn tuyệt đối (C:\Program Files\nodejs\node.exe), vì PATH mới cài chưa
  // tới được lệnh kế tiếp. Nhưng lúc đó `npm.cmd` trơn cũng không tìm thấy vì
  // cùng lý do — và bước cài Remotion sẽ chết ngay sau khi Node vừa chạy
  // được, một thất bại rất khó hiểu.
  const npmCmd = siblingOfNode(IS_WIN ? "npm.cmd" : "npm");
  const npxCmd = siblingOfNode(IS_WIN ? "npx.cmd" : "npx");

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
      log("");
      log("⚠️  Tải Chrome Headless Shell gặp lỗi.");
      log(`   Thử lại: mở terminal ở ${REMOTION_DIR} rồi chạy: npx remotion browser ensure`);
      if (IS_WIN) {
        log("   Trên Windows, thủ phạm thường gặp — theo thứ tự nên kiểm tra:");
        log("   1. Windows Defender / phần mềm diệt virus quét (hoặc chặn) file Chrome ~200MB");
        log("      vừa tải. Thử tạm dừng bảo vệ thời gian thực rồi chạy lại lệnh trên.");
        log("   2. Proxy hoặc tường lửa công ty chặn storage.googleapis.com.");
        log("   3. Mạng đứt giữa chừng — lệnh trên chạy lại được nhiều lần, không hại gì.");
      }
    }
  } else {
    log("");
    log('⚠️  "npm install" trong remotion/ gặp lỗi. Đọc thông báo lỗi phía trên trước.');
    if (IS_WIN) {
      // Đường dẫn plugin đã dài sẵn (~120 ký tự) trước khi npm lồng thêm
      // node_modules của các gói phụ thuộc, nên rất dễ vượt giới hạn 260 ký tự
      // mặc định của Windows. Lỗi hiện ra dưới dạng ENOENT/EPERM ở một đường
      // dẫn dài ngoằng, chẳng gợi ý gì về nguyên nhân thật.
      log("   Nếu lỗi nhắc tới ENOENT/EPERM kèm một đường dẫn rất dài, gần như chắc chắn là");
      log("   giới hạn 260 ký tự (MAX_PATH) của Windows. Bật đường dẫn dài, chạy PowerShell");
      log("   với quyền Administrator:");
      log("     New-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem' \\");
      log("       -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force");
      log("   Khởi động lại máy, rồi chạy lại init.");
    }
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
//
// MẶC ĐỊNH init chỉ hỏi ĐÚNG MỘT câu: ElevenLabs API key. Thư mục workspace,
// voice_id và nhịp đọc đều đã có giá trị mặc định do tác giả chọn sau khi đo
// đạc (Hạnh / 4x / ~/Desktop/tiktok-news-video-workspace) -- hỏi lại chúng là
// bắt một nhân viên không rành kỹ thuật quyết định ba việc mà họ không có
// thông tin để quyết, và câu trả lời đúng luôn là "Enter".
//
// Ba giá trị đó vẫn đổi được, ở đúng chỗ mà việc đổi có nghĩa:
//   - cho MỘT video:  synthesizeScript({ voiceId, paceLabel })
//   - vĩnh viễn:      `npm run init -- --nang-cao` (hoặc --advanced)
// ---------------------------------------------------------------------------

async function stepConfigure(ask, { advanced = false } = {}) {
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

  // Những gì đã có sẵn luôn thắng giá trị mặc định — init chạy lại nhiều lần
  // (mỗi bản cập nhật plugin là một lần) và không lần nào được phép xoá cấu
  // hình cũ của người dùng.
  const savedVoiceId = existingConfig?.voiceId || existingEnv.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const savedPace = existingConfig?.narrationPace || DEFAULT_PACE_LABEL;
  const savedKey = existingEnv.ELEVENLABS_API_KEY || "";
  const savedWorkspace = existingConfig?.workspaceDir || null;
  const bgmLibrary = Array.isArray(existingConfig?.bgmLibrary) ? existingConfig.bgmLibrary : [];

  // -------------------------------------------------------------------------
  // Chế độ mặc định: một câu hỏi duy nhất, và chỉ khi thật sự còn thiếu key.
  // -------------------------------------------------------------------------
  if (!advanced) {
    // Hỏi thư mục bằng cách KÉO THẢ, không phải gõ. Người quản trị phát sẵn
    // cho nhân viên một thư mục mẫu; nhân viên chỉ việc kéo nó vào ô chat và
    // đường dẫn tự hiện ra. Không dò, không đoán, không phải nhớ vị trí.
    const workspaceDir = savedWorkspace
      ? path.resolve(savedWorkspace)
      : await askWorkspaceDir(ask, null);
    ensureWorkspaceSubdirs(workspaceDir);

    if (savedKey) {
      log("Máy này đã cấu hình xong từ trước — không cần nhập lại gì cả.");
      log(`  - Thư mục workspace: ${workspaceDir}`);
      log(`  - Giọng đọc: ${savedVoiceId}`);
      log(`  - Nhịp đọc: ${savedPace}`);
      log("  - ElevenLabs API key: đã có");
      log("\n(Muốn đổi thư mục / giọng / nhịp đọc: chạy lại init kèm --nang-cao)");
      return { workspaceDir, voiceId: savedVoiceId, apiKey: savedKey, narrationPace: savedPace, bgmLibrary, wrote: false };
    }

    log("");
    log(`Giọng đọc: Hạnh — nữ trẻ giọng Bắc, rõ chữ, hợp tin tức. Nhịp đọc: ${savedPace}.`);
    log("");
    log("Còn một thứ nữa cần bạn điền: API key ElevenLabs (để plugin tự lồng tiếng).");
    log("Lấy key ở: https://elevenlabs.io/app/settings/api-keys");
    log("Mỗi người dùng key riêng của mình, không dùng chung.");
    const apiKey = await askApiKey(ask);

    return { workspaceDir, voiceId: savedVoiceId, apiKey, narrationPace: savedPace, bgmLibrary, wrote: true };
  }

  // -------------------------------------------------------------------------
  // Chế độ --nang-cao: hỏi đủ bốn thứ.
  // -------------------------------------------------------------------------
  if (existingConfig || Object.keys(existingEnv).length > 0) {
    log("Đã tìm thấy cấu hình trước đó:");
    if (savedWorkspace) log(`  - Thư mục workspace: ${savedWorkspace}`);
    log(`  - Voice ID: ${savedVoiceId}`);
    log(`  - ElevenLabs API key: ${savedKey ? "đã có" : "chưa có"}`);
    log(`  - Nhịp đọc: ${savedPace}`);
    const answer = await ask("\nBạn có muốn cấu hình lại không? (y/N): ");
    if (!answer.trim().toLowerCase().startsWith("y")) {
      if (savedWorkspace) ensureWorkspaceSubdirs(savedWorkspace);
      log("Giữ nguyên cấu hình hiện tại (không ghi đè).");
      return { workspaceDir: savedWorkspace, voiceId: savedVoiceId, apiKey: savedKey, narrationPace: savedPace, bgmLibrary, wrote: false };
    }
  }

  // --- Thư mục workspace (chứa assets/, bgm-library/, output/) ---
  log(
    "\nThư mục workspace là nơi bạn bỏ ảnh/video vào và nơi video render ra sẽ được lưu."
  );
  log(
    "Đây LUÔN là một thư mục bình thường, cố định trên máy bạn — không đổi dù plugin có update bao nhiêu lần."
  );
  const workspaceDir = await askWorkspaceDir(ask, savedWorkspace);
  ensureWorkspaceSubdirs(workspaceDir);

  // --- ElevenLabs API key ---
  // Hai thứ khác nhau, hỏi riêng: key là tài khoản (bí mật, tính tiền theo
  // ký tự), voice_id là GIỌNG (công khai, ai cũng dùng chung được).
  section("Giọng đọc: cần HAI thứ");
  log("1) API key  — tài khoản ElevenLabs của bạn. Bí mật, và nó tính tiền theo số ký tự.");
  log("2) voice_id — chọn ai đọc. Không bí mật; đây là mã giọng lấy từ thư viện chung.");
  log("");
  log("Lấy API key ở: https://elevenlabs.io/app/settings/api-keys");
  log("Nếu bạn luôn tự cung cấp file MP3 lời đọc riêng, có thể bỏ qua key (nhấn Enter).");
  const apiKey = await askApiKey(ask, savedKey);

  // --- Voice ID ---
  log("\nvoice_id là mã giọng đọc, lấy trong Voice Library của ElevenLabs.");
  log("Mở https://elevenlabs.io/app/voice-library, lọc ngôn ngữ Vietnamese, nghe thử,");
  log("bấm vào giọng nào bạn thích rồi copy ID của nó.");
  log(`\nMặc định là ${DEFAULT_VOICE_ID} — "Hạnh", nữ trẻ giọng Bắc, rõ chữ, hợp tin tức.`);
  log("(Chọn sau khi thu thử 14 giọng Việt trên cùng một kịch bản.)");
  const voiceId = await askVoiceId(ask, apiKey, savedVoiceId);

  // --- Mức kéo nhanh lời đọc ---
  const narrationPace = await askNarrationPace(ask, existingConfig?.narrationPace);

  return { workspaceDir, voiceId, apiKey, narrationPace, bgmLibrary, wrote: true };
}

/**
 * Hỏi thư mục làm việc — bằng cách kéo thả, không bắt gõ đường dẫn.
 *
 * Kéo một thư mục từ File Explorer/Finder thả vào ô chat sẽ tự chèn đường dẫn
 * đầy đủ. Đó là thao tác duy nhất ở đây mà người không rành máy làm được chắc
 * chắn — gõ tay một đường dẫn Windows dài là chỗ sai chính tả, còn tự đi dò
 * xem Desktop thật nằm ở đâu là đoán mò một thứ mà người quản trị đã quyết
 * sẵn khi phát thư mục mẫu cho nhân viên.
 *
 * expandHome() bóc cặp nháy kép mà Windows tự thêm vào khi kéo thả / "Copy as
 * path", nên chuỗi dán vào dùng được nguyên trạng.
 */
async function askWorkspaceDir(ask, savedWorkspace) {
  const fallback = savedWorkspace || DEFAULT_WORKSPACE_DIR;
  log("");
  log("Thư mục làm việc: nơi chứa ảnh/video và nơi video render xong được lưu.");
  log("👉 KÉO thư mục đó từ File Explorer/Finder rồi THẢ vào ô chat này — đường dẫn sẽ tự hiện ra.");
  const answer = await ask(`(hoặc Enter để dùng: ${fallback})\n> `);
  const dir = path.resolve(expandHome(answer.trim() || fallback));
  log(`✅ Thư mục làm việc: ${dir}`);
  return dir;
}

/**
 * Gọi ElevenLabs, trả về { ok, status, json } — không bao giờ throw.
 *
 * Init phải chạy được cả khi không có mạng: mất mạng là chuyện của lúc này,
 * không phải bằng chứng rằng key sai. Nên lỗi mạng được phân biệt rõ với
 * lỗi 401/400 và không bị báo thành "key hỏng".
 */
async function callElevenLabs(url, apiKey) {
  try {
    const res = await fetch(url, { headers: { "xi-api-key": apiKey } });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    return { ok: false, status: null, networkError: err.message };
  }
}

/**
 * Hỏi API key VÀ kiểm chứng nó ngay.
 *
 * Trước đây init nhận bất cứ chuỗi nào người dùng gõ. Key sai một ký tự chỉ
 * lộ ra ở Bước 2 của lần làm video đầu tiên -- giữa chừng, sau khi đã dựng
 * xong kịch bản và kiểm asset. Một lần gọi GET /v1/user bắt được ngay tại đây.
 */
async function askApiKey(ask, savedKey = "") {
  for (;;) {
    const prompt = savedKey
      ? "\nNhập ElevenLabs API key (Enter để giữ key đang lưu): "
      : "\nNhập ElevenLabs API key (Enter để bỏ qua): ";
    const answer = (await ask(prompt)).trim();
    if (!answer) {
      // Enter KHÔNG được xoá key đang có. Người dùng vào chế độ nâng cao
      // thường là để đổi giọng hoặc nhịp đọc, và một cú Enter ở câu hỏi này
      // từng đủ để mất key -- lỗi chỉ lộ ra ở bước lồng tiếng của video sau.
      if (savedKey) {
        log("↩️  Giữ nguyên API key đang lưu.");
        return savedKey;
      }
      log("⏭️  Bỏ qua API key — bạn sẽ phải tự cung cấp file MP3 lời đọc cho mỗi video.");
      return "";
    }

    const res = await callElevenLabs("https://api.elevenlabs.io/v1/user", answer);
    if (res.ok) {
      const sub = res.json?.subscription ?? {};
      const left = (sub.character_limit ?? 0) - (sub.character_count ?? 0);
      log(`✅ Key hợp lệ${sub.tier ? ` (gói ${sub.tier})` : ""}${sub.character_limit ? `, còn ${left.toLocaleString("vi-VN")} ký tự` : ""}.`);
      return answer;
    }
    if (res.status === 401) {
      log("❌ Key bị ElevenLabs từ chối (401). Kiểm tra lại ở https://elevenlabs.io/app/settings/api-keys");
      const retry = await ask("Nhập lại? (Y/n): ");
      if (retry.trim().toLowerCase().startsWith("n")) return answer;
      continue;
    }
    // Mạng lỗi, hoặc ElevenLabs đang trục trặc: giữ key, nói rõ là CHƯA kiểm được.
    log(`⚠️  Chưa kiểm chứng được key (${res.networkError ?? `HTTP ${res.status}`}). Vẫn lưu lại, nhưng nếu sai thì bước tạo giọng sẽ báo lỗi.`);
    return answer;
  }
}

/**
 * Hỏi voice_id VÀ kiểm chứng nó nói được tiếng Việt.
 *
 * Cái vế thứ hai mới là quan trọng, và nó đến từ một sai lầm có thật: một
 * model đọc nhanh nhưng không hỗ trợ tiếng Việt đã lọt qua tới tận lúc người
 * dùng nghe thử. Giọng cũng vậy -- voice_id mặc định cũ là bản clone để đọc
 * tiếng Indonesia. `verified_languages` trong API trả lời được câu này, nên
 * không có lý do gì để đoán.
 */
async function askVoiceId(ask, apiKey, savedVoiceId = DEFAULT_VOICE_ID) {
  for (;;) {
    // Enter giữ giọng đang lưu, không quay về mặc định — cùng lý do với key.
    const isDefault = savedVoiceId === DEFAULT_VOICE_ID;
    const answer =
      (await ask(`\nNhập voice_id (Enter để ${isDefault ? "dùng Hạnh" : `giữ ${savedVoiceId}`}): `)).trim() ||
      savedVoiceId;

    if (!apiKey) {
      log(`⏭️  Chưa có API key nên chưa kiểm chứng được giọng. Lưu ${answer}.`);
      return answer;
    }

    const res = await callElevenLabs(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(answer)}`, apiKey);
    if (!res.ok) {
      if (res.status === 400 || res.status === 404) {
        log(`❌ Không tìm thấy voice_id "${answer}" trên tài khoản này.`);
        const retry = await ask("Nhập lại? (Y/n): ");
        if (retry.trim().toLowerCase().startsWith("n")) return answer;
        continue;
      }
      log(`⚠️  Chưa kiểm chứng được giọng (${res.networkError ?? `HTTP ${res.status}`}). Vẫn lưu ${answer}.`);
      return answer;
    }

    const v = res.json ?? {};
    const langs = new Set([
      ...(v.verified_languages ?? []).map((l) => l.language),
      ...(v.labels?.language ? [v.labels.language] : []),
    ]);
    const labels = v.labels ?? {};
    const traits = [labels.gender, labels.age, labels.accent, labels.descriptive].filter(Boolean).join(", ");
    log(`✅ Giọng: "${v.name}"${traits ? ` — ${traits}` : ""}`);

    if (!langs.has("vi")) {
      log("");
      log("⚠️  CẢNH BÁO: giọng này KHÔNG được ElevenLabs xác nhận là nói tiếng Việt.");
      log(`   Ngôn ngữ nó hỗ trợ: ${[...langs].join(", ") || "(không khai báo)"}`);
      log("   Một giọng sai ngôn ngữ vẫn đọc ra âm thanh, nhưng phát âm chữ Việt");
      log("   bằng bộ âm của tiếng khác — nghe là biết ngay.");
      const keep = await ask("Vẫn dùng giọng này? (y/N): ");
      if (!keep.trim().toLowerCase().startsWith("y")) continue;
    }
    return answer;
  }
}

/**
 * Hỏi mức kéo nhanh lời đọc.
 *
 * Vì sao phải có bước này: eleven_v3 BỎ QUA tham số `speed` (đã đo, xem
 * scripts/narration-pace.mjs). Nên tốc độ đọc chỉ có thể đến từ một bước kéo
 * sau khi tổng hợp -- và nó là thứ người dùng phải tự chọn, không phải thứ
 * đoán hộ, vì ngưỡng nghe được của mỗi người mỗi khác.
 *
 * Nhãn "2x".."5x" là do tác giả đặt và KHÔNG phải hệ số thật ("5x" = nấc thứ
 * năm, tức 1.5x). Nên mỗi dòng bắt buộc in kèm hệ số thật và số từ/phút --
 * nếu chỉ đưa cái nhãn thì người chọn đang bị đánh lừa.
 */
async function askNarrationPace(ask, existing) {
  section("Nhịp đọc");
  log("ElevenLabs đọc tiếng Việt khá thong thả. Video tin tức TikTok cần nhanh hơn,");
  log("nên sau khi tạo giọng, plugin có thể kéo nhanh lời đọc lên. Cao độ giữ nguyên");
  log("(không bị the thé), nhưng kéo càng mạnh thì đuôi từ càng dễ nghe rung.");
  log("");
  for (const [i, level] of PACE_LEVELS.entries()) {
    const isDefault = level.label === (existing ?? DEFAULT_PACE_LABEL);
    log(`  ${i + 1}. ${level.label.padEnd(5)} ${describe(level)}${isDefault ? "   ← mặc định" : ""}`);
  }
  log("");
  log("Đổi lúc nào cũng được: sửa \"narrationPace\" trong config.local.json.");
  const answer = await ask(`Chọn 1-${PACE_LEVELS.length} (Enter để giữ mặc định): `);
  const picked = PACE_LEVELS[Number(answer.trim()) - 1];
  const chosen = picked?.label ?? existing ?? DEFAULT_PACE_LABEL;
  log(`✅ Nhịp đọc: ${chosen} (atempo ${paceLevel(chosen).tempo.toFixed(2)}x)`);
  return chosen;
}

function writeConfigFiles({ workspaceDir, voiceId, apiKey, narrationPace, bgmLibrary }) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  // Hợp nhất, không ghi đè: `ffmpegDir` được Bước 3 ghi vào từ trước, và các
  // khoá về sau cũng vậy — dựng lại object từ đầu ở đây là âm thầm xoá chúng.
  let prev = {};
  try {
    prev = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) ?? {};
  } catch {
    prev = {};
  }
  const configObj = {
    ...prev,
    workspaceDir,
    voiceId,
    narrationPace: narrationPace || DEFAULT_PACE_LABEL,
    bgmLibrary: bgmLibrary || [],
  };
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
      // Đây là chỗ DUY NHẤT còn nhắc tới phiên remote, và chỉ khi ffmpeg đã
      // thật sự thiếu sau khi restart -- tức lúc thông tin đó mới có ích.
      //
      // Đường tải-thẳng ở Bước 3 dùng được ngay, nên tới được đây nghĩa là cả
      // tải lẫn winget đều hỏng: gần như luôn là mạng công ty chặn, chứ không
      // phải PATH.
      : "ffmpeg CHƯA sẵn sàng. Thường là do mạng/tường lửa công ty chặn lúc tải. Nếu Bước 3 báo đã cài bằng winget thì đóng hẳn rồi mở lại app và chạy init một lần nữa; ngoài ra thì nhắn cho người quản trị plugin.",
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
  log(`Thư mục workspace (assets/bgm-library/output): ${config.workspaceDir || "(chưa cấu hình)"}`);
  log(`Voice ID mặc định: ${config.voiceId}`);
  log(`Nhịp đọc: ${config.narrationPace} (atempo ${paceLevel(config.narrationPace).tempo.toFixed(2)}x)`);
  if (config.wrote) {
    log(`\nĐã ghi cấu hình vào:\n  - ${CONFIG_PATH}\n  - ${ENV_PATH}`);
  }

  const allCriticalOk = items[0].ok; // Node bắt buộc; các mục khác chỉ cảnh báo
  log("");
  if (allCriticalOk) {
    log("Xong! Bạn có thể bắt đầu tạo video (xem skill /tiktok-news-video trong Claude Code).");
  }
  if (items.some((i) => !i.ok)) {
    log("Lưu ý: một vài mục ở trên còn thiếu (❌) — bạn vẫn có thể dùng thử, nhưng hãy xử lý các mục đó trước khi render video thật.");
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  // Cố tình KHÔNG mở đầu bằng bài giảng Local-vs-Remote. Người dùng là nhân
  // viên không rành kỹ thuật, và cả hai app đều mặc định phiên Local -- nên
  // đoạn đó chỉ đặt ra một câu hỏi mà 99% người đọc không cần trả lời. Nếu
  // họ THỰC SỰ đang ở phiên remote, ffmpeg sẽ báo thiếu và thông báo lỗi ở
  // cuối mới nhắc tới nó, tức là đúng lúc nó có ích.
  const advanced = process.argv.slice(2).some((a) => a === "--nang-cao" || a === "--advanced");

  log("tiktok-news-video — thiết lập lần đầu cho máy này (npm run init)");
  if (advanced) log("(chế độ nâng cao: hỏi cả thư mục, giọng đọc và nhịp đọc)");

  stepDetectOS();
  stepCheckNode();
  const { info: ffmpegInfo } = await stepFfmpeg();
  const remotionResult = stepRemotion();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = createAsk(rl);
  let config;
  try {
    config = await stepConfigure(ask, { advanced });
  } finally {
    rl.close();
  }

  if (config.wrote) {
    writeConfigFiles(config);
  }

  printFinalChecklist({ ffmpegInfo, remotionResult, config });
  // Cố tình KHÔNG mở thư mục assets/ ở đây nữa. Nhân viên không bao giờ phải
  // tự bỏ file vào đó: họ chuẩn bị thư mục ảnh ở bất cứ đâu, kéo vào khung
  // chat, và clean-source chép nó vào workspace. Chỗ duy nhất họ cần một cửa
  // sổ file là lúc lấy video thành phẩm — nên việc mở cửa sổ nằm ở cuối
  // scripts/render.mjs, chứ không phải ở đây.
}

// Only run the installer when invoked as a script. Without this guard, a test
// (or anything else) that imports `expandHome` would kick off npm install and
// sit waiting for stdin.
//
// The try/catch is load-bearing: under `node -e` / `node --eval` there is no
// argv[1] at all, and pathToFileURL(undefined) throws.
function isMain() {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch((err) => {
    console.error("\n❌ Có lỗi không mong muốn xảy ra khi chạy init:");
    console.error(err?.stack || err);
    process.exit(1);
  });
}
