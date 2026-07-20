---
name: clean-source
user-invocable: true
description: "Chuẩn hoá tên file ảnh/video nguồn cho một video: đổi tên cả thư mục thành anh_1.jpg, anh_2.png, video_1.mp4... theo đúng thứ tự chữ cái (numeric-aware, img2 trước img10), giữ nguyên đuôi file, và tạo sẵn bản clone anh_N_des.<ext> cho MỖI ảnh để nhân viên vẽ số đánh dấu lên. Chạy sau khi đã gom ảnh nguồn vào assets/<tên-video>/, trước khi viết kịch bản. Rename in-place, không làm phẳng thư mục."
argument-hint: "<đường dẫn thư mục ảnh nguồn, ví dụ assets/ban-quyen>"
---

# clean-source — chuẩn hoá tên ảnh nguồn

Nhân viên đã tự chọn ảnh và tự quyết screen nào dùng ảnh nào, gom hết vào
**một thư mục riêng cho video đó**: `$WORKSPACE_DIR/assets/<tên-video>/`. Thứ
tự họ muốn nằm ở tên file — kỹ năng này chỉ đổi tên theo đúng thứ tự đó, không
tự sắp xếp lại và không tự chọn hộ.

Quy ước tên và luật tra cứu ngược lại nằm ở
`../tiktok-news-video/references/asset-naming.md`. **Đọc file đó trước** nếu
cần giải thích cho user tại sao một tên lại ra như vậy — đừng mô tả lại quy
ước từ trí nhớ.

## Việc phải làm

1. **Xác định thư mục.** `$ARGUMENTS` là đường dẫn. Nếu là đường dẫn tương
   đối thì hiểu là tương đối với `$WORKSPACE_DIR` (xem
   `../tiktok-news-video/references/paths-and-config.md` — nhầm CODE_ROOT với
   WORKSPACE_DIR là lỗi phá dữ liệu). Nếu user không đưa đường dẫn, liệt kê
   các thư mục con trong `assets/` và hỏi.

2. **Chạy thử trước.** Đổi tên file của người khác là việc khó hoàn tác:

   ```
   node scripts/clean-source.mjs <folder> --dry-run
   ```

   Đưa nguyên bảng `cũ -> mới` cho user xem và **hỏi xác nhận**. Đây là chỗ
   duy nhất kỹ năng này dừng lại — nếu thứ tự sai thì sai từ đây, sửa sau tốn
   hơn nhiều.

3. **Chạy thật** sau khi user đồng ý: bỏ `--dry-run`.

4. **Báo lại**: bảng `cũ -> mới`, danh sách file `_des` đã tạo, và những file
   bị bỏ qua vì không phải ảnh/video.

Script là nguồn sự thật — không tự `mv` bằng tay. Nó xử lý sẵn: đếm riêng ảnh
và video, sắp xếp numeric-aware, đổi tên qua tên tạm để không đè mất file, và
từ chối chạy nếu thư mục đã có file `_des` mà việc đánh số lại sẽ làm lệch cặp.

## Nói gì với user sau khi xong

Hai câu, đúng trọng tâm:

- **File `_des`** là bản copy y hệt của ảnh gốc, sinh sẵn cho mọi ảnh. Nhân
  viên mở nó ra, vẽ số `1`, `2`, `3` (hoặc `a`, `b`, `c`) lên đúng chỗ cần
  nói tới, rồi trong kịch bản viết
  `anh_2.jpg | zoom_in: 50%, target 1 trong anh_2_des.jpg`. Không cần đánh dấu
  thì cứ để nguyên, file `_des` không bao giờ được render.
- **Trong kịch bản không cần gõ đuôi file.** `anh_1`, `ảnh 1`, `Anh 1`,
  `anh-1` đều ra đúng `anh_1.jpg`. Không cần nhớ ảnh nào `.jpg` ảnh nào `.png`,
  và không cần nhắc lại tên thư mục.

Xong bước này thì viết kịch bản rồi gọi skill `tiktok-news-video`.
