/**
 * scripts/ffmpeg-path.mjs
 *
 * Nơi DUY NHẤT trả lời câu hỏi "chạy ffmpeg/ffprobe bằng đường dẫn nào".
 *
 * Vì sao cần một lớp phân giải riêng thay vì cứ gọi thẳng `ffmpeg`:
 *
 * Trên Windows, cách cài ffmpeg thông thường (winget, hoặc giải nén thủ công)
 * đều kết thúc bằng việc THÊM MỘT THƯ MỤC VÀO PATH. Mà PATH thì chỉ được nạp
 * lúc tiến trình khởi động — nên ngay sau khi cài xong, chính phiên làm việc
 * vừa cài nó vẫn không thấy ffmpeg. Với người dùng, hiện tượng là: init báo
 * "đã cài xong" rồi ngay dòng dưới báo "chưa sẵn sàng", và cách duy nhất để
 * thoát ra là đóng hẳn app rồi chạy init lần thứ hai. Không ai đoán ra điều
 * đó, và với nhân viên không rành kỹ thuật thì đây là chỗ họ bỏ cuộc.
 *
 * Cách vòng qua: init tải sẵn bản ffmpeg tĩnh vào một thư mục cố định thuộc
 * quyền người dùng (CONFIG_DIR/bin), ghi đường dẫn đó vào config, và mọi
 * script gọi ffmpeg qua đây. Không đụng tới PATH thì cũng không có gì cần nạp
 * lại: cài xong là dùng được ngay trong cùng một phiên. Cũng không cần quyền
 * Administrator, và không cần winget có mặt.
 *
 * Thứ tự ưu tiên:
 *   1. config.local.json -> ffmpegDir  (bản plugin tự tải, chắc chắn dùng được)
 *   2. PATH                            (máy đã có sẵn ffmpeg — tôn trọng nó)
 *   3. báo lỗi bằng tiếng Việt, nói rõ phải làm gì
 *
 * Thứ tự này có chủ ý: bản plugin tự tải đứng TRƯỚC PATH. Nếu init đã phải
 * tải về thì nghĩa là PATH không dùng được vào lúc đó, và một bản trên PATH
 * xuất hiện sau lưng (hoặc hỏng) không nên âm thầm thay thế bản đã kiểm chứng.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CONFIG_PATH } from './workspace.mjs';

const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';

/** Thư mục init tải ffmpeg về, nếu có. Đọc lại mỗi lần — init có thể vừa ghi. */
function configuredDir() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return typeof cfg?.ffmpegDir === 'string' && cfg.ffmpegDir ? cfg.ffmpegDir : null;
  } catch {
    return null;
  }
}

/** `tool` chạy được thật không? Hỏi chính nó, không đoán qua sự tồn tại của file. */
export function works(binPath) {
  const r = spawnSync(binPath, ['-version'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

/**
 * Đường dẫn để chạy `ffmpeg` hoặc `ffprobe`.
 * @param {'ffmpeg'|'ffprobe'} tool
 * @returns {string} đường dẫn tuyệt đối, hoặc chính tên lệnh nếu nó nằm trên PATH
 */
export function binaryPath(tool) {
  const dir = configuredDir();
  if (dir) {
    const candidate = path.join(dir, tool + EXE);
    if (fs.existsSync(candidate)) return candidate;
  }
  return tool;
}

/**
 * Thông điệp cho lúc không tìm thấy — dùng chung để mọi script nói cùng một
 * câu, và câu đó nói được cho người không rành kỹ thuật phải làm gì tiếp.
 */
export function missingMessage(tool) {
  return (
    `Không tìm thấy '${tool}' trên máy này.\n` +
    `  Chạy lại bước init của plugin (skill tiktok-news-video-init) — nó sẽ tự cài.\n` +
    `  Nếu init đã chạy mà vẫn báo lỗi này, nhắn cho người quản trị plugin.`
  );
}

/** Có ffmpeg lẫn ffprobe dùng được không, và bằng đường nào. */
export function status() {
  const dir = configuredDir();
  const ffmpeg = binaryPath('ffmpeg');
  const ffprobe = binaryPath('ffprobe');
  return {
    ok: works(ffmpeg) && works(ffprobe),
    ffmpeg,
    ffprobe,
    source: dir && ffmpeg !== 'ffmpeg' ? 'plugin' : 'PATH',
  };
}
