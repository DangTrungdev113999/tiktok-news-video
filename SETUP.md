# Cài đặt plugin (đồng nghiệp đọc file này)

Plugin này cài được trên **Claude Code** (CLI hoặc tab Code của app Claude
Desktop) và **Codex CLI / ChatGPT desktop app** (2 app này dùng chung 1 định
dạng plugin). Chọn đúng phần bên dưới theo app bạn đang dùng, không cần
clone/git tay gì cả.

Sau khi cài xong ở app nào, luôn chạy bước **Init** trước — bước này tự kiểm
tra/cài ffmpeg + Remotion, rồi hỏi bạn API key ElevenLabs **của riêng bạn**
(không dùng chung key với ai khác) + thư mục lưu video output.

### ⚠️ Đọc trước: LUÔN chọn phiên làm việc kiểu Local

Pipeline này chạy lệnh thật (ffmpeg, Node) và đọc/ghi file ảnh/video thật
trên máy bạn — nó **không** chạy được trong một phiên cloud/remote, vì
phiên đó không thấy ổ đĩa hay ffmpeg trên máy bạn.

Cả **Claude Code Desktop** (mục *Environment* khi bắt đầu session: Local /
Remote / SSH / WSL) lẫn **ChatGPT desktop app** đều cho chọn giữa phiên
Local và phiên cloud/remote. Luôn chọn **Local**. Nếu chọn nhầm Remote/cloud,
plugin vẫn cài và hiện ra bình thường, nhưng khi chạy sẽ báo thiếu
ffmpeg/không thấy file — không phải lỗi của bạn, chỉ là chọn sai môi trường.
Claude Code chạy trong terminal thường (không phải Desktop app) và Codex CLI
chạy trong terminal đều luôn là local, không cần để ý mục này.

---

## Claude Code CLI (terminal)

Gõ lần lượt 2 lệnh sau:

```
/plugin marketplace add DangTrungdev113999/tiktok-news-video
/plugin install tiktok-news-video@tiktok-news-video-marketplace
```

Sau khi cài xong, chạy `/init`, trả lời các câu hỏi (thư mục output, API key
ElevenLabs). Xong thì dùng `/make-video` để tạo video.

## Claude Code Desktop (app Claude, tab **Code** — không phải tab Chat)

⚠️ App Claude có **2 hệ Plugins khác nhau**: mục Settings → Customize →
Plugins (dùng cho tab Chat/Cowork) **KHÔNG phải** cái này — plugin cài ở đó
sẽ không chạy được (không có ffmpeg/quyền đọc file máy bạn). Dùng đúng chỗ
sau:

1. Mở tab **Code**, bắt đầu session mới, chọn **Environment = Local** (không
   chọn Remote).
2. Trong khung chat, bấm nút **+** cạnh ô nhập → **Plugins** → **Add plugin**.
3. Nhập nguồn marketplace: `DangTrungdev113999/tiktok-news-video`, tìm và
   cài plugin "TikTok News Video".
4. Gõ `/init` trong chat, trả lời các câu hỏi. Xong thì gõ `/make-video`.

(Nếu bạn từng cài qua CLI trên máy này rồi, tab Code sẽ tự thấy plugin luôn
vì CLI và Desktop dùng chung cấu hình — không cần cài lại.)

---

## Codex CLI / ChatGPT desktop app (tab Plugins)

Mở **Plugins → Add plugin marketplace**, điền:

| Trường | Giá trị |
|---|---|
| Source | `DangTrungdev113999/tiktok-news-video` |
| Git ref | `main` |
| Sparse paths | *(để trống)* |

Bấm **Add marketplace**, sau đó bấm **Install** trên plugin "TikTok News
Video" vừa hiện ra.

Sau khi cài xong, gõ:

```
$tiktok-news-video-init
```
*(ChatGPT app: gõ `@tiktok-news-video-init`)*

Trả lời các câu hỏi giống như trên. Xong thì gọi:

```
$tiktok-news-video
```
*(ChatGPT app: `@tiktok-news-video`)*

Skill invoke bằng `$` (Codex CLI) hoặc `@` (ChatGPT app) — gõ thử cả 2 dạng
nếu ô nhập liệu không tự gợi ý, vì cách gõ có thể khác nhau giữa các bản.

⚠️ Nhắc lại: nếu ChatGPT app hỏi chọn project/tác vụ Local hay cloud/remote,
luôn chọn **Local** (xem lưu ý ở đầu file).

---

## Sau khi init xong

1. Copy ảnh/video vào thư mục `assets/`.
2. Gọi lệnh tạo video (`/make-video` hoặc `$tiktok-news-video`/`@tiktok-news-video`),
   paste kịch bản dạng:
   ```
   Scene 1: [nội dung] — ảnh: hop-bao.jpg
   Scene 2: [nội dung] — video: phong-van.mp4
   ```
3. Duyệt/sửa kịch bản đã được xào lại cho dễ hiểu khi được hỏi, phần còn lại
   (lồng tiếng, nhạc nền, hiệu ứng, render) tự động.

`assets/`, `bgm-library/`, `output/` nằm trong **thư mục workspace** bạn chọn
lúc `/init` (mặc định: `~/Desktop/tiktok-news-video-workspace`) — không phải
trong thư mục cài plugin. Thư mục này KHÔNG bị mất/reset khi plugin có bản
cập nhật mới.

---

## Khi có bản cập nhật mới

Config, API key, ảnh/video, video đã render của bạn luôn an toàn qua các lần
cập nhật (chúng nằm ngoài thư mục cài plugin) — cứ cập nhật thoải mái theo
đúng lệnh dưới đây cho từng app:

**Claude Code (CLI hoặc Desktop):**
```
/plugin uninstall tiktok-news-video@tiktok-news-video-marketplace
/plugin install tiktok-news-video@tiktok-news-video-marketplace
```
(Đã test thật: `/plugin update` không đáng tin cậy để lấy đúng bản mới nhất
— gỡ cài rồi cài lại mới chắc chắn lấy bản mới nhất.)

**Codex CLI / ChatGPT desktop app:**
```
codex plugin marketplace upgrade tiktok-news-video-marketplace
codex plugin add tiktok-news-video@tiktok-news-video-marketplace
```
(Trong ChatGPT app, tìm nút tương đương — "Refresh"/"Update" ở marketplace,
rồi bấm Install lại trên plugin nếu thấy bản mới.)
