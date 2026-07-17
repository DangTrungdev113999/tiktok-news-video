# TikTok News Video

Plugin cho Claude Code/Desktop: từ ảnh/video + kịch bản gõ thẳng trong chat →
video tin tức chuẩn TikTok (1080x1920) render tự động qua Remotion.

## Dùng thế nào

1. Copy/clone thư mục này về máy (Windows hoặc Mac đều được).
2. Mở Claude Code/Desktop trong thư mục này, chạy `/init` — làm 1 lần duy
   nhất trên mỗi máy. Bước này tự kiểm tra/cài ffmpeg + Remotion, rồi hỏi bạn
   muốn lưu output ở đâu + API key ElevenLabs (nếu có).
3. Bỏ ảnh/video vào thư mục `assets/`.
4. Chạy `/make-video`, paste kịch bản theo dạng:
   ```
   Scene 1: [nội dung] — ảnh: hop-bao.jpg
   Scene 2: [nội dung] — video: phong-van.mp4
   ```
5. Agent sẽ xào lại kịch bản cho dễ hiểu, cho bạn duyệt/sửa, rồi tự động lo
   phần lồng tiếng (TTS ElevenLabs nếu bạn không có sẵn file mp3), nhạc nền,
   hiệu ứng ảnh/video, và render ra video hoàn chỉnh.

## Cấu trúc thư mục

```
assets/          # ảnh/video dùng chung, ít thay đổi giữa các video
bgm-library/      # nhạc nền đã lưu, chọn lại lần sau
output/          # video đã render (hoặc thư mục bạn chọn lúc /init)
knowledge/       # các "luật" cố định: xào kịch bản, hiệu ứng, TTS tags
scripts/         # engine thật sự chạy pipeline
remotion/        # project Remotion dùng để render
docs/            # spec thiết kế đầy đủ
```

Xem chi tiết thiết kế + lý do các quyết định tại
`docs/superpowers/specs/2026-07-17-tiktok-news-video-design.md`.
