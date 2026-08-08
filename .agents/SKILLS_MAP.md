# Sơ Đồ Kỹ Năng (Skills Map)

> **Cập nhật 2026-08-02:** Bản trước của file này liệt kê bộ skills công khai của
> Anthropic (pdf, docx, xlsx, mcp-builder, frontend-design, v.v.) với link tuyệt
> đối trỏ vào `c:\Users\vanha\Downloads\myiris\.agents\skills\skills\skills\...`
> trên máy cá nhân của người tạo repo. **Thư mục đó chưa từng được commit vào
> git repo này** — không tồn tại ở bất kỳ đâu trong `irit/`, kể cả sau khi clone
> mới. `.agents/skills.json` cũng trỏ tới cùng đường dẫn không tồn tại
> (`skills/skills/skills`). Cả hai đã được sửa lại bên dưới để phản ánh đúng các
> skill **thực sự có trong repo**.

## 📍 Vị trí thư mục thực tế

Repo có hai nơi chứa skill:

1. **`.agents/skills/`** — skill riêng cho project này (setup, kiến thức về
   kiến trúc Iris).
2. **`resources/skills/claude-skills/`** — bộ skill quy trình làm việc dùng
   trong quá trình phát triển repo (OpenSpec, wiki/second-brain, TDD, review).

`.agents/skills.json` đã được cập nhật để trỏ tới `resources/skills/claude-skills`
thay vì đường dẫn không tồn tại trước đó.

---

## 🛠️ `.agents/skills/` — skill riêng cho project

* **[myiris](skills/myiris/SKILL.md)**: Kiến thức toàn bộ kiến trúc Iris/myiris —
  cấu trúc `electron/main.mjs`, các module đã tách, IPC bridge, cách cài đặt/
  chạy/sửa/mở rộng repo này.
* **[setup-mkcert](skills/setup-mkcert/SKILL.md)**: Hướng dẫn cài `mkcert` để
  tạo chứng chỉ HTTPS cục bộ (cần cho companion app kết nối WebRTC từ điện thoại).

## 🛠️ `resources/skills/claude-skills/` — quy trình làm việc trên repo

### OpenSpec (quy trình spec-driven development dùng trong `openspec/`)
* **openspec-explore**: Bạn đồng hành tư duy để khám phá ý tưởng/vấn đề trước khi viết proposal.
* **openspec-propose**: Tạo một change proposal đầy đủ (design + specs + tasks) từ một yêu cầu ngắn gọn.
* **openspec-update-change**: Sửa lại các artifact của một change đã có cho nhất quán, không sửa code.
* **openspec-apply-change**: Thực thi các task trong một OpenSpec change.
* **openspec-sync-specs**: Đồng bộ delta specs của change vào main specs (không archive).
* **openspec-archive-change**: Archive một change đã hoàn thành.

### Second-brain / wiki (dùng cho vault ghi chú cá nhân của Iris)
* **wiki-config**: Cài đặt/kiểm tra/cấu hình lại bộ skill wiki.
* **wiki-ingest**: Xử lý file nguồn thành các trang wiki đã tổng hợp.
* **wiki-crystallize**: Chưng cất một đoạn hội thoại/phiên nghiên cứu thành một trang wiki có cấu trúc.
* **wiki-integrate**: Gắn một trang wiki vào đồ thị tri thức (index + backlink hai chiều).
* **wiki-query**: Trả lời câu hỏi dựa trên wiki đã biên soạn, có trích dẫn `[[wikilink]]`.
* **wiki-lint**: Kiểm tra sức khỏe wiki — link hỏng, trang mồ côi, index cũ.

### Chất lượng code
* **code-review**: Review thay đổi theo 2 trục — Standards (đúng chuẩn code repo) và Spec (đúng yêu cầu ban đầu), chạy song song bằng sub-agent.
* **diagnosing-bugs**: Quy trình chẩn đoán cho bug khó/regression hiệu năng.
* **tdd**: Phát triển test-first (red-green-refactor).
* **grilling**: "Chất vấn" một kế hoạch/quyết định/ý tưởng để stress-test tư duy.

---

## Ghi chú

Nếu bạn muốn dùng bộ skill công khai của Anthropic (pdf, docx, xlsx, pptx,
mcp-builder, frontend-design, brand-guidelines, v.v. như bản cũ của file này
liệt kê), clone trực tiếp từ nguồn chính thức:
`https://github.com/anthropics/skills` — rồi đặt vào một thư mục con thật sự
tồn tại trong repo (ví dụ `.agents/skills/anthropic/`) và cập nhật
`.agents/skills.json` để trỏ đúng chỗ. Đường dẫn phải **tương đối trong repo**,
không phải đường dẫn tuyệt đối trên máy cá nhân, để không hỏng lại như lần trước.
