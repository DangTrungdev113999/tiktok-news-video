# Cài đặt plugin (đồng nghiệp đọc file này)

Plugin này cài được trên **Claude Code** (CLI hoặc desktop app) và **Codex CLI /
ChatGPT desktop app** (2 app này dùng chung 1 định dạng plugin). Chọn đúng
phần bên dưới theo app bạn đang dùng, không cần clone/git tay gì cả.

Sau khi cài xong ở app nào, luôn chạy bước **Init** trước — bước này tự kiểm
tra/cài ffmpeg + Remotion, rồi hỏi bạn API key ElevenLabs **của riêng bạn**
(không dùng chung key với ai khác) + thư mục lưu video output.

---

## Claude Code (CLI hoặc desktop app)

Gõ lần lượt 2 lệnh sau:

```
/plugin marketplace add DangTrungdev113999/tiktok-news-video
/plugin install tiktok-news-video@tiktok-news-video-marketplace
```

Sau khi cài xong, chạy:

```
/init
```

Trả lời các câu hỏi (thư mục output, API key ElevenLabs). Xong thì dùng
`/make-video` để tạo video.

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

### ⚠️ Lưu ý quan trọng cho ChatGPT app

Pipeline này cần chạy lệnh thật (ffmpeg, Node) và đọc/ghi file ảnh/video thật
trên máy bạn. Trong ChatGPT app, khi bắt đầu phiên làm việc, **phải chọn một
project/thư mục LOCAL** (local task) — **không** chọn kiểu tác vụ
cloud/remote. Nếu chọn nhầm cloud task, plugin sẽ cài được và hiện ra bình
thường, nhưng khi chạy sẽ báo lỗi thiếu ffmpeg/không thấy file, vì phiên đó
không chạy trên máy bạn. Codex CLI chạy trên terminal máy bạn nên không có
vấn đề này.

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
