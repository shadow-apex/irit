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
import { grabJpeg, createFrameLoop } from "./vision-capture.mjs";

const MAX_IPC_FRAME_CHARS = 5_600_000; // ≈ 4 MB nhị phân sau base64

const hasSession = () => !!liveSession;
const base64Of = (dataUrlOrB64) => {
  if (typeof dataUrlOrB64 !== "string" || dataUrlOrB64.length === 0 || dataUrlOrB64.length > MAX_IPC_FRAME_CHARS) return "";
  const i = dataUrlOrB64.indexOf(",");
  return dataUrlOrB64.startsWith("data:") && i >= 0 ? dataUrlOrB64.slice(i + 1) : dataUrlOrB64;
};

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
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: geometry.frame_w, height: geometry.frame_h },
  });
  // Đa màn hình: chọn đúng màn hình chính theo display_id (sources[0] không đảm bảo).
  const src = sources.find((s) => s.display_id === String(primary.id)) ?? sources[0];
  if (!src) throw new Error("Không có nguồn màn hình (macOS: cấp quyền Screen Recording).");
  const buffer = src.thumbnail.toJPEG(quality);
  sources.length = 0; // giải phóng NativeImage — vòng lặp chạy liên tục
  return { buffer, geometry };
}

export async function captureScreenForVision() {
  return (await grabPrimaryScreenJpeg(50)).buffer;
}

export function stopVisionLoop() {
  const wasOn = isVisionEnabled || !!visionInterval;
  visionInterval?.stop();
  visionInterval = null;
  isVisionEnabled = false;
  if (wasOn) emitEvent({ type: "vision_state", enabled: false });
}

export function toggleScreenVision() {
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
  return {
    status: "enabled",
    message: "Live screen vision enabled. I can now see your screen.",
    frame_geometry: visionFrameGeometry(),
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

export function toggleRobotVision(args = {}) {
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
      return grabJpeg(url);
    },
    isActive: () => isRobotVisionEnabled && activeRobotId === robotId,
    hasSession,
    send: sendVideoFrame,
    emit: emitEvent,
    onStop: stopRobotVisionLoop,
  });
  emitEvent({ type: "robot_vision_state", enabled: true, robot_id: robotId });
  return { status: "enabled", message: `Robot live vision enabled for ${robotId}. I am now streaming camera frames.` };
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

export function toggleSmartHomeVision(args = {}) {
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
      return grabJpeg(url);
    },
    isActive: () => isSmartHomeVisionEnabled && activeSmartHomeCameraId === cameraId,
    hasSession,
    send: sendVideoFrame,
    emit: emitEvent,
    onStop: stopSmartHomeVisionLoop,
  });
  emitEvent({ type: "smarthome_vision_state", enabled: true, camera_id: cameraId });
  return { status: "enabled", message: `Smart Home camera vision enabled for ${cameraId}. I am now streaming camera frames.` };
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

export function toggleCameraStreamVision() {
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
  return {
    status: "enabled",
    message: "Direct Stream Vision enabled — I'm now watching the camera feed (companion phone) directly instead of the desktop screen.",
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
  if (!base64) return false;
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
    resolve(
      ok
        ? { status: "success", message: "Đã chụp và gửi ảnh từ camera bàn; hãy mô tả những gì bạn thấy." }
        : { status: "error", error: "Chụp được ảnh nhưng không gửi được lên Gemini (chưa có phiên)." },
    );
  }
  return ok;
}

/** Tool take_desk_snapshot: chỉ báo success khi frame THỰC SỰ đã tới (V-12). */
export function requestDeskSnapshot({ timeoutMs = 8000 } = {}) {
  if (!mainWindow) return Promise.resolve({ status: "error", error: "Không có cửa sổ Iris." });
  if (!hasSession()) return Promise.resolve({ status: "error", error: "Chưa có phiên Gemini Live đang chạy." });
  if (pendingDeskSnap) return Promise.resolve({ status: "error", error: "Đang có một yêu cầu chụp khác." });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingDeskSnap = null;
      resolve({ status: "error", error: "Hết thời gian chờ camera bàn (không có ảnh nào được chụp)." });
    }, timeoutMs);
    pendingDeskSnap = { resolve, timer };
    mainWindow.webContents.send("vision:snap-desk");
  });
}
