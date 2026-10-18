/**
 * electron/main/vision.mjs
 *
 * Các nguồn vision (màn hình, camera robot, camera smart-home, luồng camera điện thoại
 * do renderer vẽ, webcam bàn "desk") gửi khung hình lên phiên Gemini Live để Iris "nhìn".
 *
 * Quy tắc:
 *  - CHỈ MỘT nguồn chạy tại một thời điểm (activateExclusive).
 *  - Mọi khung hình đi qua sendVideoFrame() — trả `false` nếu KHÔNG gửi được, và tool
 *    phải báo lỗi thật thay vì "success" (V-01).
 *  - Vòng lặp dùng chung createFrameLoop(): không tự chết khi Gemini reconnect (V-03),
 *    không chồng request, tự dừng CÓ báo sau 5 lỗi liên tiếp (V-02).
 */
import crypto from "node:crypto";
import electron from "electron";
const { screen } = electron;
import { emitEvent } from "./events.mjs";
import { mainWindow } from "./window-manager.mjs";
import { liveSession, sendVideoFrame } from "./gemini-live.mjs";
import { getRobotsConfig, getSmartHomeCamerasConfig } from "./device-config.mjs";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolvePythonCommand } from "./sidecar-process.mjs";
import { unpackedRepoRoot, userDataDir } from "./paths.mjs";
import { saveScreenshot } from "./screenshot-store.mjs";
import { grabJpeg, createFrameLoop } from "./vision-capture.mjs";

const MAX_IPC_FRAME_CHARS = 5_600_000; // ≈ 4 MB nhị phân sau base64

const hasSession = () => !!liveSession;
const base64Of = (dataUrlOrB64) => {
  if (typeof dataUrlOrB64 !== "string" || dataUrlOrB64.length === 0 || dataUrlOrB64.length > MAX_IPC_FRAME_CHARS) return "";
  const i = dataUrlOrB64.indexOf(",");
  return dataUrlOrB64.startsWith("data:") && i >= 0 ? dataUrlOrB64.slice(i + 1) : dataUrlOrB64;
};

/**
 * Nếu người dùng cấu hình "Khoá Vision API (Tuỳ chọn)" (GEMINI_VISION_API_KEY) trong Settings,
 * gọi nhanh model gemini-flash-latest bằng khoá riêng đó (tối đa 3s) để trích xuất mô tả chính xác
 * khung hình mà không tốn quota của GEMINI_API_KEY. Nếu bỏ trống, dùng trực tiếp luồng Live (0.35s).
 */
export async function analyzeImageWithVisionApi(base64Jpeg, sourceLabel = "màn hình/camera") {
  const visionKey = String(process.env.GEMINI_VISION_API_KEY || "").trim();
  if (!visionKey || !base64Jpeg) return null;
  let timer = null;
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const visionAi = new GoogleGenAI({ apiKey: visionKey });
    const model = String(process.env.GEMINI_VISION_MODEL || "gemini-flash-latest").trim();
    const res = await Promise.race([
      visionAi.models.generateContent({
        model,
        contents: [
          { inlineData: { data: base64Jpeg, mimeType: "image/jpeg" } },
          `Mô tả ngắn gọn, chính xác trong 1-2 câu bằng tiếng Việt những gì đang hiển thị trong ảnh chụp từ ${sourceLabel} này (tên ứng dụng/cửa sổ chính hoặc vật thể chính). Không nói lan man.`,
        ],
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("vision timeout")), 3000);
      }),
    ]);
    return (res?.text || "").trim() || null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Giới hạn kích thước khung hình trước khi đẩy lên Gemini Live (WebSocket).
 * Ảnh từ ESP32-CAM/IP camera có thể tới vài MB; ảnh quá nặng làm nghẽn kênh realtime (kéo theo
 * trễ/ngắt tiếng). Ảnh ≤ maxBytes giữ nguyên; lớn hơn thì thu nhỏ cạnh dài ≤ maxSide và nén lại.
 * Mọi lỗi giải mã đều trả về buffer gốc — không bao giờ làm mất khung hình.
 */
export function shrinkJpegForLive(buffer, { maxBytes = 400_000, maxSide = 1280, quality = 72 } = {}) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length <= maxBytes) return buffer;
    const img = electron.nativeImage.createFromBuffer(buffer);
    if (img.isEmpty()) return buffer;
    const { width, height } = img.getSize();
    const s = Math.min(1, maxSide / Math.max(width, height));
    const resized = s < 1 ? img.resize({ width: Math.round(width * s), height: Math.round(height * s), quality: "good" }) : img;
    const out = resized.toJPEG(quality);
    return out && out.length > 0 && out.length < buffer.length ? out : buffer;
  } catch {
    return buffer;
  }
}

// ---------------------------------------------------------------------------
// Loại trừ nguồn — một chỗ duy nhất (V-05)
// ---------------------------------------------------------------------------
const STOPPERS = {
  screen: () => stopVisionLoop(),
  robot: () => stopRobotVisionLoop(),
  smarthome: () => stopSmartHomeVisionLoop(),
  camerastream: () => stopCameraStreamVisionLoop(),
  desk: () => stopDeskVisionLoop(),
};
function activateExclusive(name) {
  for (const [k, stop] of Object.entries(STOPPERS)) if (k !== name) stop();
}

/** Dừng mọi nguồn vision (dùng khi tắt phiên Gemini). */
export function stopAllVisionLoops() {
  for (const stop of Object.values(STOPPERS)) stop();
}

// ---------------------------------------------------------------------------
// 1) Screen vision
// ---------------------------------------------------------------------------
export let isVisionEnabled = false;
export let visionInterval = null; // { id, stop }

// Chụp nhỏ + chất lượng thấp cho vòng lặp (~30-80 KB/frame). Full-res dành cho Computer Use.
/**
 * Hình học của khung vision so với màn hình chính (pixel VẬT LÝ). Gemini chỉ "thấy" khung đã thu nhỏ
 * (≤ 1280×720), còn mouse_control dùng pixel vật lý ⇒ cần tỉ lệ này để đổi toạ độ (TL-05).
 * @returns {{frame_w:number,frame_h:number,screen_w:number,screen_h:number,origin_x:number,origin_y:number,scale:number}}
 */
export function visionFrameGeometry() {
  const primary = screen.getPrimaryDisplay();
  const sf = primary.scaleFactor || 1;
  const pxW = Math.max(1, Math.round(primary.size.width * sf));
  const pxH = Math.max(1, Math.round(primary.size.height * sf));
  const scale = Math.min(1280 / pxW, 720 / pxH, 1);
  return {
    frame_w: Math.max(1, Math.round(pxW * scale)),
    frame_h: Math.max(1, Math.round(pxH * scale)),
    screen_w: pxW,
    screen_h: pxH,
    origin_x: Math.round(primary.bounds.x * sf),
    origin_y: Math.round(primary.bounds.y * sf),
    scale,
  };
}

function captureScreenFallback(geometry, quality = 50, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const pythonCmd = resolvePythonCommand();
    const scriptPath = path.join(unpackedRepoRoot(), "sidecar", "screen_capture.py");
    let proc;
    let timer;
    let settled = false;

    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(val);
    };

    try {
      proc = spawn(pythonCmd, [scriptPath, String(geometry.frame_w), String(geometry.frame_h), String(quality)], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      return reject(e);
    }

    timer = setTimeout(() => {
      try { proc.kill(); } catch { /* ignore */ }
      finish(reject, new Error(`Quá thời gian chờ chụp màn hình dự phòng (${timeoutMs}ms)`));
    }, timeoutMs);

    const chunks = [];
    let errOutput = "";
    proc.stdout.on("data", (chunk) => chunks.push(chunk));
    proc.stderr.on("data", (err) => { errOutput += err.toString(); });
    proc.on("error", (err) => finish(reject, err));
    proc.on("close", (code) => {
      if (code === 0 && chunks.length > 0) {
        finish(resolve, Buffer.concat(chunks));
      } else {
        finish(reject, new Error(errOutput.trim() || `Exit code ${code}`));
      }
    });
  });
}

/** Chụp màn hình chính → { buffer: JPEG, geometry }. Dùng chung cho vòng lặp vision và take_ai_screenshot. */
export async function grabPrimaryScreenJpeg(quality = 50) {
  const { desktopCapturer, systemPreferences } = electron;
  if (process.platform === "darwin" && systemPreferences?.getMediaAccessStatus) {
    const st = systemPreferences.getMediaAccessStatus("screen");
    if (st !== "granted") {
      throw new Error("macOS chưa cấp quyền Screen Recording cho Iris (System Settings → Privacy & Security).");
    }
  }
  const primary = screen.getPrimaryDisplay();
  const geometry = visionFrameGeometry();
  let buffer = null;

  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: geometry.frame_w, height: geometry.frame_h },
    });
    // Đa màn hình: chọn đúng màn hình chính theo display_id (sources[0] không đảm bảo).
    const src = sources.find((s) => s.display_id === String(primary.id)) ?? sources[0];
    if (src && !src.thumbnail.isEmpty()) {
      const b = src.thumbnail.toJPEG(quality);
      if (b && b.length > 0) buffer = b;
    }
    sources.length = 0; // giải phóng NativeImage — vòng lặp chạy liên tục
  } catch (err) {
    // desktopCapturer failed (e.g. WebRTC thread attach error on Windows)
  }

  // Dự phòng: trên Windows nếu desktopCapturer trả về rỗng (lỗi WebRTC desktop thread)
  // thì chụp trực tiếp qua sidecar/screen_capture.py (Pillow ImageGrab + OpenInputDesktop).
  if (!buffer || buffer.length === 0) {
    try {
      buffer = await captureScreenFallback(geometry, quality);
    } catch (fallbackErr) {
      // Báo lỗi nếu cả 2 phương án đều không thành công
    }
  }

  if (!buffer || buffer.length === 0) {
    throw new Error("Không có nguồn màn hình hoặc không thể chụp ảnh màn hình.");
  }

  return { buffer, geometry };
}

export async function captureScreenForVision() {
  return (await grabPrimaryScreenJpeg(75)).buffer;
}

export function stopVisionLoop() {
  const wasOn = isVisionEnabled || !!visionInterval;
  visionInterval?.stop();
  visionInterval = null;
  isVisionEnabled = false;
  if (wasOn) emitEvent({ type: "vision_state", enabled: false });
}

export async function toggleScreenVision() {
  if (isVisionEnabled) {
    stopVisionLoop();
    return { status: "disabled", message: "Live screen vision disabled." };
  }
  if (!hasSession()) {
    return { status: "error", error: "Chưa có phiên Gemini Live đang chạy — hãy đánh thức Iris trước khi bật screen vision." };
  }
  activateExclusive("screen");
  isVisionEnabled = true;
  visionInterval = createFrameLoop({
    label: "ScreenVision",
    capture: captureScreenForVision,
    isActive: () => isVisionEnabled,
    hasSession,
    send: sendVideoFrame,
    emit: emitEvent,
    onStop: stopVisionLoop,
  });
  emitEvent({ type: "vision_state", enabled: true });

  // Chụp và gửi NGAY LẬP TỨC khung hình đầu tiên trước khi trả toolResponse cho Gemini
  // (nếu không gọi tick() ngay, setInterval sẽ đợi 4 giây mới chụp ảnh đầu tiên khiến Gemini trả lời mù/bịa).
  try {
    await visionInterval.tick();
    await new Promise((r) => setTimeout(r, 350));
  } catch {
    // Nếu lần chụp đầu lỗi, vòng lặp vẫn tiếp tục thử lại
  }

  return {
    status: "enabled",
    message: "Live screen vision enabled. First screen frame has been captured and sent.",
    frame_geometry: visionFrameGeometry(),
    instructions:
      "Khung hình màn hình đầu tiên vừa được chụp và gửi trực tiếp cho bạn. " +
      "Nếu người dùng chỉ yêu cầu bật vision, hãy xác nhận ngắn gọn 1 câu. " +
      "Nếu người dùng hỏi trên màn hình đang có gì, hãy nhìn trực tiếp vào ảnh chụp màn hình vừa nhận và mô tả NGẮN GỌN, ĐÚNG TRỌNG TÂM trong 1-2 câu về cửa sổ/ứng dụng đang mở (TUYỆT ĐỐI không nói rông dài, không liệt kê từng icon nhỏ trên Desktop, không đoán mò từ lịch sử hội thoại cũ).",
    coordinate_hint:
      "Ảnh bạn thấy đã được thu nhỏ. Khi gọi mouse_control với toạ độ đọc TỪ ẢNH, đặt space:\"frame\" để Iris đổi sang pixel thật; toạ độ chuột thật (từ multi_monitor_info/OCR) dùng space:\"screen\".",
  };
}

// ---------------------------------------------------------------------------
// 2) Robot camera / 3) Smart-home camera — cùng một cơ chế
// ---------------------------------------------------------------------------
// Ưu tiên snapshot_url (ảnh đơn, vd http://<ip>/capture) — nhẹ cho ESP32-CAM; nếu
// chỉ có camera_url (luồng MJPEG) thì grabJpeg() cắt đúng 1 frame rồi đóng kết nối.
const pickUrl = (cfg) => cfg?.snapshot_url || cfg?.camera_url || "";

function warnPipConflict(label, cfg) {
  if (!cfg?.snapshot_url) {
    emitEvent({
      type: "log",
      level: "warn",
      message: `[${label}] vision và khung PiP có thể cùng mở luồng tới một ESP32-CAM (chịu rất ít kết nối). Nên đặt "snapshot_url" (vd http://<ip>/capture) trong cấu hình camera.`,
    });
  }
}

export let isRobotVisionEnabled = false;
export let robotVisionInterval = null;
export let activeRobotId = null;

export function stopRobotVisionLoop() {
  const wasOn = isRobotVisionEnabled || !!robotVisionInterval;
  robotVisionInterval?.stop();
  robotVisionInterval = null;
  isRobotVisionEnabled = false;
  activeRobotId = null;
  if (wasOn) {
    emitEvent({ type: "robot_vision_state", enabled: false });
    emitEvent({ type: "log", level: "info", message: "Robot vision loop stopped." });
  }
}

export async function toggleRobotVision(args = {}) {
  const robotId = args.robot_id;
  // Đang bật: cùng id (hoặc không truyền id) => tắt; id khác => CHUYỂN camera (V-05).
  if (isRobotVisionEnabled && (!robotId || robotId === activeRobotId)) {
    stopRobotVisionLoop();
    return { status: "disabled", message: "Robot live vision disabled." };
  }
  const robots = getRobotsConfig();
  if (!robotId || !robots[robotId]) {
    return { status: "error", error: "Cannot enable Robot Vision: Invalid or missing robot_id." };
  }
  if (!pickUrl(robots[robotId])) {
    return { status: "error", error: `Cannot enable Robot Vision: camera_url is not set for robot ${robotId}.` };
  }
  if (!hasSession()) {
    return { status: "error", error: "Chưa có phiên Gemini Live đang chạy — hãy đánh thức Iris trước." };
  }
  stopRobotVisionLoop(); // chuyển camera: dừng vòng cũ
  activateExclusive("robot");
  isRobotVisionEnabled = true;
  activeRobotId = robotId;
  warnPipConflict("RobotVision", robots[robotId]);
  robotVisionInterval = createFrameLoop({
    label: "RobotVision",
    capture: () => {
      const url = pickUrl(getRobotsConfig()[robotId]);
      if (!url) throw new Error(`camera_url của robot ${robotId} đã bị xoá khỏi cấu hình`);
      return grabJpeg(url).then((b) => shrinkJpegForLive(b));
    },
    isActive: () => isRobotVisionEnabled && activeRobotId === robotId,
    hasSession,
    send: sendVideoFrame,
    emit: emitEvent,
    onStop: stopRobotVisionLoop,
  });
  emitEvent({ type: "robot_vision_state", enabled: true, robot_id: robotId });

  try {
    await robotVisionInterval.tick();
    await new Promise((r) => setTimeout(r, 350));
  } catch {
    // Vòng lặp vẫn tiếp tục thử lại nếu khung đầu lỗi
  }

  return {
    status: "enabled",
    message: `Robot live vision enabled for ${robotId}. First camera frame has been captured and sent.`,
    instructions:
      "Khung hình đầu tiên từ camera robot vừa được gửi cho bạn. Hãy trả lời NGẮN GỌN trong 1-2 câu dựa đúng trên hình ảnh thực tế vừa nhận (không nói rông dài hay đoán mò).",
  };
}

export let isSmartHomeVisionEnabled = false;
export let smartHomeVisionInterval = null;
export let activeSmartHomeCameraId = null;

export function stopSmartHomeVisionLoop() {
  const wasOn = isSmartHomeVisionEnabled || !!smartHomeVisionInterval;
  smartHomeVisionInterval?.stop();
  smartHomeVisionInterval = null;
  isSmartHomeVisionEnabled = false;
  activeSmartHomeCameraId = null;
  if (wasOn) {
    emitEvent({ type: "smarthome_vision_state", enabled: false });
    emitEvent({ type: "log", level: "info", message: "Smart Home camera vision loop stopped." });
  }
}

export async function toggleSmartHomeVision(args = {}) {
  const cameraId = args.camera_id;
  if (isSmartHomeVisionEnabled && (!cameraId || cameraId === activeSmartHomeCameraId)) {
    stopSmartHomeVisionLoop();
    return { status: "disabled", message: "Smart Home camera vision disabled." };
  }
  const cameras = getSmartHomeCamerasConfig();
  if (!cameraId || !cameras[cameraId]) {
    return { status: "error", error: "Cannot enable Smart Home Vision: Invalid or missing camera_id." };
  }
  if (!pickUrl(cameras[cameraId])) {
    return { status: "error", error: `Cannot enable Smart Home Vision: camera_url is not set for camera ${cameraId}.` };
  }
  if (!hasSession()) {
    return { status: "error", error: "Chưa có phiên Gemini Live đang chạy — hãy đánh thức Iris trước." };
  }
  stopSmartHomeVisionLoop();
  activateExclusive("smarthome");
  isSmartHomeVisionEnabled = true;
  activeSmartHomeCameraId = cameraId;
  warnPipConflict("SmartHomeVision", cameras[cameraId]);
  smartHomeVisionInterval = createFrameLoop({
    label: "SmartHomeVision",
    capture: () => {
      const url = pickUrl(getSmartHomeCamerasConfig()[cameraId]);
      if (!url) throw new Error(`camera_url của camera ${cameraId} đã bị xoá khỏi cấu hình`);
      return grabJpeg(url).then((b) => shrinkJpegForLive(b));
    },
    isActive: () => isSmartHomeVisionEnabled && activeSmartHomeCameraId === cameraId,
    hasSession,
    send: sendVideoFrame,
    emit: emitEvent,
    onStop: stopSmartHomeVisionLoop,
  });
  emitEvent({ type: "smarthome_vision_state", enabled: true, camera_id: cameraId });

  try {
    await smartHomeVisionInterval.tick();
    await new Promise((r) => setTimeout(r, 350));
  } catch {
    // Vòng lặp vẫn tiếp tục thử lại nếu khung đầu lỗi
  }

  return {
    status: "enabled",
    message: `Smart Home camera vision enabled for ${cameraId}. First camera frame has been captured and sent.`,
    instructions:
      "Khung hình đầu tiên từ camera nhà thông minh vừa được gửi cho bạn. Hãy trả lời NGẮN GỌN trong 1-2 câu dựa đúng trên hình ảnh thực tế vừa nhận (không nói rông dài hay đoán mò).",
  };
}

// ---------------------------------------------------------------------------
// 4) Direct Stream Vision — renderer vẽ frame từ MediaStream (camera điện thoại...)
// ---------------------------------------------------------------------------
export let isCameraStreamVisionEnabled = false;
export let lastCameraStreamFrameHash = null;
let cameraStreamAvailable = false;

/** IPC `vision:camera-stream-status` (renderer → main): có stream thật hay không (V-13). */
export function setCameraStreamStatus(hasStream) {
  cameraStreamAvailable = hasStream === true;
  if (!cameraStreamAvailable && isCameraStreamVisionEnabled) {
    stopCameraStreamVisionLoop();
    emitEvent({ type: "log", level: "warn", message: "Camera điện thoại đã ngắt — Direct Stream Vision tự tắt." });
  }
}

export function stopCameraStreamVisionLoop() {
  const wasOn = isCameraStreamVisionEnabled;
  isCameraStreamVisionEnabled = false;
  lastCameraStreamFrameHash = null;
  if (wasOn) {
    if (mainWindow) mainWindow.webContents.send("vision:toggle-camera-stream", false);
    emitEvent({ type: "camera_stream_vision_state", enabled: false });
  }
}

export async function toggleCameraStreamVision() {
  if (isCameraStreamVisionEnabled) {
    stopCameraStreamVisionLoop();
    return { status: "disabled", message: "Direct Stream Vision disabled." };
  }
  if (!cameraStreamAvailable) {
    return { status: "error", error: "Chưa có camera điện thoại kết nối" };
  }
  if (!hasSession()) {
    return { status: "error", error: "Chưa có phiên Gemini Live đang chạy — hãy đánh thức Iris trước." };
  }
  activateExclusive("camerastream");
  isCameraStreamVisionEnabled = true;
  lastCameraStreamFrameHash = null;
  if (mainWindow) mainWindow.webContents.send("vision:toggle-camera-stream", true);
  emitEvent({ type: "camera_stream_vision_state", enabled: true });

  // Chờ renderer chụp và gửi khung hình đầu tiên từ luồng camera điện thoại
  await new Promise((r) => setTimeout(r, 450));

  return {
    status: "enabled",
    message: "Direct Stream Vision enabled — I'm now watching the camera feed (companion phone) directly instead of the desktop screen.",
    instructions:
      "Khung hình đầu tiên từ camera điện thoại (Companion) vừa được gửi cho bạn. Hãy trả lời NGẮN GỌN trong 1-2 câu dựa đúng trên hình ảnh thực tế vừa nhận (không nói rông dài hay đoán mò).",
  };
}

// IPC "vision:camera-stream-frame": validate kiểu + kích thước, dedupe SHA-1.
export function handleCameraStreamFrame(base64DataUrl) {
  if (!liveSession || !isCameraStreamVisionEnabled) return false;
  const base64 = base64Of(base64DataUrl);
  if (!base64) return false;
  const hash = crypto.createHash("sha1").update(base64).digest("hex");
  if (hash === lastCameraStreamFrameHash) return false;
  const ok = sendVideoFrame(base64, "image/jpeg");
  if (ok) lastCameraStreamFrameHash = hash;
  return ok;
}

// ---------------------------------------------------------------------------
// 5) Desk vision — webcam máy do renderer chụp (liên tục hoặc 1 ảnh)
// ---------------------------------------------------------------------------
export let isDeskVisionEnabled = false;
let lastDeskFrameHash = null;
let pendingDeskSnap = null; // { resolve, timer }

/** IPC `vision:desk-state` (renderer → main): chế độ liên tục đang bật/tắt. */
export function setDeskVisionState(enabled) {
  const on = enabled === true;
  if (on && !isDeskVisionEnabled) activateExclusive("desk");
  isDeskVisionEnabled = on;
  if (!on) lastDeskFrameHash = null;
}

export function stopDeskVisionLoop() {
  if (isDeskVisionEnabled) {
    isDeskVisionEnabled = false;
    lastDeskFrameHash = null;
    if (mainWindow) mainWindow.webContents.send("vision:toggle-desk-continuous"); // renderer tự đảo trạng thái
  }
}

/** IPC `vision:desk-frame`. Trả true nếu đã gửi lên Gemini. */
export function handleDeskFrame(base64DataUrl) {
  const base64 = base64Of(base64DataUrl);
  if (!base64) {
    if (pendingDeskSnap) {
      clearTimeout(pendingDeskSnap.timer);
      const { resolve } = pendingDeskSnap;
      pendingDeskSnap = null;
      resolve({
        status: "error",
        error: "Không thể mở hoặc chụp ảnh từ camera bàn (hãy kiểm tra kết nối webcam hoặc quyền truy cập camera).",
      });
    }
    return false;
  }
  const snapPending = !!pendingDeskSnap;
  if (!snapPending && !isDeskVisionEnabled) return false; // không có ai yêu cầu
  const hash = crypto.createHash("sha1").update(base64).digest("hex");
  if (!snapPending && hash === lastDeskFrameHash) return false;
  const ok = sendVideoFrame(base64, "image/jpeg");
  if (ok) lastDeskFrameHash = hash;
  if (snapPending) {
    clearTimeout(pendingDeskSnap.timer);
    const { resolve } = pendingDeskSnap;
    pendingDeskSnap = null;
    if (ok) {
      Promise.all([
        analyzeImageWithVisionApi(base64, "camera bàn (webcam)"),
        new Promise((r) => setTimeout(r, 350)),
      ]).then(([vision_summary]) => {
        resolve({
          status: "success",
          ...(vision_summary ? { vision_summary } : {}),
          message: "Đã chụp và gửi ảnh từ camera bàn; hãy mô tả những gì bạn thấy.",
          instructions:
            "Ảnh từ camera bàn (webcam) vừa được gửi trực tiếp cho bạn" +
            (vision_summary ? ` (phân tích nhanh từ Vision API: "${vision_summary}")` : "") +
            ". Hãy nhìn vào ảnh vừa nhận và trả lời NGẮN GỌN, CHÍNH XÁC trong 1-2 câu đúng trọng tâm câu hỏi của người dùng (không nói rông dài hay đoán mò).",
        });
      });
    } else {
      resolve({ status: "error", error: "Chụp được ảnh nhưng không gửi được lên Gemini (chưa có phiên)." });
    }
  }
  return ok;
}

/** Tool take_desk_snapshot: chỉ báo success khi frame THỰC SỰ đã tới (V-12). */
export function requestDeskSnapshot({ timeoutMs = 8000 } = {}) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents?.isDestroyed?.()) {
    return Promise.resolve({ status: "error", error: "Không có cửa sổ Iris." });
  }
  if (!hasSession()) return Promise.resolve({ status: "error", error: "Chưa có phiên Gemini Live đang chạy." });
  if (pendingDeskSnap) return Promise.resolve({ status: "error", error: "Đang có một yêu cầu chụp khác." });
  return new Promise((resolve) => {
    let resolved = false;
    let timer = null;
    const safeResolve = (val) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      pendingDeskSnap = null;
      resolve(val);
    };
    timer = setTimeout(() => {
      safeResolve({ status: "error", error: "Hết thời gian chờ camera bàn (không có ảnh nào được chụp)." });
    }, timeoutMs);
    pendingDeskSnap = { resolve: safeResolve, timer };
    try {
      mainWindow.webContents.send("vision:snap-desk");
    } catch (sendErr) {
      safeResolve({ status: "error", error: `Không thể gửi yêu cầu chụp camera bàn: ${sendErr.message}` });
    }
  });
}

let pendingCompanionSnap = null;

/** IPC `vision:companion-frame` từ renderer khi chụp ảnh camera Alt+C / Companion */
export function handleCompanionVisionFrame(base64DataUrl) {
  if (!pendingCompanionSnap) return false;
  const { resolve, timer, save } = pendingCompanionSnap;
  clearTimeout(timer);
  pendingCompanionSnap = null;

  const base64 = base64Of(base64DataUrl);
  if (!base64) {
    resolve({
      status: "error",
      error: "Camera điện thoại (Alt+C) chưa được kết nối hoặc không có hình ảnh. Hãy quét mã QR tại bảng Companion Camera (Alt+C) để kết nối điện thoại.",
    });
    return false;
  }

  const buffer = Buffer.from(base64, "base64");
  let screenshot_path = null;
  if (save) {
    try {
      screenshot_path = saveScreenshot(path.join(userDataDir(), "screenshots"), buffer);
    } catch (saveErr) {
      console.warn("[handleCompanionVisionFrame] Lỗi khi lưu ảnh:", saveErr);
    }
  }

  const ok = sendVideoFrame(base64, "image/jpeg");

  emitEvent({
    type: "log",
    level: "info",
    message: `Đã chụp ảnh từ Companion Camera (Alt+C)${screenshot_path ? ` -> ${screenshot_path}` : ""}.`,
  });

  if (!ok && !screenshot_path) {
    resolve({
      status: "error",
      error: "Đã chụp ảnh từ camera điện thoại (Alt+C) nhưng không gửi được lên Gemini (chưa có phiên Live đang chạy).",
    });
    return false;
  }

  Promise.all([
    analyzeImageWithVisionApi(base64, "camera điện thoại (Companion Alt+C)"),
    new Promise((r) => setTimeout(r, 350)),
  ]).then(([vision_summary]) => {
    resolve({
      status: "success",
      camera_id: "companion_phone",
      camera_name: "Companion Camera (Alt+C)",
      type: "companion",
      ...(screenshot_path ? { screenshot_path } : {}),
      ...(vision_summary ? { vision_summary } : {}),
      message: `Đã chụp thành công ảnh từ camera điện thoại (Alt+C).${screenshot_path ? ` Ảnh đã lưu tại: ${screenshot_path}` : ""}`,
      instructions:
        "Ảnh từ camera điện thoại (Alt+C) vừa được chụp và gửi trực tiếp cho bạn" +
        (vision_summary ? ` (phân tích nhanh từ Vision API: "${vision_summary}")` : "") +
        ". Hãy thông báo ngắn gọn 1 câu cho người dùng và mô tả NGẮN GỌN trong 1-2 câu những gì thấy trong camera nếu được hỏi (không nói rông dài hay đoán mò).",
    });
  });
  return ok;
}

export function requestCompanionSnapshot({ timeoutMs = 8000, save = true } = {}) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents?.isDestroyed?.()) {
    return Promise.resolve({ status: "error", error: "Không có cửa sổ Iris." });
  }
  if (pendingCompanionSnap) return Promise.resolve({ status: "error", error: "Đang có một yêu cầu chụp khác." });
  return new Promise((resolve) => {
    let resolved = false;
    let timer = null;
    const safeResolve = (val) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      pendingCompanionSnap = null;
      resolve(val);
    };
    timer = setTimeout(() => {
      safeResolve({ status: "error", error: "Hết thời gian chờ camera điện thoại (Alt+C) — hãy kiểm tra lại kết nối điện thoại." });
    }, timeoutMs);
    pendingCompanionSnap = { resolve: safeResolve, timer, save };
    try {
      mainWindow.webContents.send("vision:snap-companion");
    } catch (sendErr) {
      safeResolve({ status: "error", error: `Không thể gửi yêu cầu chụp camera điện thoại: ${sendErr.message}` });
    }
  });
}

/**
 * Chụp một ảnh tĩnh từ một camera robot, camera điện thoại (Alt+C), màn hình máy tính (Screen), hoặc smart home camera cụ thể qua giọng nói/chat.
 * Hỗ trợ target bằng ID, tên, số thứ tự (ví dụ: 'robot 1', '1', 'Robot Tham Hiem', 'mock_bot_1'), 'alt c' / 'companion' / 'phone', hoặc 'screen' / 'desktop' / 'màn hình'.
 */
export async function takeCameraSnapshot(args = {}) {
  const target = typeof args?.target === "string" ? args.target.trim() : "";
  const save = args?.save !== false;

  const targetNorm = target.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
  const isAltC = /^(?:camera\s*|may\s*anh\s*)?(?:alt\s*c|alt_c|companion|companion_phone|phone|dien\s*thoai|dt)(?:\s*camera)?$/i.test(targetNorm);
  if (isAltC) {
    return requestCompanionSnapshot({ timeoutMs: 8000, save });
  }

  // Nhận diện chụp màn hình máy tính (Desktop Screen) qua take_camera_snapshot
  const isScreen = /^(?:camera\s*)?(?:screen|desktop|pc|computer|man\s*hinh|man\s*hinh\s*may\s*tinh)(?:\s*camera)?$/i.test(targetNorm);
  if (isScreen) {
    try {
      const { buffer, geometry } = await grabPrimaryScreenJpeg(75);
      let screenshot_path = null;
      if (save) {
        try {
          screenshot_path = saveScreenshot(path.join(userDataDir(), "screenshots"), buffer);
        } catch (saveErr) {
          console.warn("[takeCameraSnapshot] Lỗi khi lưu ảnh màn hình:", saveErr);
        }
      }
      const b64 = buffer.toString("base64");
      const ok = sendVideoFrame(b64, "image/jpeg");
      if (!ok && !screenshot_path) {
        return {
          status: "error",
          error: "Đã chụp màn hình nhưng không gửi được ảnh lên Gemini (chưa có phiên Live đang chạy).",
        };
      }
      const [vision_summary] = await Promise.all([
        analyzeImageWithVisionApi(b64, "màn hình máy tính"),
        new Promise((r) => setTimeout(r, 350)),
      ]);
      emitEvent({
        type: "log",
        level: "info",
        message: `Đã chụp ảnh màn hình máy tính${screenshot_path ? ` -> ${screenshot_path}` : ""}.`,
      });
      return {
        status: "success",
        camera_id: "desktop_screen",
        camera_name: "Desktop Screen (Màn hình máy tính)",
        type: "screen",
        frame_geometry: geometry,
        ...(screenshot_path ? { screenshot_path } : {}),
        ...(vision_summary ? { vision_summary } : {}),
        message: `Đã chụp thành công ảnh màn hình máy tính.${screenshot_path ? ` Ảnh đã lưu tại: ${screenshot_path}` : ""}`,
        instructions:
          "Ảnh chụp màn hình máy tính vừa được gửi cho bạn" +
          (vision_summary ? ` (phân tích nhanh từ Vision API: "${vision_summary}")` : "") +
          ". Hãy nhìn trực tiếp vào ảnh vừa nhận và trả lời NGẮN GỌN, CHÍNH XÁC trong 1-2 câu đúng trọng tâm câu hỏi của người dùng (TUYỆT ĐỐI không nói rông dài, không liệt kê từng icon nhỏ, không đoán mò từ lịch sử hội thoại cũ).",
      };
    } catch (err) {
      return {
        status: "error",
        error: `Không thể chụp ảnh màn hình máy tính: ${err.message}`,
      };
    }
  }

  let matched = null;
  const robots = getRobotsConfig() || {};
  const smarthome = getSmartHomeCamerasConfig() || {};

  if (!target) {
    if (activeRobotId && robots[activeRobotId] && pickUrl(robots[activeRobotId])) {
      matched = { type: "robot", id: activeRobotId, name: robots[activeRobotId]?.name || activeRobotId, url: pickUrl(robots[activeRobotId]) };
    } else {
      for (const [id, cfg] of Object.entries(robots)) {
        if (pickUrl(cfg)) {
          matched = { type: "robot", id, name: cfg?.name || id, url: pickUrl(cfg) };
          break;
        }
      }
      if (!matched) {
        for (const [id, cfg] of Object.entries(smarthome)) {
          if (pickUrl(cfg)) {
            matched = { type: "smarthome", id, name: cfg?.name || id, url: pickUrl(cfg) };
            break;
          }
        }
      }
    }
  } else {
    const { resolveRobotDevice, normalizeViText, tokenize } = await import("./robot-actions.mjs");
    const res = resolveRobotDevice(target);
    if (res.status === "ok") {
      const cfg = robots[res.id];
      matched = { type: "robot", id: res.id, name: cfg?.name || res.id, url: pickUrl(cfg) };
    } else if (res.status === "ambiguous") {
      const names = res.ids.map((id) => robots[id]?.name || id).join(", ");
      return {
        status: "error",
        error: `Tên camera "${target}" khớp với nhiều hơn 1 robot (${names}). Hãy nói tên cụ thể hơn.`,
      };
    } else {
      const needleNorm = normalizeViText(target);
      const needleTokens = tokenize(target);

      const numMatch = needleNorm.match(/^(?:camera|cam|cua so|thiet bi)?\s*(?:so\s*)?#?(\d+)$/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        const shIds = Object.keys(smarthome);
        if (idx >= 0 && idx < shIds.length) {
          const id = shIds[idx];
          matched = { type: "smarthome", id, name: smarthome[id]?.name || id, url: pickUrl(smarthome[id]) };
        }
      }

      if (!matched && smarthome[target]) {
        matched = { type: "smarthome", id: target, name: smarthome[target]?.name || target, url: pickUrl(smarthome[target]) };
      }
      if (!matched) {
        for (const [id, cfg] of Object.entries(smarthome)) {
          if (normalizeViText(id) === needleNorm || normalizeViText(cfg?.name || "") === needleNorm) {
            matched = { type: "smarthome", id, name: cfg?.name || id, url: pickUrl(cfg) };
            break;
          }
        }
      }
      if (!matched && needleTokens.length > 0) {
        for (const [id, cfg] of Object.entries(smarthome)) {
          const allTokens = [...tokenize(id), ...tokenize(cfg?.name || "")];
          if (needleTokens.every((t) => allTokens.includes(t))) {
            matched = { type: "smarthome", id, name: cfg?.name || id, url: pickUrl(cfg) };
            break;
          }
        }
      }
    }
  }

  if (!matched) {
    const available = [
      ...Object.entries(robots).filter(([, cfg]) => pickUrl(cfg)).map(([id, cfg]) => cfg?.name || id),
      ...Object.entries(smarthome).filter(([, cfg]) => pickUrl(cfg)).map(([id, cfg]) => cfg?.name || id),
    ];
    return {
      status: "error",
      error: `Không tìm thấy camera phù hợp cho "${target || "mặc định"}". Các camera hiện có URL: ${available.length ? available.join(", ") : "Chưa có camera nào có camera_url."}`,
    };
  }

  if (!matched.url) {
    return {
      status: "error",
      error: `Camera "${matched.name}" (${matched.id}) chưa được cấu hình camera_url hoặc snapshot_url.`,
    };
  }

  let buffer;
  try {
    buffer = shrinkJpegForLive(await grabJpeg(matched.url, { timeoutMs: 7000 }));
  } catch (err) {
    return {
      status: "error",
      error: `Không thể kết nối hoặc tải ảnh từ camera "${matched.name}" (${matched.url}): ${err.message}`,
    };
  }

  let screenshot_path = null;
  if (save) {
    try {
      screenshot_path = saveScreenshot(path.join(userDataDir(), "screenshots"), buffer);
    } catch (saveErr) {
      console.warn("[takeCameraSnapshot] Lỗi khi lưu ảnh:", saveErr);
    }
  }

  const b64 = buffer.toString("base64");
  const ok = sendVideoFrame(b64, "image/jpeg");
  if (!ok && !screenshot_path) {
    return {
      status: "error",
      error: `Đã chụp ảnh từ camera "${matched.name}" nhưng không gửi được lên Gemini (chưa có phiên Live đang chạy).`,
    };
  }
  const [vision_summary] = await Promise.all([
    analyzeImageWithVisionApi(b64, `camera ${matched.name}`),
    new Promise((r) => setTimeout(r, 350)),
  ]);

  emitEvent({
    type: "log",
    level: "info",
    message: `Đã chụp ảnh từ camera "${matched.name}"${screenshot_path ? ` -> ${screenshot_path}` : ""}.`,
  });

  return {
    status: "success",
    camera_id: matched.id,
    camera_name: matched.name,
    type: matched.type,
    ...(screenshot_path ? { screenshot_path } : {}),
    ...(vision_summary ? { vision_summary } : {}),
    message: `Đã chụp thành công ảnh từ camera "${matched.name}".${screenshot_path ? ` Ảnh đã lưu tại: ${screenshot_path}` : ""}`,
    instructions:
      "Ảnh từ camera vừa được chụp và gửi trực tiếp cho bạn" +
      (vision_summary ? ` (phân tích nhanh từ Vision API: "${vision_summary}")` : "") +
      "; hãy thông báo ngắn gọn 1 câu cho người dùng và mô tả NGẮN GỌN trong 1-2 câu những gì thấy trong camera nếu được hỏi (không nói rông dài hay đoán mò).",
  };
}

