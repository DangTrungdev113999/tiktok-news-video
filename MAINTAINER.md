# Ghi chú cho người phát triển plugin (không phải cho nhân viên)

Nhân viên đọc `SETUP.md`. File này là quy trình dev + release, đã verify
thật (không phải đoán) trên máy dev (`DangTrungdev113999`, Claude Code
v... + Codex CLI 0.144.5, tháng 7/2026).

## 1. Vòng lặp phát triển local (không cần push/cài lại mỗi lần sửa)

Plugin khi cài qua marketplace (Claude Code hoặc Codex) bị **copy vào một
thư mục cache gắn với phiên bản** — sửa code ở `~/Desktop/tiktok-news-video`
sẽ KHÔNG tự động phản ánh vào bản đã cài. Thay vì push mỗi lần test, dùng cơ
chế "skills-directory plugin" của Claude Code: một plugin nằm trong
`~/.claude/skills/<tên>/` được nạp **trực tiếp tại chỗ, không copy**.

Đã setup sẵn trên máy dev:

```bash
ln -sfn ~/Desktop/tiktok-news-video ~/.claude/skills/tiktok-news-video
```

Claude Code coi đây là plugin `tiktok-news-video@skills-dir`, đọc thẳng từ
`~/Desktop/tiktok-news-video` — sửa `SKILL.md` có hiệu lực ngay trong phiên
đang chạy; sửa các phần khác (scripts/, knowledge/, commands/) cần chạy lại
`/reload-plugins`.

**Quan trọng**: plugin cài qua marketplace và bản skills-dir này **cùng tên**
("tiktok-news-video") nên đụng nhau — cái nào cài sau/còn active sẽ chặn cái
kia (kể cả khi bản kia chỉ *disable*, không *uninstall*, vẫn giữ chỗ tên).
Trên máy dev, bản cài qua marketplace đã được `uninstall` để bản skills-dir
load được. Nếu cần test lại đúng như nhân viên sẽ trải nghiệm (từ GitHub,
qua marketplace thật), gỡ bản skills-dir tạm thời:

```bash
rm ~/.claude/skills/tiktok-news-video   # gỡ symlink (không xoá code)
claude plugin marketplace add DangTrungdev113999/tiktok-news-video
claude plugin install tiktok-news-video@tiktok-news-video-marketplace
# ... test xong ...
claude plugin uninstall tiktok-news-video@tiktok-news-video-marketplace
ln -sfn ~/Desktop/tiktok-news-video ~/.claude/skills/tiktok-news-video
```

Output/workspace của bạn (ảnh, video, key ElevenLabs) không nằm trong
`~/Desktop/tiktok-news-video` — chúng nằm ở `~/.tiktok-news-video/` (config)
+ nơi bạn chọn lúc `/init` (mặc định `~/Desktop/tiktok-news-video-workspace/`)
— xem `scripts/workspace.mjs`. Việc này ĐÚNG NGAY CẢ khi test qua skills-dir,
vì nó dùng chung cơ chế với bản cài thật.

## 2. Quy trình release (mỗi khi sửa xong, muốn nhân viên nhận được)

```bash
git add -A && git commit -m "..." && git push
```

Xong — không cần bump version thủ công cho Claude Code (xem mục 3), nhưng
**Codex bắt buộc version trong `.codex-plugin/plugin.json`** (schema của
Codex yêu cầu field này, không rơi về commit SHA như Claude Code) — nhớ bump
số đó mỗi lần muốn nhân viên dùng Codex/ChatGPT app nhận được bản mới:

```json
// .codex-plugin/plugin.json
"version": "0.1.1"   // bump mỗi lần push muốn nhân viên Codex/ChatGPT thấy update
```

## 3. Nhân viên nhận update thế nào — ĐÃ TEST THẬT, có phát hiện quan trọng

### Claude Code

`.claude-plugin/plugin.json` **cố tình không có field `version`** — nghĩa là
Claude Code lẽ ra dùng git commit SHA làm version, mọi commit mới = version
mới (đây là cách được tài liệu chính thống khuyến nghị cho plugin nội bộ
đang phát triển tích cực).

**NHƯNG đã test thật và phát hiện**: `claude plugin marketplace update` +
`claude plugin update <plugin>@<marketplace>` **KHÔNG đáng tin cậy** — test 2
lần, push commit mới thật, marketplace clone đã pull đúng commit mới (verify
bằng `git log` trong `~/.claude/plugins/marketplaces/...`), nhưng
`claude plugin update` vẫn báo "already at the latest version (0.1.0)" và
`gitCommitSha` trong `installed_plugins.json` không đổi.

**Cách THẬT SỰ hoạt động** (đã verify: gitCommitSha đổi đúng sang commit mới
nhất): gỡ cài rồi cài lại, KHÔNG dùng "update":

```
/plugin uninstall tiktok-news-video@tiktok-news-video-marketplace
/plugin install tiktok-news-video@tiktok-news-video-marketplace
```

An toàn để làm việc này bất cứ lúc nào — config/key/assets/output của nhân
viên nằm ngoài thư mục plugin (mục 1 ở trên), gỡ-cài-lại không đụng tới.
Đã cập nhật `SETUP.md` để hướng dẫn nhân viên đúng lệnh này thay vì
"/plugin update".

### Codex CLI / ChatGPT app

Ngược lại, cách "chuẩn" lại hoạt động đúng khi test:

```
codex plugin marketplace upgrade tiktok-news-video-marketplace
codex plugin add tiktok-news-video@tiktok-news-video-marketplace
```

Đã verify: sau khi push 1 commit test, chạy 2 lệnh trên thì file mới
(`scripts/workspace.mjs`) xuất hiện đúng trong cache của Codex — không cần
gỡ cài trước. (ChatGPT app dùng chung engine Codex nên chắc cũng vậy, nhưng
tôi chưa lái được UI ChatGPT app trực tiếp để xác nhận từng bước bấm — chỉ
verify được cơ chế qua Codex CLI.)

## 4. Việc CHƯA verify (cần bạn tự thử)

- Chạy `$tiktok-news-video-init` / `@tiktok-news-video-init` thật trong
  ChatGPT desktop app (tôi chỉ verify được ở tầng CLI/cache, không lái được
  UI ChatGPT app).
- Update thật trong ChatGPT app's UI (Plugins tab) — có nút "Update"/"Refresh"
  riêng hay phải remove-add lại giống Codex CLI, chưa xác nhận qua UI thật.
