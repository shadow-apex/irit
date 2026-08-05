/**
 * electron/main/vision.mjs
 *
 * The four vision loops (screen share, robot camera, smart-home camera,
 * generic camera stream) that periodically grab a frame and forward it to
 * the live Gemini session so Iris can "see".
 */
import crypto from "node:crypto";
import electron from "electron";
const { screen } = electron;
import { emitEvent } from "./events.mjs";
import { mainWindow } from "./window-manager.mjs";
import { liveSession } from "./gemini-live.mjs";
import { getRobotsConfig, getSmartHomeCamerasConfig } from "./device-config.mjs";

export let isVisionEnabled = false;
export let visionInterval = null;
// AUDIT-VIS-02: hash của frame gần nhất đã gửi cho Gemini, dùng để bỏ qua
// gửi frame TRÙNG LẶP khi màn hình đứng yên (đọc tài liệu, xem slide tĩnh,
// v.v — chiếm phần lớn thời gian thực tế của tính năng "screen vision").
// Không cần thư viện decode ảnh (sharp/jimp): nếu bitmap gốc không đổi thì
// buffer JPEG xuất ra cũng giống hệt nhau (encode là deterministic), nên so
// sánh hash của buffer JPEG là đủ, rẻ hơn nhiều so với so sánh từng pixel.
export let lastVisionFrameHash = null;

export let isRobotVisionEnabled = false;
export let robotVisionInterval = null;

// FEAT-VIS-DIRECT-01: "Direct Stream Vision" — thay vì chụp toàn màn hình
// (desktopCapturer, tốn CPU + hay lẫn cả UI của Iris vào ảnh gửi Gemini),
// chế độ này để Renderer tự vẽ frame từ MediaStream đang xem (Companion
// WebRTC của điện thoại, hoặc camera robot) lên <canvas>, xuất JPEG/base64
// rồi đẩy thẳng lên Main qua IPC "vision:camera-stream-frame". Main chỉ việc
// nhận và bơm vào liveSession — không tự chụp gì cả nên không có
// desktopCapturer trong luồng này.
export let isCameraStreamVisionEnabled = false;
// Hash SHA-1 của frame gần nhất nhận qua IPC — cùng ý tưởng AUDIT-VIS-02 ở
// trên: nếu điện thoại/robot đứng yên (không có gì thay đổi trong khung
// hình) thì bỏ qua, không gửi lại cho Gemini để tiết kiệm băng thông/token.
export let lastCameraStreamFrameHash = null;

export function stopCameraStreamVisionLoop() {
  isCameraStreamVisionEnabled = false;
  lastCameraStreamFrameHash = null;
  if (mainWindow) mainWindow.webContents.send("vision:toggle-camera-stream", false);
  emitEvent({ type: "camera_stream_vision_state", enabled: false });
}

export function toggleCameraStreamVision() {
  isCameraStreamVisionEnabled = !isCameraStreamVisionEnabled;
  if (isCameraStreamVisionEnabled) {
    // Direct Stream Vision và Screen Vision (desktopCapturer) không nên
    // chạy song song — cả hai đều gửi ảnh cho cùng 1 liveSession, chạy
    // chung sẽ vừa tốn token vừa gây nhiễu ("nhìn" hai nguồn cùng lúc).
    // Ngắt hẳn vòng lặp desktopCapturer trước khi bật luồng trực tiếp.
    stopVisionLoop();
    // FEAT-SH-CAM-01: cùng lý do trên, không để chạy song song với Smart
    // Home Vision hay Robot Vision (chỉ 1 nguồn ảnh gửi Gemini 1 lúc).
    stopSmartHomeVisionLoop();
    stopRobotVisionLoop();
    lastCameraStreamFrameHash = null;
    if (mainWindow) mainWindow.webContents.send("vision:toggle-camera-stream", true);
    emitEvent({ type: "camera_stream_vision_state", enabled: true });
    return {
      status: "enabled",
      message: "Direct Stream Vision enabled — I'm now watching the camera feed (companion phone / robot) directly instead of the desktop screen.",
    };
  }
  stopCameraStreamVisionLoop();
  return { status: "disabled", message: "Direct Stream Vision disabled." };
}

// Handles the "vision:camera-stream-frame" IPC message (renderer-drawn
// <canvas> frame from the Companion WebRTC stream or a robot camera). Kept
// here rather than in main.mjs's IPC-registration glue since it needs
// direct access to isCameraStreamVisionEnabled/lastCameraStreamFrameHash.
export function handleCameraStreamFrame(base64DataUrl) {
  if (!liveSession || !isCameraStreamVisionEnabled) return;
  const base64 = base64DataUrl.split(",")[1];
  if (!base64) return;
  // AUDIT-VIS-02 style dedupe: bỏ qua frame giống hệt frame trước (camera
  // đứng yên) để không tốn băng thông/token cho Gemini.
  const hash = crypto.createHash("sha1").update(base64).digest("hex");
  if (hash === lastCameraStreamFrameHash) return;
  lastCameraStreamFrameHash = hash;
  liveSession.sendRealtimeInput([{
    mimeType: "image/jpeg",
    data: base64,
  }]);
}

// Capture a small, low-quality frame for the vision loop — keeps the
// realtime stream lean while still giving Gemini enough detail to read errors,
// window titles, and code. Full-resolution capture is left for Computer Use.
export async function captureScreenForVision() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;
  // Downsample to at most 1280 wide, preserving aspect ratio
  const scale = Math.min(1280 / width, 720 / height, 1);
  const thumbW = Math.round(width * scale);
  const thumbH = Math.round(height * scale);
  const { desktopCapturer } = electron;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: thumbW, height: thumbH },
  });
  // toJPEG(50) ≈ 30-80 KB per frame — well within Gemini's bandwidth limits
  const jpegBuffer = sources[0].thumbnail.toJPEG(50);
  return jpegBuffer;
}

export function stopVisionLoop() {
  if (visionInterval) {
    clearInterval(visionInterval);
    visionInterval = null;
  }
  isVisionEnabled = false;
  emitEvent({ type: "vision_state", enabled: false });
}

export function toggleScreenVision() {
  isVisionEnabled = !isVisionEnabled;
  if (isVisionEnabled) {
    // Ngược lại với toggleCameraStreamVision(): bật Screen Vision (chụp
    // toàn màn hình) thì tắt Direct Stream Vision, tránh gửi trùng 2 nguồn.
    if (isCameraStreamVisionEnabled) stopCameraStreamVisionLoop();
    // FEAT-SH-CAM-01: cũng tắt Smart Home Vision / Robot Vision nếu đang bật.
    if (isSmartHomeVisionEnabled) stopSmartHomeVisionLoop();
    if (isRobotVisionEnabled) stopRobotVisionLoop();
    if (!visionInterval) {
      lastVisionFrameHash = null; // luôn gửi frame đầu tiên khi vừa bật lại
      visionInterval = setInterval(async () => {
        // Auto-stop if Gemini disconnected or vision was toggled off mid-interval
        if (!liveSession || !isVisionEnabled) {
          stopVisionLoop();
          return;
        }
        try {
          const jpegBuffer = await captureScreenForVision();
          // AUDIT-VIS-02: hash cheap trên buffer JPEG thô (rẻ hơn nhiều so
          // với base64-encode + gửi qua WebSocket). Nếu giống hệt frame
          // trước -> màn hình đứng yên -> bỏ qua, không tốn băng thông/token
          // Gemini cho một hình ảnh Gemini đã "nhìn thấy" rồi.
          const hash = crypto.createHash("sha1").update(jpegBuffer).digest("hex");
          if (hash === lastVisionFrameHash) return;
          lastVisionFrameHash = hash;

          const base64 = jpegBuffer.toString("base64");
          liveSession.sendRealtimeInput([{
            mimeType: "image/jpeg",
            data: base64,
          }]);
        } catch (e) {
          console.error("[IRIS][Vision] Error capturing screen:", e);
        }
      }, 4000);
    }
    emitEvent({ type: "vision_state", enabled: true });
    return { status: "enabled", message: "Live screen vision enabled. I can now see your screen." };
  } else {
    stopVisionLoop();
    return { status: "disabled", message: "Live screen vision disabled." };
  }
}

export function stopRobotVisionLoop() {
  if (robotVisionInterval) {
    clearInterval(robotVisionInterval);
    robotVisionInterval = null;
  }
  isRobotVisionEnabled = false;
  emitEvent({ type: "robot_vision_state", enabled: false });
  emitEvent({ type: "log", level: "info", message: "Robot vision loop stopped." });
}

export let activeRobotId = null;

// FEAT-SH-CAM-01: Smart Home Camera Vision — nhân bản đúng kiến trúc Robot
// Vision ở trên (getRobotsConfig/isRobotVisionEnabled/robotVisionInterval)
// nhưng cho camera nhà thông minh (smarthome_cameras.json), KHÔNG gộp chung
// với robots.json vì khác domain (camera nhà không di chuyển/không có
// control_url) và khác vòng đời bật/tắt (không liên quan gì tới robot).
export let isSmartHomeVisionEnabled = false;
export let smartHomeVisionInterval = null;
export let activeSmartHomeCameraId = null;

export function stopSmartHomeVisionLoop() {
  if (smartHomeVisionInterval) {
    clearInterval(smartHomeVisionInterval);
    smartHomeVisionInterval = null;
  }
  isSmartHomeVisionEnabled = false;
  activeSmartHomeCameraId = null;
  emitEvent({ type: "smarthome_vision_state", enabled: false });
  emitEvent({ type: "log", level: "info", message: "Smart Home camera vision loop stopped." });
}

export function toggleSmartHomeVision(args = {}) {
  const cameraId = args.camera_id;
  const cameras = getSmartHomeCamerasConfig();

  if (!isSmartHomeVisionEnabled) {
    if (!cameraId || !cameras[cameraId]) {
      return { status: "error", error: "Cannot enable Smart Home Vision: Invalid or missing camera_id." };
    }
    const url = cameras[cameraId].camera_url;
    if (!url) {
      return { status: "error", error: `Cannot enable Smart Home Vision: camera_url is not set for camera ${cameraId}.` };
    }
  }

  isSmartHomeVisionEnabled = !isSmartHomeVisionEnabled;
  if (isSmartHomeVisionEnabled) {
    // Chỉ 1 nguồn ảnh được gửi cho Gemini tại 1 thời điểm — tắt hẳn các
    // nguồn vision khác trước khi bật cái này, giống cách
    // toggleCameraStreamVision() đã làm với toggleScreenVision().
    stopVisionLoop();
    stopCameraStreamVisionLoop();
    stopRobotVisionLoop();
    if (!smartHomeVisionInterval) {
      smartHomeVisionInterval = setInterval(async () => {
        if (!liveSession || !isSmartHomeVisionEnabled) {
          stopSmartHomeVisionLoop();
          return;
        }
        try {
          const cams = getSmartHomeCamerasConfig();
          const url = cams[cameraId]?.camera_url;
          if (!url) {
            emitEvent({ type: "log", level: "warn", message: `Camera URL is not set for smart home camera ${cameraId}.` });
            stopSmartHomeVisionLoop();
            return;
          }
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buffer = await res.arrayBuffer();
          const base64 = Buffer.from(buffer).toString("base64");
          liveSession.sendRealtimeInput([{
            mimeType: "image/jpeg",
            data: base64,
          }]);
        } catch (e) {
          console.error("[IRIS][SmartHomeVision] Error capturing camera:", e);
        }
      }, 4000);
    }
    activeSmartHomeCameraId = cameraId;
    emitEvent({ type: "smarthome_vision_state", enabled: true, camera_id: cameraId });
    return { status: "enabled", message: `Smart Home camera vision enabled for ${cameraId}. I am now streaming camera frames.` };
  } else {
    stopSmartHomeVisionLoop();
    return { status: "disabled", message: "Smart Home camera vision disabled." };
  }
}

export function toggleRobotVision(args = {}) {
  const robotId = args.robot_id;
  const robots = getRobotsConfig();

  if (!isRobotVisionEnabled) {
    if (!robotId || !robots[robotId]) {
      return { status: "error", error: "Cannot enable Robot Vision: Invalid or missing robot_id." };
    }
    const url = robots[robotId].camera_url;
    if (!url) {
      return { status: "error", error: `Cannot enable Robot Vision: camera_url is not set for robot ${robotId}.` };
    }
  }

  isRobotVisionEnabled = !isRobotVisionEnabled;
  if (isRobotVisionEnabled) {
    // FEAT-SH-CAM-01: chỉ 1 nguồn ảnh gửi Gemini tại 1 thời điểm.
    if (isSmartHomeVisionEnabled) stopSmartHomeVisionLoop();
    if (isCameraStreamVisionEnabled) stopCameraStreamVisionLoop();
    if (!robotVisionInterval) {
      robotVisionInterval = setInterval(async () => {
        if (!liveSession || !isRobotVisionEnabled) {
          stopRobotVisionLoop();
          return;
        }
        try {
          const robots = getRobotsConfig();
          const url = robots[robotId]?.camera_url;
          if (!url) {
            emitEvent({ type: "log", level: "warn", message: `Camera URL is not set for robot ${robotId}.` });
            stopRobotVisionLoop();
            return;
          }
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buffer = await res.arrayBuffer();
          const base64 = Buffer.from(buffer).toString("base64");
          liveSession.sendRealtimeInput([{
            mimeType: "image/jpeg",
            data: base64,
          }]);
        } catch (e) {
          console.error("[IRIS][RobotVision] Error capturing camera:", e);
        }
      }, 4000);
    }
    activeRobotId = robotId;
    emitEvent({ type: "robot_vision_state", enabled: true, robot_id: robotId });
    return { status: "enabled", message: `Robot live vision enabled for ${robotId}. I am now streaming camera frames.` };
  } else {
    stopRobotVisionLoop();
    activeRobotId = null;
    return { status: "disabled", message: "Robot live vision disabled." };
  }
}
