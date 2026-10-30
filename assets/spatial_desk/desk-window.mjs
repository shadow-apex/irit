/**
 * assets/spatial_desk/desk-window.mjs
 *
 * Quản lý vòng đời cửa sổ máy chiếu trong suốt (Spatial AI Desk Window),
 * kết nối cảm ứng tay MediaPipe, kéo thả cửa sổ Infinite Desk Extension,
 * thước đo Laze quang học chuẩn milimet (desk_caliper.py), bộ sinh file in 3D .STL (desk_stl_gen.py),
 * tự động hiệu chuẩn máy chiếu ArUco 2 giây (desk_autocalib.py),
 * chiếu sơ đồ chân linh kiện điện tử (desk_pcb_pinout.py),
 * bắn thẳng lệnh in 3D sang Bambu Lab / OctoPrint (desk_3d_printer.py),
 * và tái tạo mô hình 3D vật thể đa góc (desk_photogrammetry.py).
 *
 * NGUYÊN TẮC BẤT BIẾN:
 *  - Khi không bật chế độ Desk: 0% CPU, 0MB RAM phụ trợ, không có timer/interval chạy ngầm.
 *  - Khi đóng cửa sổ: huỷ toàn bộ timer, giải phóng sạch BrowserWindow và tiến trình con, 0 zombie process.
 */
import electron from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { detectProjectorDisplay, computeInfiniteDeskTransfer, mapMainToDeskWindowCard } from "./desk-projector.mjs";
import { ProCamCalibrator, evaluateHandPinchAndTouch, DEFAULT_PPM } from "./procam-calibration.mjs";
import { pythonBin, userDataDir } from "../../electron/main/paths.mjs";
import { killTree } from "../../electron/main/process-utils.mjs";
import { getCachedActiveWindow } from "../../electron/main/local-tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SPATIAL_DESK_DIR = __dirname;
export const DESK_HUD_HTML_PATH = path.join(__dirname, "desk-hud", "index.html");
export const DESK_TOOLS_DIR = path.join(__dirname, "tools");
export const PROCAM_CONFIG_PATH = path.join(__dirname, "procam_config.json");

let deskWindow = null;
let edgeWatchInterval = null;
let lastDropTriggeredAt = 0;
let currentDisplayInfo = null;
const calibrator = new ProCamCalibrator({ ppm: DEFAULT_PPM });

// Nạp cấu hình hiệu chuẩn tự động từ procam_config.json nếu đã tồn tại
function loadPersistedProCamConfig() {
  try {
    if (fs.existsSync(PROCAM_CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(PROCAM_CONFIG_PATH, "utf8"));
      if (raw && typeof raw === "object") {
        calibrator.updateCalibration({
          ppm: raw.ppm,
          cameraQuad: raw.cameraQuad,
          projectorQuad: raw.projectorQuad,
        });
      }
    }
  } catch {
    /* ignore malformed config */
  }
}
loadPersistedProCamConfig();

// Lưu kết quả đo gần nhất từ thước đo Laze để truyền trực tiếp sang bộ sinh 3D .STL
let lastMeasuredObject = {
  label: "Vật mẫu trên bàn",
  length_mm: 52.0,
  width_mm: 28.0,
  height_mm: 18.0,
  ppm: calibrator.ppm,
};

let lastGeneratedStlPath = "desktop/iris_spatial_box.stl";

function getElectronBrowserWindow() {
  if (electron && typeof electron === "object" && typeof electron.BrowserWindow === "function") {
    return electron.BrowserWindow;
  }
  return null;
}

function getElectronScreen() {
  if (electron && typeof electron === "object" && electron.screen) {
    return electron.screen;
  }
  return null;
}

/**
 * Kiểm tra cửa sổ Spatial AI Desk có đang mở hay không.
 */
export function isSpatialDeskOpen() {
  return Boolean(deskWindow && !deskWindow.isDestroyed?.());
}

/**
 * Trả về trạng thái hiện tại của phân hệ Spatial AI Desk.
 */
export function getSpatialDeskStatus() {
  const open = isSpatialDeskOpen();
  return {
    open,
    mode: currentDisplayInfo?.mode || "inactive",
    isSimulator: Boolean(currentDisplayInfo?.isSimulator),
    displayCount: currentDisplayInfo?.displayCount || 0,
    displayBounds: currentDisplayInfo?.display?.bounds || null,
    ppm: calibrator.ppm,
    lastMeasuredObject: { ...lastMeasuredObject },
    lastGeneratedStlPath,
  };
}

/**
 * Gọi hàm cập nhật giao diện trong Desk HUD an toàn (No-op khi cửa sổ đóng).
 */
export function invokeDeskHudMethod(methodName, ...args) {
  if (!isSpatialDeskOpen()) return false;
  try {
    const wc = deskWindow.webContents;
    if (!wc || wc.isDestroyed?.()) return false;
    const serializedArgs = args.map((a) => JSON.stringify(a)).join(", ");
    wc.executeJavaScript(
      `window.spatialDeskHud && typeof window.spatialDeskHud.${methodName} === "function" && window.spatialDeskHud.${methodName}(${serializedArgs});`,
      true,
    ).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function stopEdgeWatchInterval() {
  if (edgeWatchInterval) {
    clearInterval(edgeWatchInterval);
    edgeWatchInterval = null;
  }
}

function startEdgeWatchInterval() {
  stopEdgeWatchInterval();
  const screenApi = getElectronScreen();
  if (!screenApi || typeof screenApi.getCursorScreenPoint !== "function") return;

  edgeWatchInterval = setInterval(() => {
    if (!isSpatialDeskOpen()) {
      stopEdgeWatchInterval();
      return;
    }
    try {
      const cursor = screenApi.getCursorScreenPoint();
      const primaryBounds = currentDisplayInfo?.primaryDisplay?.bounds || { x: 0, y: 0, width: 1920, height: 1080 };
      const deskBounds = currentDisplayInfo?.display?.bounds || primaryBounds;
      const transfer = computeInfiniteDeskTransfer(cursor, primaryBounds, deskBounds, 10);

      // Khi người dùng kéo con trỏ chạm sát mép dưới màn hình chính (cooldown 4s tránh nhân bản)
      const now = Date.now();
      if (transfer.triggered && now - lastDropTriggeredAt > 4000) {
        const activeWin = getCachedActiveWindow();
        if (activeWin && activeWin.title && !/Iris Spatial AI Desk/i.test(activeWin.title)) {
          lastDropTriggeredAt = now;
          const card = mapMainToDeskWindowCard(
            { ...activeWin, x: cursor.x - 200 },
            primaryBounds,
            deskBounds,
          );
          invokeDeskHudMethod("dropWindowToDesk", card);
        }
      }
    } catch {
      /* ignore screen polling errors */
    }
  }, 350);
}

/**
 * Mở cửa sổ máy chiếu trong suốt thứ hai (Desk HUD).
 * Tự động phát hiện màn hình phụ của máy chiếu hoặc mở chế độ Simulator nếu chỉ có 1 màn hình.
 */
export function openSpatialDesk(options = {}) {
  if (isSpatialDeskOpen()) {
    try {
      deskWindow.showInactive?.();
    } catch {
      /* ignore */
    }
    return {
      status: "success",
      action: "already_open",
      ...getSpatialDeskStatus(),
    };
  }

  const screenApi = options.screenApi || getElectronScreen();
  const BrowserWindowCtor = options.BrowserWindowCtor || getElectronBrowserWindow();
  currentDisplayInfo = detectProjectorDisplay(screenApi);
  const targetBounds = currentDisplayInfo.display?.bounds || { x: 0, y: 0, width: 1920, height: 1080 };

  // Hỗ trợ chạy trong môi trường unit test Node.js (không có tiến trình Electron GUI)
  if (!BrowserWindowCtor) {
    deskWindow = {
      _headlessMock: true,
      bounds: { ...targetBounds },
      isDestroyed: () => false,
      close() {
        this._destroyed = true;
      },
      destroy() {
        this._destroyed = true;
      },
      webContents: {
        isDestroyed: () => false,
        executeJavaScript: () => Promise.resolve(true),
      },
    };
    deskWindow.isDestroyed = () => Boolean(deskWindow?._destroyed);
    return {
      status: "success",
      action: "opened",
      ...getSpatialDeskStatus(),
    };
  }

  deskWindow = new BrowserWindowCtor({
    x: targetBounds.x,
    y: targetBounds.y,
    width: targetBounds.width,
    height: targetBounds.height,
    transparent: true,
    frame: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  try {
    deskWindow.setBounds(targetBounds);
    deskWindow.setAlwaysOnTop(true, "screen-saver");
    deskWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  } catch {
    /* ignore platform-specific window hints */
  }

  if (fs.existsSync(DESK_HUD_HTML_PATH)) {
    deskWindow.loadFile(DESK_HUD_HTML_PATH, {
      query: {
        mode: currentDisplayInfo.mode,
        ppm: String(calibrator.ppm),
      },
    }).catch(() => {});
  }

  deskWindow.once?.("ready-to-show", () => {
    if (isSpatialDeskOpen()) {
      deskWindow.showInactive?.();
    }
  });

  deskWindow.on?.("closed", () => {
    stopEdgeWatchInterval();
    deskWindow = null;
    currentDisplayInfo = null;
  });

  startEdgeWatchInterval();

  return {
    status: "success",
    action: "opened",
    ...getSpatialDeskStatus(),
  };
}

/**
 * Đóng ngay lập tức cửa sổ Spatial AI Desk và giải phóng 100% tài nguyên bộ nhớ / timer.
 */
export function closeSpatialDesk() {
  stopEdgeWatchInterval();
  if (!deskWindow) {
    currentDisplayInfo = null;
    return {
      status: "success",
      action: "closed",
      open: false,
      mode: "inactive",
    };
  }

  const win = deskWindow;
  deskWindow = null;
  currentDisplayInfo = null;

  try {
    if (!win.isDestroyed?.()) {
      win.removeAllListeners?.("closed");
      win.close?.();
      if (!win.isDestroyed?.()) {
        win.destroy?.();
      }
    }
  } catch {
    /* ignore */
  }

  return {
    status: "success",
    action: "closed",
    open: false,
    mode: "inactive",
  };
}

/**
 * Bật / Tắt cửa sổ Spatial AI Desk (dùng cho phím tắt toàn cục & lệnh thoại).
 */
export function toggleSpatialDesk(options = {}) {
  if (isSpatialDeskOpen()) {
    return closeSpatialDesk();
  }
  return openSpatialDesk(options);
}

/**
 * Chuyển tiếp cử chỉ tay MediaPipe (THUMB_TIP + INDEX_FINGER_TIP) sang Desk HUD.
 * Tiêu tốn 0% CPU khi chế độ Desk đang tắt.
 */
export function forwardHandGestureToDesk(gesture) {
  if (!isSpatialDeskOpen() || !gesture) return false;

  const deskBounds = currentDisplayInfo?.display?.bounds || { width: 1920, height: 1080 };
  if (Array.isArray(gesture.landmarks) && gesture.landmarks.length >= 9) {
    const evaluated = evaluateHandPinchAndTouch(gesture.landmarks, calibrator.homography, deskBounds);
    if (evaluated) {
      return invokeDeskHudMethod("onHandGesture", evaluated);
    }
  }
  return invokeDeskHudMethod("onHandGesture", gesture);
}

/**
 * Nhận diện nhanh khẩu lệnh tiếng Việt từ Gemini Live để điều khiển bàn làm việc không gian tức thì
 * và phản chiếu phụ đề hội thoại xuống mặt bàn.
 */
export function handleSpatialDeskVoiceTranscript(speaker, text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const cleaned = text.trim();

  if (isSpatialDeskOpen()) {
    invokeDeskHudMethod("updateMirrorTranscript", speaker, cleaned);
  }

  if (speaker !== "you") return null;
  const lower = cleaned.toLowerCase();

  // Khẩu lệnh đóng bàn làm việc: "Iris, đóng bàn làm việc", "tắt bàn làm việc", "đóng máy chiếu bàn"
  if (/(?:đóng|tắt|thoát)\s+(?:chế\s+độ\s+)?(?:bàn\s+làm\s+việc|bàn\s+không\s+gian|máy\s+chiếu\s+bàn)/i.test(lower)) {
    return closeSpatialDesk();
  }

  // Khẩu lệnh mở bàn làm việc: "Iris, mở bàn làm việc", "bật bàn làm việc", "mở bàn không gian"
  if (/(?:mở|bật|kích\s+hoạt)\s+(?:chế\s+độ\s+)?(?:bàn\s+làm\s+việc|bàn\s+không\s+gian|máy\s+chiếu\s+bàn)/i.test(lower)) {
    return openSpatialDesk();
  }

  // Tính năng 1: "Iris, tự căn chỉnh máy chiếu" / "tự động hiệu chuẩn máy chiếu"
  if (/(?:tự\s+căn\s+chỉnh\s+máy\s+chiếu|hiệu\s+chuẩn\s+máy\s+chiếu|căn\s+chỉnh\s+máy\s+chiếu|tự\s+động\s+hiệu\s+chuẩn)/i.test(lower)) {
    return deskAutoCalibrateTool({});
  }

  // Tính năng 2: "Iris, chiếu sơ đồ chân bo mạch này" / "chiếu sơ đồ chân"
  if (/(?:chiếu\s+sơ\s+đồ\s+chân|sơ\s+đồ\s+chân\s+bo\s+mạch|sơ\s+đồ\s+chân\s+linh\s+kiện|sơ\s+đồ\s+chân\s+chip|pinout)/i.test(lower)) {
    let board = "esp32";
    if (/uno/i.test(lower)) board = "arduino_uno";
    else if (/nano/i.test(lower)) board = "arduino_nano";
    else if (/mega/i.test(lower)) board = "arduino_mega";
    else if (/pico|rp2040/i.test(lower)) board = "raspberry_pi_pico";
    else if (/stm32|bluepill/i.test(lower)) board = "stm32_bluepill";
    else if (/555/i.test(lower)) board = "ic_555";
    else if (/atmega/i.test(lower)) board = "atmega328p";
    else if (/8266/i.test(lower)) board = "esp8266";
    return deskOverlayPinoutTool({ board });
  }

  // Tính năng 3: "Iris, gửi lệnh in 3D" / "Iris, in chi tiết này" / "bắt đầu in 3D"
  if (/(?:gửi\s+lệnh\s+in\s+3d|in\s+chi\s+tiết\s+này|bắt\s+đầu\s+in\s+3d|bắn\s+lệnh\s+in\s+3d)/i.test(lower)) {
    return deskSendTo3dPrinterTool({ stl_path: lastGeneratedStlPath });
  }

  // Tính năng 4: "Iris, quét 3D vật thể này" / "quét 3D đa góc" / "dựng 3D vật thể"
  if (/(?:quét\s+3d\s+vật\s+thể|quét\s+3d\s+đa\s+góc|tái\s+tạo\s+3d|chụp\s+3d\s+vật\s+thể)/i.test(lower)) {
    return deskScan3dMeshTool({ label: lastMeasuredObject.label || "Vật thể trên bàn" });
  }

  // Mở file 3D CAD: "Iris, mở file 3D" / "mở file CAD" / "chọn file STL"
  if (/(?:mở\s+file\s+3d|mở\s+file\s+cad|chọn\s+file\s+stl|mở\s+mô\s+hình\s+3d|load\s+cad)/i.test(lower)) {
    return deskLoadCadModelTool({ file: "dialog" });
  }

  // Tách chi tiết lắp ráp: "Iris, tách chi tiết" / "tách nắp hộp" / "bung mô hình 3D"
  if (/(?:tách\s+chi\s+tiết|tách\s+nắp|bung\s+chi\s+tiết|nổ\s+chi\s+tiết|exploded\s+view)/i.test(lower)) {
    return deskToggleExplodeTool({ explode: true });
  }

  // Lắp lại chi tiết: "Iris, lắp lại nắp" / "đóng nắp hộp" / "hủy tách chi tiết"
  if (/(?:lắp\s+lại\s+nắp|đóng\s+nắp|lắp\s+ráp\s+lại|hủy\s+tách|thu\s+gọn\s+chi\s+tiết)/i.test(lower)) {
    return deskToggleExplodeTool({ explode: false });
  }

  // Chỉnh sửa kích thước thủ công bằng giọng nói: "Iris, chỉnh kích thước hộp dài 70 rộng 45 cao 30"
  if (/(?:chỉnh\s+kích\s+thước|nới\s+rộng\s+hộp|kéo\s+dài\s+hộp|thu\s+nhỏ\s+hộp)/i.test(lower)) {
    const lenM = lower.match(/(?:dài|chiều dài)\s*(\d+(?:\.\d+)?)/i);
    const widM = lower.match(/(?:rộng|chiều rộng)\s*(\d+(?:\.\d+)?)/i);
    const heiM = lower.match(/(?:cao|chiều cao)\s*(\d+(?:\.\d+)?)/i);
    return deskModifyCadDimensionsTool({
      length_mm: lenM ? parseFloat(lenM[1]) : undefined,
      width_mm: widM ? parseFloat(widM[1]) : undefined,
      height_mm: heiM ? parseFloat(heiM[1]) : undefined,
    });
  }

  // 1.3: "Iris, đây là cái gì?" / "quét linh kiện trên bàn" / "quét X-Ray"
  if (/(?:đây là cái gì|đây là gì|quét x-ray|quét linh kiện|giải mã linh kiện)/i.test(lower)) {
    return toggleSpatialDeskTool({ action: "xray_scan" });
  }

  // 1.4: "Iris, chìa khóa / bút / ví của tôi ở đâu?" / "tìm đồ vật trên bàn"
  const auraMatch = lower.match(/(?:tìm|ở đâu|đâu rồi)\s*[:?]?\s*([a-z0-9à-ỹ\s]+)/i) ||
                    lower.match(/([a-z0-9à-ỹ\s]+?)\s+(?:của tôi\s+)?ở đâu/i);
  if (auraMatch && /(?:chìa khóa|bút|ví|điện thoại|sách|thẻ|tai nghe|đồng hồ|kính)/i.test(lower)) {
    let target = auraMatch[1].replace(/của tôi|của em|của mình|trên bàn|với/gi, "").trim();
    if (!target) target = "Đồ vật cần tìm";
    target = target.charAt(0).toUpperCase() + target.slice(1);
    return toggleSpatialDeskTool({ action: "aura_locate", target });
  }

  // 1.5: "Iris, đo kích thước vật này" / "bật thước đo laze"
  if (/(?:đo kích thước|đo vật này|thước đo laze|bật thước laze|đo milimet)/i.test(lower)) {
    return deskMeasureObjectTool({ label: "Vật mẫu trên bàn" });
  }

  // 1.6: "Iris, thiết kế một hộp đựng vừa khít vật này... để in 3D" / "xuất file STL"
  if (/(?:thiết kế|hộp đựng|xuất file stl|tạo stl|file in 3d)/i.test(lower)) {
    return deskGenerateStlTool({ model_type: "sliding_box", wall_mm: 2.0 });
  }

  return null;
}

/**
 * Thực thi script Python trong `assets/spatial_desk/tools/` an toàn, không rò rỉ tiến trình zombie.
 */
export function runSpatialDeskPython(scriptName, args = [], timeoutMs = 15000) {
  const scriptPath = path.join(DESK_TOOLS_DIR, scriptName);
  const py = pythonBin();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child = null;

    const cleanup = () => {
      if (!child) return;
      for (const s of [child.stdin, child.stdout, child.stderr]) {
        if (!s) continue;
        try { s.removeAllListeners(); } catch { /* ignore */ }
        try { if (!s.destroyed) s.destroy(); } catch { /* ignore */ }
      }
      try { child.removeAllListeners(); } catch { /* ignore */ }
    };

    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(result);
    };

    const timer = setTimeout(() => {
      if (child) {
        try { killTree(child); } catch { /* ignore */ }
      }
      done({ status: "error", error: `Quá thời gian thực thi ${scriptName} (${timeoutMs}ms)` });
    }, timeoutMs);

    try {
      child = spawn(py, [scriptPath, ...args.map(String)], {
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
          IRIS_USER_DATA: userDataDir(),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      return done({ status: "error", error: err.message || String(err) });
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 500_000) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 100_000) stderr += chunk;
    });
    child.on("error", (err) => done({ status: "error", error: err.message || String(err) }));
    child.on("close", (code) => {
      const line = stdout.trim().split("\n").pop() || "";
      try {
        const parsed = JSON.parse(line);
        if (parsed && parsed.success !== false && code === 0) {
          done({ ...parsed, status: "success" });
        } else {
          done({ status: "error", error: parsed?.error || stderr.trim() || `Exit code ${code}` });
        }
      } catch {
        if (code === 0) {
          done({ status: "success", output: stdout.trim() });
        } else {
          done({ status: "error", error: stderr.trim() || stdout.trim() || `Exit code ${code}` });
        }
      }
    });
  });
}

// ============================================================================
// CÁC HÀM TOOL CHO GEMINI LIVE (tool-dispatcher.mjs)
// ============================================================================

/**
 * Tool 1: `toggle_spatial_desk` — Điều khiển cửa sổ Bàn làm việc không gian,
 * kéo cửa sổ xuống bàn, quét X-Ray linh kiện hoặc bật Vòng hào quang Aura tìm đồ vật.
 */
export async function toggleSpatialDeskTool(args = {}) {
  const rawAction = String(args?.action || "toggle").trim().toLowerCase();

  if (rawAction === "close" || rawAction === "off" || rawAction === "exit") {
    return closeSpatialDesk();
  }

  if (rawAction === "status") {
    return { status: "success", ...getSpatialDeskStatus() };
  }

  if (rawAction === "open" || rawAction === "on") {
    return openSpatialDesk();
  }

  if (rawAction === "aura_locate" || rawAction === "locate") {
    if (!isSpatialDeskOpen()) openSpatialDesk();
    const target = String(args?.target || "Đồ vật trên bàn").trim();
    invokeDeskHudMethod("triggerAuraLocate", target, args?.x, args?.y);
    return {
      status: "success",
      action: "aura_locate",
      target,
      message: `Đã bật vòng hào quang Neon định vị [${target}] trên mặt bàn.`,
      ...getSpatialDeskStatus(),
    };
  }

  if (rawAction === "xray_scan" || rawAction === "xray") {
    if (!isSpatialDeskOpen()) openSpatialDesk();
    invokeDeskHudMethod("triggerXrayScan", true, args?.callouts || null);
    return {
      status: "success",
      action: "xray_scan",
      message: "Đã kích hoạt tia quét X-Ray và sơ đồ chú thích linh kiện trên mặt bàn.",
      ...getSpatialDeskStatus(),
    };
  }

  if (rawAction === "drop_window" || rawAction === "extend_window") {
    if (!isSpatialDeskOpen()) openSpatialDesk();
    const activeWin = getCachedActiveWindow() || {};
    const primaryBounds = currentDisplayInfo?.primaryDisplay?.bounds || { x: 0, y: 0, width: 1920, height: 1080 };
    const deskBounds = currentDisplayInfo?.display?.bounds || primaryBounds;
    const card = mapMainToDeskWindowCard(
      {
        title: args?.target || activeWin.title || "Cửa sổ Ứng dụng",
        process_name: activeWin.process_name || "Windows App",
      },
      primaryBounds,
      deskBounds,
    );
    invokeDeskHudMethod("dropWindowToDesk", card);
    return {
      status: "success",
      action: "drop_window",
      windowCard: card,
      message: `Đã kéo cửa sổ "${card.title}" thả xuống mặt bàn không gian.`,
    };
  }

  if (rawAction === "calibrate") {
    const snap = calibrator.updateCalibration({
      ppm: args?.ppm,
      cameraQuad: args?.cameraQuad,
      projectorQuad: args?.projectorQuad,
    });
    return {
      status: "success",
      action: "calibrated",
      calibration: snap,
    };
  }

  return toggleSpatialDesk();
}

/**
 * Tool 2: `desk_measure_object` — Đo kích thước vật thể trên bàn bằng thước Laze quang học chuẩn milimet.
 */
export async function deskMeasureObjectTool(args = {}) {
  const cliArgs = [];
  const ppm = Number(args?.ppm) > 0 ? Number(args.ppm) : calibrator.ppm;
  cliArgs.push("--ppm", String(ppm));

  if (args?.label) {
    cliArgs.push("--label", String(args.label));
  }
  if (typeof args?.x1 === "number" && typeof args?.y1 === "number" && typeof args?.x2 === "number" && typeof args?.y2 === "number") {
    cliArgs.push("--x1", String(args.x1), "--y1", String(args.y1), "--x2", String(args.x2), "--y2", String(args.y2));
  }
  if (typeof args?.width_px === "number" && typeof args?.height_px === "number") {
    cliArgs.push("--width-px", String(args.width_px), "--height-px", String(args.height_px));
  }
  if (typeof args?.height_mm === "number" && args.height_mm > 0) {
    cliArgs.push("--height-mm", String(args.height_mm));
  }
  if (args?.image && typeof args.image === "string") {
    cliArgs.push("--image", args.image);
  }
  if (Array.isArray(args?.region) && args.region.length === 4) {
    cliArgs.push("--region", ...args.region.map((v) => String(Math.round(Number(v) || 0))));
  }
  if (args?.no_ocr === true) {
    cliArgs.push("--no-ocr");
  }

  const res = await runSpatialDeskPython("desk_caliper.py", cliArgs);
  if (res.status === "success") {
    lastMeasuredObject = {
      label: res.label || args?.label || "Vật mẫu trên bàn",
      length_mm: res.length_mm,
      width_mm: res.width_mm,
      height_mm: res.height_mm || 18.0,
      ppm: res.ppm || ppm,
    };
    if (isSpatialDeskOpen()) {
      invokeDeskHudMethod("updateMeasurement", res);
    }
  }
  return res;
}

/**
 * Tool 3: `desk_generate_stl` — AI Thiết kế & Xuất file in 3D (.STL) qua OpenSCAD tham số ra Desktop.
 */
export async function deskGenerateStlTool(args = {}) {
  const lengthMm = Number(args?.length_mm) > 0 ? Number(args.length_mm) : lastMeasuredObject.length_mm;
  const widthMm = Number(args?.width_mm) > 0 ? Number(args.width_mm) : lastMeasuredObject.width_mm;
  const heightMm = Number(args?.height_mm) > 0 ? Number(args.height_mm) : lastMeasuredObject.height_mm;
  const wallMm = Number(args?.wall_mm) > 0 ? Number(args.wall_mm) : 2.0;
  const clearanceMm = Number(args?.clearance_mm) >= 0 ? Number(args.clearance_mm) : 0.8;
  const modelType = String(args?.model_type || "sliding_box").trim().toLowerCase();
  const output = String(args?.output || "desktop/iris_spatial_box.stl").trim();

  const cliArgs = [
    "--output", output,
    "--type", modelType,
    "--length", String(lengthMm),
    "--width", String(widthMm),
    "--height", String(heightMm),
    "--wall", String(wallMm),
    "--clearance", String(clearanceMm),
  ];

  if (args?.has_lid === false) {
    cliArgs.push("--no-lid");
  }
  if (args?.open_slicer === true) {
    cliArgs.push("--open-slicer");
  }

  const res = await runSpatialDeskPython("desk_stl_gen.py", cliArgs, 25000);
  if (res.status === "success") {
    if (res.stl_path) lastGeneratedStlPath = res.stl_path;
    if (isSpatialDeskOpen()) {
      invokeDeskHudMethod("updateStlModel", res);
    }
  }
  return res;
}

/**
 * Tool 4: `desk_auto_calibrate` — Tự động hiệu chuẩn Máy chiếu - Camera bằng ArUco / Chessboard trong 2 giây.
 */
export async function deskAutoCalibrateTool(args = {}) {
  if (!isSpatialDeskOpen()) openSpatialDesk();

  const cliArgs = [];
  if (args?.image && typeof args.image === "string") {
    cliArgs.push("--image", args.image);
  }
  if (typeof args?.camera_id === "number" && args.camera_id >= 0) {
    cliArgs.push("--camera-id", String(Math.round(args.camera_id)));
  }
  if (typeof args?.board_width_mm === "number" && args.board_width_mm > 0) {
    cliArgs.push("--board-width-mm", String(args.board_width_mm));
  }
  if (typeof args?.board_height_mm === "number" && args.board_height_mm > 0) {
    cliArgs.push("--board-height-mm", String(args.board_height_mm));
  }
  if (typeof args?.projector_width === "number" && args.projector_width > 0) {
    cliArgs.push("--projector-width", String(Math.round(args.projector_width)));
  }
  if (typeof args?.projector_height === "number" && args.projector_height > 0) {
    cliArgs.push("--projector-height", String(Math.round(args.projector_height)));
  }
  if (args?.output_config && typeof args.output_config === "string") {
    cliArgs.push("--output-config", args.output_config);
  }

  const res = await runSpatialDeskPython("desk_autocalib.py", cliArgs, 15000);
  if (res.status === "success") {
    calibrator.updateCalibration({
      ppm: res.ppm,
      cameraQuad: res.cameraQuad,
      projectorQuad: res.projectorQuad,
    });
    lastMeasuredObject.ppm = calibrator.ppm;
    invokeDeskHudMethod("triggerAutoCalibration", res);
  }
  return res;
}

/**
 * Tool 5: `desk_overlay_pinout` — Chiếu sơ đồ chân linh kiện điện tử (Interactive PCB Pinout Overlay) trực tiếp lên mặt bàn.
 */
export async function deskOverlayPinoutTool(args = {}) {
  if (!isSpatialDeskOpen()) openSpatialDesk();

  const cliArgs = [];
  const board = String(args?.board || "esp32").trim();
  cliArgs.push("--board", board);
  cliArgs.push("--ppm", String(Number(args?.ppm) > 0 ? Number(args.ppm) : calibrator.ppm));

  if (args?.image && typeof args.image === "string") {
    cliArgs.push("--image", args.image);
  }
  if (typeof args?.center_x === "number") {
    cliArgs.push("--center-x", String(Math.round(args.center_x)));
  }
  if (typeof args?.center_y === "number") {
    cliArgs.push("--center-y", String(Math.round(args.center_y)));
  }
  if (typeof args?.angle === "number") {
    cliArgs.push("--angle", String(args.angle));
  }
  if (args?.vision_fallback === true) {
    cliArgs.push("--vision-fallback");
  }

  const res = await runSpatialDeskPython("desk_pcb_pinout.py", cliArgs, 15000);
  if (res.status === "success" && isSpatialDeskOpen()) {
    invokeDeskHudMethod("updatePinoutOverlay", res);
  }
  return res;
}

/**
 * Tool 6: `desk_send_to_3d_printer` — Cắt lớp G-code nền và bắn thẳng lệnh in 3D sang máy in Bambu Lab / OctoPrint.
 */
export async function deskSendTo3dPrinterTool(args = {}) {
  if (!isSpatialDeskOpen()) openSpatialDesk();

  const stlPath = String(args?.stl_path || lastGeneratedStlPath || "desktop/iris_spatial_box.stl").trim();
  const printerType = String(args?.printer_type || "bambu_lab").trim().toLowerCase();
  const printerModel = String(args?.printer_model || "x1c").trim().toLowerCase();

  const cliArgs = [
    "--stl", stlPath,
    "--printer-type", printerType,
    "--printer-model", printerModel,
  ];

  if (args?.host && typeof args.host === "string") {
    cliArgs.push("--host", args.host);
  }
  if (args?.api_key && typeof args.api_key === "string") {
    cliArgs.push("--api-key", args.api_key);
  }
  if (args?.access_code && typeof args.access_code === "string") {
    cliArgs.push("--access-code", args.access_code);
  }
  if (args?.serial && typeof args.serial === "string") {
    cliArgs.push("--serial", args.serial);
  }
  if (typeof args?.layer_height === "number" && args.layer_height > 0) {
    cliArgs.push("--layer-height", String(args.layer_height));
  }
  if (typeof args?.infill === "number" && args.infill >= 0) {
    cliArgs.push("--infill", String(Math.round(args.infill)));
  }
  if (typeof args?.nozzle_temp === "number" && args.nozzle_temp > 0) {
    cliArgs.push("--nozzle-temp", String(Math.round(args.nozzle_temp)));
  }
  if (typeof args?.bed_temp === "number" && args.bed_temp >= 0) {
    cliArgs.push("--bed-temp", String(Math.round(args.bed_temp)));
  }
  if (args?.slicer && typeof args.slicer === "string") {
    cliArgs.push("--slicer", args.slicer);
  }

  const res = await runSpatialDeskPython("desk_3d_printer.py", cliArgs, 25000);
  if (res.status === "success" && isSpatialDeskOpen()) {
    invokeDeskHudMethod("update3dPrintJob", res);
  }
  return res;
}

/**
 * Tool 7: `desk_scan_3d_mesh` — Tái tạo mô hình 3D vật thể từ ảnh chụp đa góc (Multi-View 3D Reconstruction).
 */
export async function deskScan3dMeshTool(args = {}) {
  if (!isSpatialDeskOpen()) openSpatialDesk();

  const output = String(args?.output || "desktop/iris_reconstructed_mesh.stl").trim();
  const views = typeof args?.views === "number" && args.views >= 8 ? Math.min(16, Math.round(args.views)) : 12;
  const lengthMm = Number(args?.length_mm) > 0 ? Number(args.length_mm) : lastMeasuredObject.length_mm;
  const widthMm = Number(args?.width_mm) > 0 ? Number(args.width_mm) : lastMeasuredObject.width_mm;
  const heightMm = Number(args?.height_mm) > 0 ? Number(args.height_mm) : 44.0;
  const label = String(args?.label || lastMeasuredObject.label || "Vật thể quét 3D đa góc").trim();

  const cliArgs = [
    "--output", output,
    "--views", String(views),
    "--length", String(lengthMm),
    "--width", String(widthMm),
    "--height", String(heightMm),
    "--label", label,
  ];

  if (args?.preset && typeof args.preset === "string") {
    cliArgs.push("--preset", args.preset);
  }
  if (Array.isArray(args?.images) && args.images.length > 0) {
    cliArgs.push("--images", ...args.images.map(String));
  }

  const res = await runSpatialDeskPython("desk_photogrammetry.py", cliArgs, 25000);
  if (res.status === "success") {
    if (res.stl_path) lastGeneratedStlPath = res.stl_path;
    if (isSpatialDeskOpen()) {
      invokeDeskHudMethod("updatePhotogrammetryScan", res);
    }
  }
  return res;
}

/**
 * Tool 8: `desk_load_cad_model` — Mở file 3D CAD (.STL / .OBJ) từ ổ đĩa hoặc hộp thoại chọn file để chiếu lên bàn.
 */
export async function deskLoadCadModelTool(args = {}) {
  if (!isSpatialDeskOpen()) openSpatialDesk();

  let targetFile = String(args?.file || "").trim();
  if (targetFile === "dialog" || targetFile === "picker" || (!targetFile && args?.open_picker === true)) {
    if (electron?.dialog && deskWindow) {
      try {
        const pickRes = await electron.dialog.showOpenDialog(deskWindow, {
          title: "Chọn file 3D CAD hoặc Bản vẽ AutoCAD (.STL / .OBJ / .DWG / .DXF)",
          properties: ["openFile"],
          filters: [
            { name: "3D CAD & Bản vẽ kỹ thuật", extensions: ["stl", "obj", "dwg", "dxf"] },
            { name: "Mô hình 3D Mesh (*.stl, *.obj)", extensions: ["stl", "obj"] },
            { name: "Bản vẽ AutoCAD (*.dwg, *.dxf)", extensions: ["dwg", "dxf"] },
            { name: "Tất cả tệp (*.*)", extensions: ["*"] },
          ],
        });
        if (pickRes && !pickRes.canceled && pickRes.filePaths?.[0]) {
          targetFile = pickRes.filePaths[0];
        } else if (pickRes?.canceled) {
          return { status: "cancelled", message: "Đã huỷ chọn file 3D CAD." };
        }
      } catch {
        /* fallback to default */
      }
    }
  }

  const cliArgs = [];
  if (targetFile && targetFile !== "dialog" && targetFile !== "picker") {
    cliArgs.push("--file", targetFile);
  }
  if (args?.explode === true) {
    cliArgs.push("--explode");
  }
  if (typeof args?.explode_distance === "number" && args.explode_distance > 0) {
    cliArgs.push("--explode-distance", String(args.explode_distance));
  }

  const res = await runSpatialDeskPython("desk_cad_parser.py", cliArgs, 15000);
  if (res.status === "success") {
    if (res.output_stl_path) lastGeneratedStlPath = res.output_stl_path;
    if (isSpatialDeskOpen()) {
      invokeDeskHudMethod("updateCadAssemblyModel", res);
    }
  }
  return res;
}

/**
 * Tool 9: `desk_modify_cad_dimensions` — Chỉnh sửa kích thước thủ công (Interactive Resizing / Parametric Push-Pull)
 * hoặc bật/tắt chế độ tách rời chi tiết lắp ráp (Exploded Assembly View) ngay trên mặt bàn.
 */
export async function deskModifyCadDimensionsTool(args = {}) {
  if (!isSpatialDeskOpen()) openSpatialDesk();

  const cliArgs = [];
  if (args?.file && typeof args.file === "string") {
    cliArgs.push("--file", args.file);
  }
  if (typeof args?.length_mm === "number" && args.length_mm > 0) {
    cliArgs.push("--length", String(args.length_mm));
  }
  if (typeof args?.width_mm === "number" && args.width_mm > 0) {
    cliArgs.push("--width", String(args.width_mm));
  }
  if (typeof args?.height_mm === "number" && args.height_mm > 0) {
    cliArgs.push("--height", String(args.height_mm));
  }
  if (args?.explode === true) {
    cliArgs.push("--explode");
  }
  if (typeof args?.explode_distance === "number" && args.explode_distance > 0) {
    cliArgs.push("--explode-distance", String(args.explode_distance));
  }
  if (args?.output && typeof args.output === "string") {
    cliArgs.push("--output", args.output);
  }

  const res = await runSpatialDeskPython("desk_cad_parser.py", cliArgs, 15000);
  if (res.status === "success") {
    if (res.output_stl_path) lastGeneratedStlPath = res.output_stl_path;
    if (isSpatialDeskOpen()) {
      invokeDeskHudMethod("updateCadAssemblyModel", res);
    }
  }
  return res;
}

/**
 * Bật/tắt nhanh chế độ tách rời chi tiết lắp ráp (Exploded Assembly View).
 */
export async function deskToggleExplodeTool(args = {}) {
  const explode = typeof args?.explode === "boolean" ? args.explode : true;
  return deskModifyCadDimensionsTool({
    file: args?.file || "",
    explode,
    explode_distance: typeof args?.explode_distance === "number" ? args.explode_distance : 38.0,
  });
}
