// src/lib/keyCapture.ts
//
// V-11: tránh xung đột phím tắt cục bộ (W/S bật-tắt Iris vs WASD lái robot vs vẽ Excalidraw...).
//  - Thành phần chiếm bàn phím đặt `document.body.dataset.keyCapture = "<tên>"` khi đang hoạt động
//    và xoá khi dọn dẹp; phím tắt toàn cục phải bỏ qua khi giá trị này có mặt.
//  - Không xử lý phím khi người dùng đang gõ vào input/textarea/select/contenteditable.

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

export function keyCaptureOwner(): string | null {
  return document.body?.dataset?.keyCapture || null;
}

/** Đặt/xoá cờ chiếm bàn phím. Trả về hàm dọn dẹp chỉ xoá nếu CHÍNH nó đang là chủ. */
export function claimKeyCapture(owner: string): () => void {
  document.body.dataset.keyCapture = owner;
  return () => {
    if (document.body.dataset.keyCapture === owner) delete document.body.dataset.keyCapture;
  };
}
