#!/usr/bin/env node
// KILL-OLD-NGROK: dọn mọi tiến trình ngrok còn sót lại từ lần `npm run dev`
// trước (VD phiên trước bị Ctrl+C đột ngột, crash, hoặc đóng cửa sổ Electron
// mà không tắt app đúng cách) trước khi khởi động một phiên dev mới.
//
// Vì sao cần: package `ngrok` (dùng trong electron/companion-server.mjs) tự
// spawn ra một binary riêng (`ngrok.exe` trên Windows, `ngrok` trên
// mac/Linux — xem node_modules/ngrok/src/constants.js) để chạy tunnel.
// Binary này SỐNG NGOÀI vòng đời của tiến trình Node/Electron: nếu Electron
// bị kill cứng (Task Manager, crash, mất điện, v.v.) mà không thoát sạch,
// binary ngrok cũ vẫn tiếp tục chiếm cổng API nội bộ 4040 và session/tunnel
// cũ. Lần `npm run dev` kế tiếp cố spawn một ngrok MỚI trong khi cái cũ vẫn
// đang giữ cổng/tunnel đó → xung đột, và trên Windows từng gây crash native
// (xem comment HTTPS_CAM/BUG-COMP-08 trong companion-server.mjs).
//
// Script cũ trong package.json chỉ có `taskkill /F /IM ngrok.exe` — CHỈ
// chạy trên Windows. Trên mac/Linux, lệnh này lỗi ngay lập tức (không tồn
// tại `taskkill`) và bị `|| exit 0` nuốt mất, tức là KHÔNG dọn gì cả.
// Script này thay thế nó bằng cách xử lý đúng theo từng OS, và luôn thoát
// với mã 0 (best-effort, không bao giờ làm predev thất bại) dù không tìm
// thấy tiến trình nào để diệt.

import { spawnSync } from "child_process";

function run(cmd, args) {
  try {
    const result = spawnSync(cmd, args, { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function killOldNgrok() {
  const platform = process.platform;

  if (platform === "win32") {
    // /F = force, /IM = match theo tên image (không cần biết PID).
    // Không lỗi nếu không tìm thấy tiến trình nào (status khác 0 thì vẫn ok).
    run("taskkill", ["/F", "/IM", "ngrok.exe"]);
    return;
  }

  // macOS / Linux: `pkill -f` khớp theo đường dẫn/đối số đầy đủ của lệnh,
  // vì binary ngrok được gọi từ node_modules/ngrok/bin/ngrok — tên tiến
  // trình "ngrok" đơn thuần có thể không đủ để khớp trên vài hệ thống.
  const killedByPath = run("pkill", ["-f", "node_modules/ngrok/bin/ngrok"]);
  // Fallback: khớp tiến trình tên chính xác "ngrok" (trường hợp cài global
  // hoặc chạy từ đường dẫn khác).
  if (!killedByPath) {
    run("pkill", ["-x", "ngrok"]);
  }
}

killOldNgrok();
// Luôn thoát thành công — đây là bước dọn dẹp best-effort, không phải điều
// kiện bắt buộc để `npm run dev` được phép chạy tiếp.
process.exit(0);
