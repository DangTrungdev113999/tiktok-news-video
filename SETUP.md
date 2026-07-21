# Cài đặt plugin (đồng nghiệp đọc file này)

Plugin này cài được trên **Claude Code** (CLI hoặc tab Code của app Claude
Desktop) và **Codex CLI / ChatGPT desktop app** (2 app này dùng chung 1 định
dạng plugin). Chọn đúng phần bên dưới theo app bạn đang dùng, không cần
clone/git tay gì cả.

Sau khi cài xong ở app nào, luôn chạy bước **Init** trước. Init tự làm hết
phần kỹ thuật (ffmpeg, Remotion, thư mục làm việc) và **chỉ hỏi bạn đúng một
thứ: API key ElevenLabs của riêng bạn** (không dùng chung key với ai khác).
Lấy key ở https://elevenlabs.io/app/settings/api-keys — đăng ký tài khoản,
vào mục API Keys, bấm tạo key mới rồi copy.

Các lần sau (ví dụ sau khi cập nhật plugin) init không hỏi gì cả, cứ chạy là
xong.

> **Máy chưa có Node.js thì init không chạy được.** Đây là thứ duy nhất bạn
> phải cài tay trước, một lần duy nhất: vào https://nodejs.org, tải bản
> **LTS**, cài bằng cách bấm Next đến hết, rồi **đóng hẳn app và mở lại**.
> Nếu không chắc máy đã có chưa thì cứ cài — cài đè lên không sao cả.

---

## Claude Code CLI (terminal)

Gõ lần lượt 2 lệnh sau:

```
/plugin marketplace add DangTrungdev113999/tiktok-news-video
/plugin install tiktok-news-video@tiktok-news-video-marketplace
```

Sau khi cài xong, chạy `/tiktok-news-video-init`, trả lời các câu hỏi (thư mục output, API key
ElevenLabs). Xong thì dùng `/tiktok-news-video` để tạo video.

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
4. Gõ `/tiktok-news-video-init` trong chat, trả lời các câu hỏi. Xong thì gõ `/tiktok-news-video`.

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

---

## Sau khi init xong

1. Gom ảnh/video của tập đó vào **một thư mục, để ở đâu cũng được** (Desktop,
   Downloads, USB...). Đặt tên file theo đúng thứ tự bạn muốn chúng xuất hiện.
   Rồi **kéo thư mục đó thả vào ô chat** và gọi `/clean-source` — plugin tự
   chép nó vào đúng chỗ và đổi tên thành `anh_1`, `anh_2`, `video_1`...
   Thư mục gốc của bạn giữ nguyên, không bị đổi gì.
2. Gọi lệnh tạo video (`/tiktok-news-video` hoặc `$tiktok-news-video`/`@tiktok-news-video`),
   paste kịch bản dạng:
   ```
   Scene 1: [nội dung] — ảnh: hop-bao.jpg
   Scene 2: [nội dung] — video: phong-van.mp4
   ```
3. Chọn nhạc nền khi được hỏi, phần còn lại
   (lồng tiếng, nhạc nền, hiệu ứng, render) tự động. **Render xong plugin tự
   mở cửa sổ và trỏ thẳng vào file MP4** — không phải đi tìm.

Bạn không cần biết plugin cất file ở đâu: ảnh tự vào đúng chỗ ở bước
`/clean-source`, video thành phẩm thì tự hiện ra ở cuối. (Nếu tò mò: mọi thứ
nằm trong `tiktok-news-video-workspace` ở thư mục người dùng của bạn, cố tình
KHÔNG để trên Desktop để OneDrive không đồng bộ hàng trăm MB video mỗi tập.
Thư mục này không bị mất khi plugin cập nhật.)

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

**ChatGPT desktop app (chỉ thao tác chuột, không cần gõ lệnh gì):**
1. Vào **Plugins**, gỡ plugin "TikTok News Video" ra (nút xoá/"..." trên
   dòng đó — tên nút có thể là "Remove"/"Uninstall").
2. Gỡ luôn cả **marketplace** `tiktok-news-video-marketplace` (không chỉ
   plugin) — mục đích là để app tải lại từ đầu, tránh dùng bản cache cũ.
3. Bấm **Add** → **Add plugin marketplace**, điền lại đúng Source/Git ref
   như lúc cài lần đầu (xem bảng ở trên) → **Add marketplace** → **Install**
   lại plugin.

⚠️ Cách này dựa trên cơ chế đã test qua Codex CLI (`marketplace upgrade` +
cài lại lấy đúng bản mới nhất) — tôi chưa tự tay bấm được trong UI ChatGPT
app thật để xác nhận từng bước, vì tôi không điều khiển được app đó trực
tiếp. Nếu làm theo mà vẫn không thấy thay đổi (ví dụ file/skill mới không
xuất hiện), báo lại để kiểm tra thêm.

**Codex CLI (dùng terminal):**
```
codex plugin marketplace upgrade tiktok-news-video-marketplace
codex plugin add tiktok-news-video@tiktok-news-video-marketplace
```
