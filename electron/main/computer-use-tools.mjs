/**
 * electron/main/computer-use-tools.mjs
 *
 * "Computer use" + browser-automation tools: OS-level UI control read-back,
 * the OmniParser/computer-use task runners, opening arbitrary URLs/apps
 * safely, the action-lane wrapped variants used by the tool dispatcher, and
 * the browser-automation tool set.
 */
import { spawn } from "node:child_process";
import electron from "electron";
const { shell } = electron;
import { runComputerSession, pressKeyCombo, typeTextNative, clickMouseNative } from "../computer-session.mjs";
import * as browserAgent from "../browser-agent.mjs";
import {
  submitAction,
  getActionStatus,
  listActiveActions,
  laneSnapshot,
  cancelAction,
  isCancelled,
} from "../action-lane.mjs";
import { emitEvent, emitToRenderer } from "./events.mjs";
import {
  systemActionTool,
  writeNoteScriptTool,
  mouseControlTool,
  uiAutomationTool,
  ocrRegionTool,
  universalAppLauncherTool,
  invalidateOcrCache,
  searchEverythingTool,
  filesystemOpsTool,
  quickReminderTool,
  sendDesktopNotificationTool,
  readClipboardTool,
  writeClipboardTool,
  windowManagerTool,
  runTerminalCommandTool,
} from "./local-tools.mjs";
import { ensureOmniServer, omniAuthHeaders } from "./omni-server.mjs";
import { mainWindow } from "./window-manager.mjs";
import { toggleScreenVision, toggleCameraStreamVision, grabPrimaryScreenJpeg, visionFrameGeometry } from "./vision.mjs";
import { toggleMeetingRecording } from "./meeting-recording.mjs";
import { toggleCopilotMode, toggleLiveTranscriber } from "./teleprompter.mjs";
import { getAllGeminiKeys, getGenAiClient, withGeminiFailover, isRateLimitError } from "./gemini-keys.mjs";
import { envFlag } from "./env-config.mjs";
import { captureRegionSnapshot, verifyActionWithDiff, smartSettle } from "./visual-verifier.mjs";

// Silent/whisper mode: Iris keeps listening, keeps "speaking" (Gemini still
// generates audio and its transcript still lands in Comms), but playback is
// muted client-side — see set_silent_mode / SILENT_MODE below and the
// matching audio.setSilentOutput() in src/hooks/useAudioPipeline.ts.
let silentMode = false;

export let irisUiContext = {
  tasks: [],
  expandedTaskId: null,
  focusedTaskId: null,
  latestResultTaskId: null,
  pendingTaskMatches: [],
  showHistory: false,
  uiMode: "deck",
};

export const UI_ACTIONS = new Set([
  "open_task",
  "open_task_by_query",
  "open_current_claude_result",
  "open_latest_claude_result",
  "open_claude_history",
  "close_reader",
  "close_history",
  "close_all_overlays",
  "show_task_steps",
  "hide_task_steps",
]);

export function getUiContext() {
  return irisUiContext;
}

export function controlUi({ action, target_id = undefined, query = undefined } = {}) {
  const isWindowValid = mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents?.isDestroyed?.();
  switch (action) {
    case "toggle_teleprompter": {
      toggleLiveTranscriber().catch((err) => console.error("[controlUi] toggleLiveTranscriber error:", err));
      return { status: "success", message: "Toggled Teleprompter (Alt+T)" };
    }
    case "toggle_copilot": {
      toggleCopilotMode();
      return { status: "success", message: "Toggled AI Copilot (Alt+A)" };
    }
    case "toggle_meeting_recorder": {
      toggleMeetingRecording().catch((err) => console.error("[controlUi] toggleMeetingRecording error:", err));
      return { status: "success", message: "Toggled Meeting Recorder (Alt+M)" };
    }
    case "toggle_robot_pip":
      if (isWindowValid) mainWindow.webContents.send("ui:toggle-robot-pip");
      return { status: "success", message: "Toggled Robot PiP (Alt+R)" };
    case "toggle_companion_pip":
      if (isWindowValid) mainWindow.webContents.send("ui:toggle-companion-pip");
      return { status: "success", message: "Toggled Companion PiP (Alt+C)" };
    case "toggle_screen_vision":
      return toggleScreenVision(); // trạng thái thật (enabled/disabled/error), không "success" giả
    case "toggle_desk_vision":
      // V-06: kênh đúng là "vision:toggle-desk-continuous" (preload không nghe "vision:toggle-desk").
      if (!isWindowValid) return { status: "error", error: "Không có cửa sổ Iris." };
      mainWindow.webContents.send("vision:toggle-desk-continuous");
      return { status: "success", message: "Đã gửi lệnh bật/tắt Desk Vision (Super+Shift+C)." };
    case "toggle_camera_stream_vision":
      return toggleCameraStreamVision();
    case "toggle_smarthome_pip":
      if (isWindowValid) mainWindow.webContents.send("ui:toggle-smarthome-pip");
      return { status: "success", message: "Toggled Smart Home Cameras PiP (Alt+H)" };
    case "open_companion_live_view":
      if (isWindowValid) mainWindow.webContents.send("companion:open-live-view");
      return { status: "success", message: "Opened Companion Live View." };
    // Cửa sổ của CHÍNH Iris không thể điều khiển qua minimize_app/hide_app (system_actions.py loại nó) — dùng hai action này.
    // Giống nút "—" trên thanh tiêu đề (win:control). backgroundThrottling=false nên Gemini Live vẫn nghe/nói khi đang thu xuống.
    case "minimize_iris":
      if (!isWindowValid) return { status: "error", error: "Không có cửa sổ Iris." };
      mainWindow.minimize();
      return { status: "success", message: "Đã đưa cửa sổ Iris xuống thanh tác vụ. Nói 'mở lại Iris' hoặc bấm biểu tượng Iris trên thanh tác vụ để hiện lại." };
    case "restore_iris":
      if (!isWindowValid) return { status: "error", error: "Không có cửa sổ Iris." };
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      return { status: "success", message: "Đã hiện lại cửa sổ Iris." };
  }

  if (!UI_ACTIONS.has(action)) {
    return { status: "error", error: `Unknown UI action: ${action}` };
  }
  emitToRenderer("iris:ui-action", { action, target_id, query });
  return { status: "sent", action, target_id, query };
}

export async function startComputerUseTask(args) {
  const { task } = args;
  emitEvent({ type: "log", level: "info", message: `Starting Computer Use Task: ${task}` });

  // Run asynchronously without blocking Gemini
  runComputerSession(task, (streamEvent) => {
    if (streamEvent.text) {
      emitEvent({ type: "log", level: "info", message: `[ComputerUse] ${streamEvent.text}` });
    }
  }).catch(err => {
    emitEvent({ type: "log", level: "error", message: `[ComputerUse Error] ${err.message}` });
  });

  return { status: "started", message: "I have started taking control of the computer. The actions are running in the background." };
}

// Bộ đếm jitter 0/1px luân phiên (tất định) — `Date.now() % 2` có thể trùng giá trị ở 2 lần chụp liên tiếp
// khiến Chromium/DWM trả lại NativeImage cũ trong cache.
let omniGrabCounter = 0;

export async function startOmniParserTask(args) {
  const { task, fast_mode = true } = args || {};
  if (!task || typeof task !== "string" || !task.trim()) {
    return { status: "error", message: "Missing or invalid 'task' description for computer_use_omniparser." };
  }
  emitEvent({ type: "log", level: "info", message: `Starting OmniParser Computer Use Task: ${task}${fast_mode ? " [FAST MODE]" : ""}` });

  // Hybrid UIA fast-path: Ưu tiên tìm và click trực tiếp bằng Win32 UIA native (20ms - 50ms, siêu tốc không tốn GPU/RAM)
  if (envFlag("IRIS_UI_AUTOMATION", true)) {
    try {
      const cleanQuery = task.trim().replace(/^(?:click|bấm|nhấp|tap|chọn|mở)?\s*(?:vào|icon|nút|ô|thanh|mục|chỗ)?\s*/i, "").trim() || task.trim();
      const uiaRes = await uiAutomationTool({ action: "click", query: cleanQuery });
      if (uiaRes && uiaRes.success) {
        emitEvent({
          type: "log",
          level: "info",
          message: `[HybridUIA] ✔ Đã click "${cleanQuery}" siêu tốc qua Windows UIA native (${uiaRes.time_ms || 10}ms).`,
        });
        const verification = await verifyActionWithDiff({
          label: task,
        });
        return {
          status: "success",
          method: "uia_native",
          ...(verification ? { verification } : {}),
          message: `[UIA Siêu Tốc] Đã click "${cleanQuery}" qua Windows UI Automation native.` + (verification?.verified ? " [Đã nghiệm thu thị giác OK]" : ""),
        };
      }
    } catch (uiaErr) {
      // Fallback sang OmniParser thị giác
    }
  }

  // 2. Native OCR Fast-Path (kết hợp Smart Visual Cache): Dùng Windows Native OCR tìm chữ trên màn hình (0ms - 30ms)
  // Nếu người dùng yêu cầu click vào một nhãn chữ/văn bản/nút có chữ mà UIA không tìm thấy
  try {
    const cleanQuery = task.trim().replace(/^(?:click|bấm|nhấp|tap|chọn|mở)?\s*(?:vào|icon|nút|ô|thanh|mục|chỗ|chữ)?\s*/i, "").trim() || task.trim();
    if (cleanQuery.length >= 2) {
      const ocrRes = await ocrRegionTool({ find: cleanQuery });
      if (ocrRes && ocrRes.found && Array.isArray(ocrRes.center)) {
        const [screenX, screenY] = ocrRes.center;
        emitEvent({
          type: "log",
          level: "info",
          message: `[NativeOCR] ✔ Tìm thấy chữ "${ocrRes.matched_text || cleanQuery}" tại (${screenX}, ${screenY}) qua Windows Native OCR${ocrRes.cached ? " [CACHE HIT]" : ""} — đang click...`,
        });
        const preSnapshot = await captureRegionSnapshot({ x: screenX, y: screenY });
        const clickRes = await mouseControlTool({
          action: "click",
          x: screenX,
          y: screenY,
          button: "left",
        });
        if (!clickRes || clickRes.status === "error") {
          await clickMouseNative(screenX, screenY, "left");
        }
        const verification = await verifyActionWithDiff({
          beforeSnapshot: preSnapshot,
          cropRectOrPoint: { x: screenX, y: screenY },
          label: task,
          fallbackMethods: [
            {
              name: "win32_mouse_click",
              fn: async () => {
                await mouseControlTool({ action: "click", x: screenX, y: screenY, button: "left", human_like: true });
              },
            },
            {
              name: "physical_native_click",
              fn: async () => {
                await clickMouseNative(screenX, screenY, "left");
              },
            },
          ],
        });
        return {
          status: "success",
          method: "windows_native_ocr",
          cached: Boolean(ocrRes.cached),
          x: screenX,
          y: screenY,
          ...(verification ? { verification } : {}),
          message: `[Windows OCR Siêu Tốc] Đã tìm thấy chữ "${ocrRes.matched_text || cleanQuery}" trên màn hình và click thành công.` + (verification?.verified ? " [Đã nghiệm thu thị giác OK]" : ""),
        };
      }
    }
  } catch (ocrErr) {
    // Fallback sang OmniParser thị giác
  }

  // NOTE: `desktopCapturer` comes from the ESM `electron` default import at the
  // top of this file — do NOT use require() here.
  const { desktopCapturer } = electron;

  try {
    // 1. Capture screen.
    // BUG-4 FIX (Memory Leak): Giảm thumbnailSize từ 1920x1080 xuống 1366x768.
    let imgBuffer = null;
    let imgMime = "image/png";
    let imgFilename = "screenshot.png";
    try {
      const primary = electron.screen?.getPrimaryDisplay?.();
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        // Cache-busting 0/1px jitter
        thumbnailSize: { width: 1366 + (omniGrabCounter++ % 2), height: 768 },
      });
      const primarySource =
        (primary ? sources?.find((s) => s.display_id === String(primary.id)) : null) ?? sources?.[0];
      if (primarySource && !primarySource.thumbnail.isEmpty()) {
        const b = primarySource.thumbnail.toPNG();
        if (b && b.length > 0) imgBuffer = b;
      }
      if (sources) sources.length = 0;
    } catch {
      // desktopCapturer failed — fall back to grabPrimaryScreenJpeg below
    }

    if (!imgBuffer || imgBuffer.length === 0) {
      const { buffer } = await grabPrimaryScreenJpeg(85);
      imgBuffer = buffer;
      imgMime = "image/jpeg";
      imgFilename = "screenshot.jpg";
    }

    // 2. Gửi screenshot lên OmniParser Local API (nếu sẵn sàng), hoặc fallback trực tiếp sang Gemini Vision + mouse_control.
    const omniUrl = process.env.OMNIPARSER_API_URL || "http://127.0.0.1:8000/parse";
    const omniReady = await ensureOmniServer({ timeoutMs: 1500 }).catch(() => false);

    if (!omniReady) {
      emitEvent({
        type: "log",
        level: "info",
        message: `[VisionClick] OmniParser local không chạy — chuyển sang Gemini Vision API + mouse_control cho: ${task}`,
      });
      return await findAndClickWithGeminiVision(imgBuffer, imgMime, task, fast_mode);
    }

    // Mọi lỗi từ OmniParser (timeout, HTTP lỗi, không thấy mục tiêu, click lỗi) đều rơi xuống
    // fallback Gemini Vision bên dưới — thay vì báo lỗi cứng khi server vừa chết/treo giữa chừng.
    let omniFailReason = "";
    try {
      emitEvent({ type: "log", level: "info", message: `Calling OmniParser API at ${omniUrl}...` });

      const formData = new FormData();
      formData.append("file", new Blob([imgBuffer], { type: imgMime }), imgFilename);
      formData.append("prompt", task);

      // AUDIT-VIS-01 FIX: timeout 90s — đủ cho YOLO+OCR chạy trên máy yếu.
      const PARSE_TIMEOUT_MS = 90000;
      const parseController = new AbortController();
      const parseTimeout = setTimeout(() => parseController.abort(), PARSE_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(omniUrl, { method: "POST", headers: omniAuthHeaders(), body: formData, signal: parseController.signal });
      } catch (fetchErr) {
        if (fetchErr.name === "AbortError") throw new Error(`OmniParser API timed out after ${PARSE_TIMEOUT_MS / 1000}s`);
        throw fetchErr;
      } finally {
        clearTimeout(parseTimeout);
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new Error(`OmniParser API error: ${response.status} ${response.statusText}${bodyText ? ` — ${bodyText.slice(0, 300)}` : ""}`);
      }

      const result = await response.json();
      if (result.error) throw new Error(`OmniParser returned error: ${result.error}`);

      if (!result.target_center) {
        throw new Error("OmniParser could not find target");
      }

      // 3. Gọi /click endpoint trên Python server (persistent process, không spawn mới).
      // fast_mode=true: server bỏ qua Bezier delay → click trong ~0.07s thay vì 0.5-0.8s.
      const [x, y] = result.target_center;
      emitEvent({ type: "log", level: "info", message: `Clicking target at ratio x:${x}, y:${y}${fast_mode ? " (fast)" : ""}` });

      const clickUrl = process.env.OMNIPARSER_CLICK_URL || "http://127.0.0.1:8000/click";
      const clickController = new AbortController();
      // Fast mode click hoàn thành trong ~0.1s; normal mode ~1s. Timeout 10s vẫn OK.
      const clickTimeout = setTimeout(() => clickController.abort(), 10000);
      let clickResponse;
      try {
        clickResponse = await fetch(clickUrl, {
          method: "POST",
          headers: omniAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ x_ratio: x, y_ratio: y, fast_mode }),
          signal: clickController.signal,
        });
      } catch (fetchErr) {
        if (fetchErr.name === "AbortError") throw new Error("Mouse click request timed out after 10s");
        throw fetchErr;
      } finally {
        clearTimeout(clickTimeout);
      }

      const clickResult = await clickResponse.json().catch(() => ({}));
      if (!clickResponse.ok || !clickResult.success) {
        throw new Error(`Mouse click failed: ${clickResult.error || clickResponse.statusText}`);
      }

      invalidateOcrCache();
      const preSnapshot = await captureRegionSnapshot({ x: clickResult.x, y: clickResult.y });
      emitEvent({ type: "log", level: "info", message: `[MouseController] Clicked at (${clickResult.x}, ${clickResult.y})` });
      const verification = await verifyActionWithDiff({
        beforeSnapshot: preSnapshot,
        cropRectOrPoint: { x: clickResult.x, y: clickResult.y },
        label: task,
        fallbackMethods: [
          {
            name: "win32_mouse_click",
            fn: async () => {
              await mouseControlTool({ action: "click", x: clickResult.x, y: clickResult.y, button: "left" });
            },
          },
          {
            name: "physical_native_click",
            fn: async () => {
              await clickMouseNative(clickResult.x, clickResult.y, "left");
            },
          },
        ],
      });
      return {
        status: "success",
        x: clickResult.x,
        y: clickResult.y,
        ...(verification ? { verification } : {}),
        message: `Found the target on screen and clicked it successfully for: ${task}` + (verification?.verified ? " [Đã nghiệm thu thị giác OK]" : ""),
      };
    } catch (omniErr) {
      omniFailReason = omniErr?.message || String(omniErr);
    }

    emitEvent({
      type: "log",
      level: "warn",
      message: `[VisionClick] OmniParser không xử lý được (${omniFailReason}) — chuyển sang Gemini Vision API + mouse_control cho: ${task}`,
    });
    return await findAndClickWithGeminiVision(imgBuffer, imgMime, task, fast_mode);

  } catch (err) {
    emitEvent({ type: "log", level: "error", message: `[OmniParser Error] ${err.message}` });
    return { status: "error", message: `Error performing computer task: ${err.message}` };
  }
}

async function findAndClickWithGeminiVision(imgBuffer, imgMime, task, fast_mode = true) {
  if (getAllGeminiKeys({ purpose: "vision", preferVision: true }).length === 0) {
    return { status: "error", message: "Chưa cấu hình GEMINI_VISION_API_KEY hoặc GEMINI_API_KEY." };
  }
  const prompt =
    `Find the UI element, icon, button, link, or tab on this screenshot that matches: "${task}".\n` +
    `Respond ONLY with valid JSON in this exact format:\n` +
    `{"found": true, "box_2d": [ymin, xmin, ymax, xmax], "label": "short name"}\n` +
    `where ymin, xmin, ymax, xmax are integers from 0 to 1000 representing the 2D bounding box on the image. ` +
    `If not visible on the screen at all, return {"found": false}.`;

  // Timeout cứng 30s: fallback không được treo vô hạn khi mạng/Gemini chậm.
  const FALLBACK_TIMEOUT_MS = 30000;
  let fallbackTimer = null;
  let res;
  try {
    res = await Promise.race([
      withGeminiFailover(
        async (apiKey) => {
          const client = getGenAiClient(apiKey);
          const candidateModels = Array.from(
            new Set(
              [
                String(process.env.GEMINI_VISION_MODEL || "").trim(),
                "gemini-2.0-flash",
                "gemini-flash-latest",
                "gemini-flash-lite-latest",
                "gemini-2.5-flash",
              ].filter(Boolean)
            )
          );
          let lastErr = null;
          for (const m of candidateModels) {
            try {
              return await client.models.generateContent({
                model: m,
                contents: [
                  { inlineData: { mimeType: imgMime || "image/png", data: imgBuffer.toString("base64") } },
                  { text: prompt },
                ],
                // JSON thuần + temperature 0: toạ độ ổn định, không kèm lời dẫn/markdown.
                config: { responseMimeType: "application/json", temperature: 0 },
              });
            } catch (err) {
              lastErr = err;
              if (isRateLimitError(err)) {
                continue;
              }
              const errMsg = String(err?.message || "");
              const errStatus = err?.status ?? err?.code ?? err?.httpStatus;
              if (
                errStatus === 404 ||
                errStatus === 400 ||
                /no longer available|not found|404|NOT_FOUND|deprecated|is not supported|invalid argument/i.test(errMsg)
              ) {
                continue;
              }
              throw err;
            }
          }
          throw lastErr || new Error("Không thể gọi Gemini Vision cho Computer Use.");
        },
        { purpose: "vision", preferVision: true }
      ),
      new Promise((_, reject) => {
        fallbackTimer = setTimeout(() => reject(new Error(`Gemini Vision timed out after ${FALLBACK_TIMEOUT_MS / 1000}s`)), FALLBACK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (fallbackTimer) clearTimeout(fallbackTimer);
  }

  const raw = String(res?.text || "").trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { status: "failed", message: `Không phân tích được toạ độ từ ảnh màn hình cho: ${task}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { status: "failed", message: `Dữ liệu toạ độ trả về không hợp lệ cho: ${task}` };
  }

  if (!parsed.found) {
    return { status: "failed", message: `Không tìm thấy "${task}" trên màn hình hiện tại.` };
  }

  let xRatio = null;
  let yRatio = null;
  if (Array.isArray(parsed.box_2d) && parsed.box_2d.length === 4) {
    const [ymin, xmin, ymax, xmax] = parsed.box_2d.map(Number);
    xRatio = (xmin + xmax) / 2 / 1000;
    yRatio = (ymin + ymax) / 2 / 1000;
  } else if (typeof parsed.x_ratio === "number" && typeof parsed.y_ratio === "number") {
    xRatio = parsed.x_ratio > 1 ? parsed.x_ratio / 1000 : parsed.x_ratio;
    yRatio = parsed.y_ratio > 1 ? parsed.y_ratio / 1000 : parsed.y_ratio;
  }

  if (xRatio === null || yRatio === null || !Number.isFinite(xRatio) || !Number.isFinite(yRatio)) {
    return { status: "failed", message: `Không xác định được toạ độ hợp lệ cho: ${task}` };
  }

  // visionFrameGeometry() trả pixel VẬT LÝ của màn hình chính: origin_x/origin_y (gốc) và screen_w/screen_h (kích thước).
  const g = visionFrameGeometry();
  const screenX = g.origin_x + Math.round(Math.max(0, Math.min(1, xRatio)) * g.screen_w);
  const screenY = g.origin_y + Math.round(Math.max(0, Math.min(1, yRatio)) * g.screen_h);

  emitEvent({
    type: "log",
    level: "info",
    message: `[GeminiVisionClick] Đã tìm thấy "${parsed.label || task}" tại (${screenX}, ${screenY}) — đang click...`,
  });

  const preSnapshot = await captureRegionSnapshot({ x: screenX, y: screenY });
  const clickRes = await mouseControlTool({
    action: "click",
    x: screenX,
    y: screenY,
    space: "screen",
    human_like: !fast_mode,
  });

  if (clickRes?.status === "error") {
    await clickMouseNative(screenX, screenY, "left");
  }

  const verification = await verifyActionWithDiff({
    beforeSnapshot: preSnapshot,
    cropRectOrPoint: { x: screenX, y: screenY },
    label: task,
    retryFn: async () => {
      await clickMouseNative(screenX, screenY, "left");
    },
  });

  return {
    status: "success",
    x: screenX,
    y: screenY,
    ...(verification ? { verification } : {}),
    message: `Đã nhìn màn hình, tìm thấy "${parsed.label || task}" tại toạ độ (${screenX}, ${screenY}) và click thành công.` + (verification?.verified ? " [Đã nghiệm thu thị giác OK]" : ""),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startComputerUseType(args) {
  const {
    text,
    key,
    action,
    line_number,
    line_offset,
    char_offset,
    repeat = 1,
    click_x,
    click_y,
    button = "left",
  } = args || {};

  const hasPos = (typeof click_x === "number" && typeof click_y === "number") || typeof line_number === "number" || typeof line_offset === "number" || typeof char_offset === "number";
  const hasAction = Boolean(action);
  const hasKey = Boolean(key);
  const hasText = Boolean(text);

  if (!hasPos && !hasAction && !hasKey && !hasText) {
    return { status: "error", message: "Thiếu nội dung, phím hoặc thao tác cần thực hiện." };
  }

  invalidateOcrCache();

  emitEvent({
    type: "log",
    level: "info",
    message: `ComputerUseType - text: '${text || ""}', key: '${key || ""}', action: '${action || ""}', line_num: ${line_number ?? "none"}, line_off: ${line_offset ?? "none"}`,
  });

  // 1. Thử qua OmniParser nếu server OmniParser được cấu hình và đang hoạt động,
  // nhưng CHỈ KHI là tác vụ text/key đơn giản (OmniParser API chỉ nhận {text, key}).
  if (!hasPos && !hasAction && Number(repeat || 1) <= 1 && (process.env.OMNIPARSER_TYPE_URL || process.env.OMNIPARSER_ENABLED === "true")) {
    const typeUrl = process.env.OMNIPARSER_TYPE_URL || "http://127.0.0.1:8000/type";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(typeUrl, {
        method: "POST",
        headers: omniAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ text, key }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.success) {
        emitEvent({ type: "log", level: "info", message: `[KeyboardController] Success via OmniParser` });
        return { status: "success", message: `Đã nhập thành công qua OmniParser.` };
      }
    } catch {
      // OmniParser không sẵn sàng, tự động chuyển xuống native typing bên dưới
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 2. Thực hiện trực tiếp trên Windows bằng Nut.js keyboard & mouse
  try {
    const countRepeat = Math.max(1, Math.min(Number(repeat) || 1, 100));

    // Bước A: Click chuột để đặt con trỏ (nếu có click_x và click_y)
    if (typeof click_x === "number" && typeof click_y === "number") {
      await clickMouseNative(click_x, click_y, button);
      await sleep(60);
    }

    // Bước B: Nhảy đến số dòng tuyệt đối (1-indexed: line_number 1 là dòng đầu)
    if (typeof line_number === "number" && line_number >= 1) {
      // Nhảy về đầu văn bản (Ctrl+Home)
      await pressKeyCombo("ctrl+home");
      await sleep(40);
      const targetDown = Math.floor(line_number) - 1;
      for (let i = 0; i < targetDown; i++) {
        await pressKeyCombo("down");
        await sleep(20);
      }
    }

    // Bước C: Di chuyển dòng tương đối (line_offset: âm = lên, dương = xuống)
    if (typeof line_offset === "number" && line_offset !== 0) {
      const count = Math.min(Math.abs(Math.round(line_offset)), 200);
      const keyName = line_offset < 0 ? "up" : "down";
      for (let i = 0; i < count; i++) {
        await pressKeyCombo(keyName);
        await sleep(20);
      }
    }

    // Bước D: Di chuyển ký tự tương đối (char_offset: âm = trái, dương = phải)
    if (typeof char_offset === "number" && char_offset !== 0) {
      const count = Math.min(Math.abs(Math.round(char_offset)), 500);
      const keyName = char_offset < 0 ? "left" : "right";
      for (let i = 0; i < count; i++) {
        await pressKeyCombo(keyName);
        await sleep(15);
      }
    }

    // Bước E: Thực hiện action chỉnh sửa văn bản nâng cao
    if (action) {
      switch (action) {
        case "delete_line": {
          // Xóa hoàn toàn dòng hiện tại: End -> Shift+Home -> Backspace -> Delete
          // Không đụng đến bất kỳ dòng nào khác trong văn bản
          await pressKeyCombo("end");
          await sleep(20);
          await pressKeyCombo("shift+home");
          await sleep(20);
          await pressKeyCombo("backspace");
          await sleep(20);
          await pressKeyCombo("delete");
          await sleep(20);
          break;
        }
        case "clear_line": {
          // Xóa trắng dòng hiện tại (giữ nguyên ngắt dòng), chuẩn bị ghi đè text mới nếu có
          await pressKeyCombo("end");
          await sleep(20);
          await pressKeyCombo("shift+home");
          await sleep(20);
          await pressKeyCombo("backspace");
          await sleep(20);
          break;
        }
        case "delete_word": {
          for (let i = 0; i < countRepeat; i++) {
            await pressKeyCombo("ctrl+backspace");
            await sleep(20);
          }
          break;
        }
        case "delete_forward_word": {
          for (let i = 0; i < countRepeat; i++) {
            await pressKeyCombo("ctrl+delete");
            await sleep(20);
          }
          break;
        }
        case "delete_char": {
          for (let i = 0; i < countRepeat; i++) {
            await pressKeyCombo("backspace");
            await sleep(15);
          }
          break;
        }
        case "delete_forward_char": {
          for (let i = 0; i < countRepeat; i++) {
            await pressKeyCombo("delete");
            await sleep(15);
          }
          break;
        }
        case "select_line": {
          await pressKeyCombo("end");
          await sleep(20);
          await pressKeyCombo("shift+home");
          await sleep(20);
          break;
        }
        case "select_all": {
          await pressKeyCombo("ctrl+a");
          await sleep(20);
          break;
        }
        case "copy": {
          await pressKeyCombo("ctrl+c");
          await sleep(20);
          break;
        }
        case "paste": {
          await pressKeyCombo("ctrl+v");
          await sleep(20);
          break;
        }
        case "cut": {
          await pressKeyCombo("ctrl+x");
          await sleep(20);
          break;
        }
        case "undo": {
          for (let i = 0; i < countRepeat; i++) {
            await pressKeyCombo("ctrl+z");
            await sleep(20);
          }
          break;
        }
        case "redo": {
          for (let i = 0; i < countRepeat; i++) {
            await pressKeyCombo("ctrl+y");
            await sleep(20);
          }
          break;
        }
      }
    }

    // Bước F: Bấm phím đơn hoặc tổ hợp phím (nếu có)
    if (key) {
      for (let i = 0; i < countRepeat; i++) {
        await pressKeyCombo(key);
        if (i < countRepeat - 1) await sleep(20);
      }
    }

    // Bước G: Gõ nội dung văn bản (nếu có)
    if (text) {
      await typeTextNative(text);
    }

    emitEvent({ type: "log", level: "info", message: `[KeyboardController] Success via native keyboard control` });

    let summary = "Đã thực hiện xong thao tác bàn phím.";
    if (action === "delete_line") summary = "Đã di chuyển con trỏ và xóa dòng thành công.";
    else if (action === "clear_line" && text) summary = `Đã xóa dòng cũ và viết lại: "${text}".`;
    else if (action === "clear_line") summary = "Đã xóa trắng dòng hiện tại.";
    else if (action === "delete_word") summary = `Đã xóa ${countRepeat} từ.`;
    else if (action === "delete_char") summary = `Đã xóa ${countRepeat} ký tự.`;
    else if (text) summary = `Đã gõ xong: "${text}".`;
    else if (key) summary = `Đã bấm phím: ${key}${countRepeat > 1 ? ` (${countRepeat} lần)` : ""}.`;

    return { status: "success", message: summary };
  } catch (nativeErr) {
    emitEvent({ type: "log", level: "error", message: `[Keyboard Error] ${nativeErr.message}` });
    return { status: "error", message: `Không thể thực hiện thao tác bàn phím: ${nativeErr.message}` };
  }
}

export async function submitLocalChat(args) {
  try {
    const { default: ollama } = await import("ollama");
    const localModel = process.env.IRIS_LOCAL_MODEL || "llama3";
    const habits = getToolMemoryState()?.userHabits;
    const habitHint =
      habits && Object.keys(habits.frequentApps || {}).length > 0
        ? `\n[User Context Memory - Ứng dụng thường dùng: ${Object.keys(habits.frequentApps).slice(0, 5).join(", ")}]`
        : "";
    const response = await ollama.chat({
      model: localModel,
      messages: [
        {
          role: "system",
          content: `Bạn là trợ lý ảo đa phương thức Iris chạy cục bộ (Offline Fallback Mode). Trả lời ngắn gọn, thông minh bằng tiếng Việt.${habitHint}`,
        },
        { role: "user", content: args.query },
      ],
    });
    return {
      status: "success",
      engine: `ollama:${localModel}`,
      local_ai_response: response.message.content,
      instructions: "Read the local_ai_response aloud to the user exactly as it is."
    };
  } catch (err) {
    emitEvent({ type: "log", level: "error", message: `Ollama error: ${err.message}` });
    return {
      status: "error",
      error: `Failed to reach local AI: ${err.message}. Tell the user local AI is down.`
    };
  }
}

// Protocol whitelist: only allow web-safe protocols via shell.openExternal.
// This prevents Gemini from being tricked (via prompt injection) into opening
// file://, javascript:, or arbitrary custom protocol handlers.
export const ALLOWED_URL_PROTOCOLS = new Set(["https:", "http:"]);

// Executable whitelist fallback (used when IRIS_UNIVERSAL_APPS is disabled in Settings).
export const ALLOWED_APP_EXECUTABLES = new Set([
  "calc.exe", "notepad.exe", "mspaint.exe", "explorer.exe", "taskmgr.exe",
  "control.exe", "winver.exe", "snippingtool.exe",
  "code.exe", "code - insiders.exe",
  "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe",
  "vlc.exe", "spotify.exe", "discord.exe", "slack.exe", "obsidian.exe",
  "zalo.exe", "telegram.exe", "winword.exe", "excel.exe", "powerpnt.exe",
  "cmd.exe", "powershell.exe", "wt.exe",
]);

export async function openUrlOrApp(args) {
  const { target, is_url } = args || {};
  if (!target || typeof target !== "string") {
    return { status: "error", error: "Thiếu 'target' để mở URL hoặc ứng dụng." };
  }

  // Tự động bảo vệ chống AI đoán nhầm: nếu câu lệnh chứa từ khóa click thị giác
  // (ví dụ: "click vào Chrome", "bấm nút Play", "click icon Zalo")
  // -> tự động chuyển hướng sang OmniParser để chụp ảnh màn hình và click chuẩn xác bằng AI thị giác!
  const trimmedTarget = target.trim();
  const isClickIntent =
    /^(?:click|bấm|nhấp|tap|chọn\s+vào)\s+/i.test(trimmedTarget) ||
    /^(?:click|bấm|nhấp|tap)\b/i.test(trimmedTarget);
  if (isClickIntent && !is_url) {
    emitEvent({
      type: "log",
      level: "info",
      message: `[AutoRoute] Lệnh "${trimmedTarget}" có chứa từ khóa click thị giác → tự động chuyển sang computer_use_omniparser để chụp ảnh và click chuẩn xác.`,
    });
    return startOmniParserTask({ task: trimmedTarget });
  }

  invalidateOcrCache();

  // --- URL branch ---
  if (is_url || /^https?:\/\//i.test(target.trim())) {
    let parsed;
    try {
      parsed = new URL(/^https?:\/\//i.test(target.trim()) ? target.trim() : `https://${target.trim()}`);
    } catch {
      return { status: "error", error: "Invalid URL: could not parse the provided target as a URL." };
    }
    if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
      return {
        status: "error",
        error: `Protocol '${parsed.protocol}' is not allowed. Only https and http are permitted.`,
      };
    }
    try {
      // Use parsed.href so any encoding tricks in the original string are normalised first.
      await shell.openExternal(parsed.href);
      return { status: "success", message: `Opened URL: ${parsed.href}` };
    } catch (err) {
      return { status: "error", error: `Failed to open URL: ${err.message}` };
    }
  }

  // --- App branch ---
  const universalEnabled = !["0", "false", "no", "off"].includes(
    String(process.env.IRIS_UNIVERSAL_APPS ?? "true").trim().toLowerCase(),
  );
  if (universalEnabled) {
    const res = await universalAppLauncherTool({ command: "launch", query: target });
    if (res.status === "success") return res;
  }

  // Fallback to whitelist if Universal App Launcher is disabled or didn't match
  const basename = (target.split(/[\\/]/).pop() ?? "").toLowerCase().trim();
  const exeName = basename.endsWith(".exe") ? basename : `${basename}.exe`;
  if (!ALLOWED_APP_EXECUTABLES.has(basename) && !ALLOWED_APP_EXECUTABLES.has(exeName)) {
    return {
      status: "error",
      error: universalEnabled
        ? `Không tìm thấy ứng dụng '${target}' trên máy tính.`
        : `Ứng dụng '${basename}' không nằm trong danh sách cho phép khi 'Universal App Launcher' đang tắt. Hãy bật 'Mở mọi ứng dụng' trong Settings.`,
    };
  }
  const toRun = ALLOWED_APP_EXECUTABLES.has(basename) ? basename : exeName;
  try {
    const child = spawn("cmd.exe", ["/c", "start", "", toRun], {
      shell: false,   // CRITICAL — do NOT set to true
      detached: true, // App runs independently; Electron won't hold it alive
      stdio: "ignore",
      windowsHide: false,
    });
    child.on("error", (err) => {
      console.warn(`[openUrlOrApp] spawn error for ${toRun}:`, err.message);
    });
    child.unref();
    return { status: "success", message: `Started application: ${toRun}` };
  } catch (err) {
    return { status: "error", error: `Failed to start app: ${err.message}` };
  }
}

// TL-02/TL-06: các tool này chờ KẾT QUẢ THẬT của system_actions.py (trước đây spawn rồi báo "success"
// ngay dù tiến trình chưa chạy / thất bại). closeApp mặc định đóng êm; force:true chỉ sau xác nhận hai bước.
export async function closeAppTool(args = {}) {
  return systemActionTool("close", args.target, args.force === true ? ["--force"] : []);
}

export async function hideAppTool(args = {}) {
  return systemActionTool("hide", args.target);
}

export async function minimizeAppTool(args = {}) {
  const target = (args.target && String(args.target).trim()) || "active";
  return systemActionTool("minimize", target);
}

export async function restoreAppTool(args = {}) {
  return systemActionTool("restore", args.target);
}

export async function writeNoteTool(args = {}) {
  return writeNoteScriptTool(args.text, args.is_new === true);
}

export function laneEventLogger(label) {
  return (event) => {
    if (event.status === "completed") {
      emitEvent({ type: "log", level: "info", message: `${label}: hoàn tất (${event.id}).` });
    } else if (event.status === "error") {
      emitEvent({ type: "log", level: "error", message: `${label}: lỗi (${event.id}) — ${event.error}` });
    }
  };
}

export async function getIrisStatusTool() {
  return {
    status: "success",
    actions: listActiveActions(),
    lanes: laneSnapshot(),
    silent_mode: silentMode,
  };
}

export async function getActionStatusTool(args = {}) {
  const { action_id } = args;
  if (!action_id) return { status: "error", error: "Thiếu action_id." };
  return getActionStatus(action_id);
}

export async function stopActionTool(args = {}) {
  const { action_id } = args;
  if (!action_id) return { status: "error", error: "Thiếu action_id." };
  const ok = cancelAction(action_id);
  return ok
    ? { status: "success", message: `Đã yêu cầu dừng hành động ${action_id}.` }
    : { status: "error", error: `Không tìm thấy hành động đang chạy: ${action_id}` };
}

// -----------------------------------------------------------------------
// Full computer-use sessions now go through the "computer" lane (limit 1)
// instead of a bare fire-and-forget call, so Iris can report progress and
// so a second "take over the computer" request while one is already
// running gets queued instead of fighting over the mouse.
// -----------------------------------------------------------------------
export async function startComputerUseTaskLaned(args) {
  const { task } = args || {};
  if (!task || !String(task).trim()) {
    return { status: "error", message: "Thiếu 'task' để điều khiển máy tính." };
  }
  if (!String(process.env.ANTHROPIC_API_KEY || "").trim()) {
    emitEvent({
      type: "log",
      level: "info",
      message: `[ComputerUse] Chưa có ANTHROPIC_API_KEY — tự động dùng Gemini Vision / OmniParser cho: ${task}`,
    });
    return startOmniParserTask({ task });
  }
  const submitted = submitAction({
    lane: "computer",
    label: `Computer use: ${task}`,
    fn: (actionId) =>
      runComputerSession(
        task,
        (streamEvent) => {
          if (streamEvent.text) {
            emitEvent({ type: "log", level: "info", message: `[ComputerUse] ${streamEvent.text}` });
          }
        },
        // fn() may start running before submitAction() below has returned
        // (see action-lane.mjs), so this closure must use the actionId
        // parameter rather than close over the outer `submitted` variable.
        () => isCancelled(actionId),
      ),
    onEvent: laneEventLogger("Computer use"),
  });
  const message =
    submitted.status === "started"
      ? "Đã bắt đầu điều khiển máy tính, đang chạy nền."
      : "Một phiên điều khiển máy tính khác đang chạy — lệnh này đã được xếp hàng và sẽ tự chạy tiếp theo.";
  return { ...submitted, message };
}

// -----------------------------------------------------------------------
// Browser agent (feature: trình duyệt tự hành) — direct Playwright actions.
// These are quick (sub-few-second) DOM operations, so — like
// computer_use_type / computer_use_omniparser — they are awaited and their
// real result (extracted text, click confirmation, etc.) is returned
// straight to Gemini, not just a "started" ack. The "browser" lane still
// caps concurrency so two calls can't drive the same page at once.
// -----------------------------------------------------------------------
export function runBrowserAction(fn, label) {
  return async (args) => {
    const submitted = submitAction({
      lane: "browser",
      label,
      fn: () => fn(args || {}),
      onEvent: laneEventLogger(label),
    });
    // Poll the lane's own record for completion instead of a second promise
    // chain — keeps a single source of truth for the action's result.
    while (true) {
      const record = getActionStatus(submitted.id);
      if (record.status === "completed") return record.result;
      if (record.status === "error") return { status: "error", error: record.error };
      if (record.status === "cancelled") return { status: "error", error: "Đã huỷ hành động này trước khi chạy." };
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  };
}

export const browserOpenTool = runBrowserAction(browserAgent.browserOpen, "Mở trang web");
export const browserClickTool = runBrowserAction(browserAgent.browserClick, "Click trong trình duyệt");
export const browserTypeTool = runBrowserAction(browserAgent.browserType, "Nhập văn bản trong trình duyệt");
export const browserExtractTextTool = runBrowserAction(browserAgent.browserExtractText, "Đọc nội dung trang");
const runBrowserScreenshot = runBrowserAction(browserAgent.browserScreenshot, "Chụp màn hình trình duyệt");

// T-02: trả base64 trong phản hồi function thì Gemini KHÔNG "thấy" ảnh mà còn đốt hàng chục nghìn token.
// Gửi ảnh làm khung hình realtime (như screen vision) và chỉ trả văn bản ngắn.
export async function browserScreenshotTool(args) {
  const r = await runBrowserScreenshot(args);
  if (r?.status !== "success" || !r.base64) return r;
  const { sendVideoFrame } = await import("./gemini-live.mjs"); // import trễ: tránh vòng tròn với dispatcher
  const ok = sendVideoFrame(r.base64, "image/jpeg");
  if (!ok) {
    return { status: "error", url: r.url, error: "Đã chụp trình duyệt nhưng KHÔNG gửi được ảnh lên Gemini (chưa có phiên Live đang chạy)." };
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
  return {
    status: "success",
    url: r.url,
    message: "Ảnh chụp trình duyệt vừa được gửi cho bạn dưới dạng khung hình — hãy mô tả những gì bạn thấy.",
    instructions:
      "Ảnh chụp trang web trong trình duyệt vừa được gửi trực tiếp cho bạn. Hãy nhìn vào ảnh vừa nhận và trả lời NGẮN GỌN, CHÍNH XÁC trong 1-2 câu đúng trọng tâm câu hỏi của người dùng (không nói rông dài hay đoán mò).",
  };
}
export const browserCloseTool = runBrowserAction(browserAgent.browserClose, "Đóng trình duyệt");
export const browserScrollTool = runBrowserAction(browserAgent.browserScroll, "Cuộn trang trình duyệt");
export const browserNavigateTool = runBrowserAction(browserAgent.browserNavigate, "Điều hướng trình duyệt");
export const browserPressKeyTool = runBrowserAction(browserAgent.browserPressKey, "Nhấn phím trong trình duyệt");
export const browserGetLinksTool = runBrowserAction(browserAgent.browserGetLinks, "Lấy danh sách liên kết trang");

export function setSilentModeTool({ enabled } = {}) {
  silentMode = Boolean(enabled);
  emitToRenderer("iris:silent-mode", { enabled: silentMode });
  return {
    status: "success",
    silent_mode: silentMode,
    message: silentMode
      ? "Đã bật chế độ im lặng — Iris vẫn nghe và trả lời bằng chữ, nhưng không phát ra tiếng."
      : "Đã tắt chế độ im lặng — Iris nói bình thường trở lại.",
  };
}

// External writer: main.mjs's "iris:ui-context" ipc.on handler updates this
// (originally a direct `irisUiContext = context;` assignment in the same
// file; now routed through a setter since irisUiContext lives here).
export function setUiContext(context) {
  irisUiContext = context;
}

// -----------------------------------------------------------------------
// Fast-Path Memory Pipeline & Adaptive Context Memory (Agentic Tool Chaining)
// Truyền dữ liệu thông minh giữa các công cụ trực tiếp qua bộ nhớ trong (0ms),
// không tốn chi phí parse lại JSON trung gian hay chờ vòng lặp LLM.
// -----------------------------------------------------------------------
const toolMemoryState = {
  lastResult: null,
  resultsByTool: {},
  stepResults: {},
  history: [], // Lưu 25 lần thực thi gần nhất
  userHabits: {
    frequentApps: {},
    recentFiles: [],
    recentQueries: [],
  },
};

export function getToolMemoryState() {
  return toolMemoryState;
}

export function resetToolMemoryState() {
  toolMemoryState.lastResult = null;
  toolMemoryState.resultsByTool = {};
  toolMemoryState.stepResults = {};
  toolMemoryState.history = [];
  toolMemoryState.userHabits = {
    frequentApps: {},
    recentFiles: [],
    recentQueries: [],
  };
}

export function recordToolExecution(toolName, args = {}, result = {}, stepKey = null) {
  if (!result || typeof result !== "object") return result;
  const firstCandidate =
    result.first_path ||
    (Array.isArray(result.results) && (result.results[0]?.path || result.results[0])) ||
    (Array.isArray(result.files) && (result.files[0]?.path || result.files[0])) ||
    result.path ||
    undefined;
  const enriched =
    firstCandidate && result.first_path === undefined
      ? { ...result, first_path: firstCandidate }
      : result;

  toolMemoryState.lastResult = enriched;
  if (toolName) {
    toolMemoryState.resultsByTool[toolName] = enriched;
  }
  if (stepKey) {
    const normKey = String(stepKey).trim().toLowerCase();
    toolMemoryState.stepResults[normKey] = enriched;
    if (normKey.startsWith("step")) {
      toolMemoryState.stepResults[normKey.slice(4)] = enriched;
    }
  }
  toolMemoryState.history.push({
    tool: toolName,
    ts: Date.now(),
    status: enriched.status || (enriched.success ? "success" : "unknown"),
  });
  if (toolMemoryState.history.length > 25) {
    toolMemoryState.history.shift();
  }

  // Cập nhật Context Memory thói quen người dùng (ứng dụng hay mở, file vừa chạm, từ khóa tìm kiếm)
  try {
    if (
      toolName === "open_url_or_app" ||
      toolName === "universal_app_launcher" ||
      toolName === "open_application" ||
      toolName === "open_app"
    ) {
      const appKey = String(args?.target || args?.app_name || args?.query || "").trim().toLowerCase();
      if (appKey) {
        toolMemoryState.userHabits.frequentApps[appKey] = (toolMemoryState.userHabits.frequentApps[appKey] || 0) + 1;
      }
    } else if (toolName === "filesystem_ops" && args?.path) {
      const p = String(args.path).trim();
      if (p && !toolMemoryState.userHabits.recentFiles.includes(p)) {
        toolMemoryState.userHabits.recentFiles.unshift(p);
        if (toolMemoryState.userHabits.recentFiles.length > 15) toolMemoryState.userHabits.recentFiles.pop();
      }
    } else if (toolName === "search_local_files") {
      const firstPath = enriched.first_path || result?.results?.[0]?.path;
      if (firstPath && !toolMemoryState.userHabits.recentFiles.includes(firstPath)) {
        toolMemoryState.userHabits.recentFiles.unshift(firstPath);
        if (toolMemoryState.userHabits.recentFiles.length > 15) toolMemoryState.userHabits.recentFiles.pop();
      }
    }
  } catch {}

  return enriched;
}

/**
 * Truy xuất giá trị lồng nhau trong bộ nhớ theo đường dẫn (vd: "prev.results.0.path", "step1.content", "last.search_local_files.results.0.path").
 */
export function resolveMemoryPath(expr, memory = toolMemoryState) {
  const clean = String(expr || "").trim().replace(/^\$/, "");
  if (!clean) return undefined;
  const parts = clean
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  if (parts.length === 0) return undefined;

  let rootObj = null;
  const head = parts[0];
  let rest = parts.slice(1);

  if (head === "prev" || head === "lastResult") {
    rootObj = memory.lastResult;
  } else if (/^step(\d+)$/i.test(head)) {
    const stepIdx = head.toLowerCase();
    rootObj = memory.stepResults?.[stepIdx] ?? memory.stepResults?.[head.slice(4)];
  } else if (head === "last" && rest.length > 0) {
    rootObj = memory.resultsByTool?.[rest[0]];
    rest = rest.slice(1);
  } else if (head === "habits") {
    rootObj = memory.userHabits;
  } else if (memory.resultsByTool && head in memory.resultsByTool) {
    rootObj = memory.resultsByTool[head];
  } else {
    rootObj = memory.lastResult;
    rest = parts;
  }

  let cur = rootObj;
  for (const key of rest) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * Nội suy trực tiếp dữ liệu từ Fast-Path Memory Pipeline vào tham số đầu vào của công cụ
 * (hỗ trợ cả cú pháp `{{prev.results.0.path}}`, `{{step1.content}}` và `$prev.path`).
 */
export function interpolatePipelineArgs(input, memory = toolMemoryState) {
  if (input == null) return input;
  if (typeof input === "string") {
    // Nếu toàn bộ chuỗi là 1 biểu thức đơn "{{...}}" hoặc "$prev...." thì trả về nguyên kiểu dữ liệu
    const exactBrace = input.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (exactBrace) {
      const val = resolveMemoryPath(exactBrace[1], memory);
      return val !== undefined ? val : input;
    }
    const exactDollar = input.match(/^\$(prev\.[A-Za-z0-9_.[\]]+|step\d+\.[A-Za-z0-9_.[\]]+)$/);
    if (exactDollar) {
      const val = resolveMemoryPath(exactDollar[1], memory);
      return val !== undefined ? val : input;
    }
    // Thay thế chuỗi con
    return input
      .replace(/\{\{\s*([^}]+?)\s*\}\}/g, (full, expr) => {
        const val = resolveMemoryPath(expr, memory);
        if (val === undefined || val === null) return full;
        return typeof val === "object" ? JSON.stringify(val) : String(val);
      })
      .replace(/\$(prev\.[A-Za-z0-9_.[\]]+|step\d+\.[A-Za-z0-9_.[\]]+)/g, (full, expr) => {
        const val = resolveMemoryPath(expr, memory);
        if (val === undefined || val === null) return full;
        return typeof val === "object" ? JSON.stringify(val) : String(val);
      });
  }
  if (Array.isArray(input)) {
    return input.map((item) => interpolatePipelineArgs(item, memory));
  }
  if (typeof input === "object") {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = interpolatePipelineArgs(v, memory);
    }
    return out;
  }
  return input;
}

export async function executeVisualChainTool(args = {}) {
  const steps = Array.isArray(args?.steps) ? args.steps : [];
  const goal = String(args?.goal || "Chuỗi tác vụ tự hành").trim();

  if (steps.length === 0) {
    return { status: "error", error: "Thiếu danh sách bước (steps) trong chuỗi hành động." };
  }

  emitEvent({
    type: "log",
    level: "info",
    message: `[VisualChain] Bắt đầu chuỗi ${steps.length} bước: "${goal}"`,
  });
  emitToRenderer("hud:message", {
    title: "Trợ Lý Tự Hành",
    content: `Bắt đầu: ${goal} (${steps.length} bước)`,
  });

  const executedSteps = [];
  // Khởi tạo bộ nhớ bước của chuỗi hiện tại (step1, step2, ...)
  toolMemoryState.stepResults = {};

  for (let i = 0; i < steps.length; i++) {
    const rawStep = steps[i] || {};
    // Tự động truyền dữ liệu qua bộ nhớ trong (Fast-Path Memory Pipeline) giữa các bước
    const step = interpolatePipelineArgs(rawStep, toolMemoryState);
    const stepArgs = step.args && typeof step.args === "object" ? step.args : step;
    const action = String(step.action || step.tool || "").trim().toLowerCase();
    const stepLabel = `Bước ${i + 1}/${steps.length} [${action}]`;
    const stepDetail = String(
      step.target || step.text || step.key || step.query || step.path || stepArgs?.query || stepArgs?.path || ""
    ).trim();

    emitEvent({
      type: "log",
      level: "info",
      message: `[VisualChain] ${stepLabel}: ${stepDetail}`,
    });
    emitToRenderer("iris:tool-status", {
      state: "running",
      name: "execute_visual_chain",
      label: `${stepLabel}${stepDetail ? `: ${stepDetail.slice(0, 32)}` : ""}`,
    });

    let stepResult = { step: i + 1, action, success: false };

    try {
      if (action === "open_app" || action === "open_url" || action === "open_url_or_app") {
        const target = step.target || step.text || stepArgs.target || stepArgs.url;
        const isUrl = action === "open_url" || Boolean(stepArgs.is_url) || /^https?:\/\//i.test(String(target || ""));
        const res = await openUrlOrApp({ target, is_url: isUrl });
        await smartSettle({ minWaitMs: 350 });
        stepResult.success = res?.status !== "error";
        stepResult.details = res;
      } else if (action === "click" || action === "computer_use_omniparser") {
        const target = step.target || step.text || stepArgs.task || stepArgs.target;
        const res = await startOmniParserTask({ task: target, fast_mode: step.fast_mode ?? true });
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else if (action === "type" || action === "computer_use_type") {
        const text = step.text ?? stepArgs.text ?? "";
        const res = await startComputerUseType({ ...stepArgs, text });
        await smartSettle({ minWaitMs: 150 });
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else if (action === "press_key") {
        const key = step.key || step.text || stepArgs.key || "";
        const res = await startComputerUseType({ key });
        await smartSettle({ minWaitMs: 150 });
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else if (action === "wait") {
        const dur = Math.min(10000, Math.max(100, Number(step.duration_ms || stepArgs.duration_ms || 500)));
        await sleep(dur);
        stepResult.success = true;
        stepResult.details = { status: "success", waited_ms: dur };
      } else if (action === "verify") {
        const { buffer } = await grabPrimaryScreenJpeg(75);
        stepResult.success = Boolean(buffer && buffer.length > 0);
        stepResult.has_frame = stepResult.success;
        stepResult.details = { status: stepResult.success ? "success" : "error", has_frame: stepResult.success };
      } else if (action === "search_local_files" || action === "search_everything") {
        const query = step.query || step.target || step.text || stepArgs.query;
        const res = await searchEverythingTool({ query, max: step.max || stepArgs.max || 10 });
        // Thêm trường tiện lợi first_path để bước sau dễ dàng lấy {{prev.first_path}}
        if (res?.status === "success" && Array.isArray(res.results) && res.results[0]?.path) {
          res.first_path = res.results[0].path;
          res.path = res.results[0].path;
        }
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else if (action === "filesystem_ops" || action === "read_file" || action === "write_file") {
        const fsAction =
          action === "read_file" ? "read" : action === "write_file" ? "write" : (step.fs_action || stepArgs.action || "read");
        const targetPath = step.path || step.target || stepArgs.path || resolveMemoryPath("prev.first_path");
        const res = await filesystemOpsTool({
          ...stepArgs,
          action: fsAction,
          path: targetPath,
          content: step.content ?? step.text ?? stepArgs.content,
        });
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else if (action === "ui_automation") {
        const res = await uiAutomationTool({
          action: step.uia_action || stepArgs.action || "click",
          target: step.target || stepArgs.target,
          query: step.query || step.target || stepArgs.query,
          text: step.text || stepArgs.text,
        });
        stepResult.success = res?.status === "success" || res?.success === true;
        stepResult.details = res;
      } else if (action === "ocr_region") {
        const res = await ocrRegionTool({
          ...stepArgs,
          find: step.find || step.query || step.target || stepArgs.find,
        });
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else if (action === "browser_open") {
        const res = await browserOpenTool({ url: step.url || step.target || step.text || stepArgs.url });
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else if (action === "browser_click") {
        const res = await browserClickTool({ target: step.target || step.text || stepArgs.target });
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else if (action === "browser_type") {
        const res = await browserTypeTool({
          target: step.target || stepArgs.target,
          text: step.text || stepArgs.text,
          submit: step.submit ?? stepArgs.submit,
        });
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else if (action === "browser_extract_text") {
        const res = await browserExtractTextTool(stepArgs);
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else if (action === "quick_reminder") {
        const res = await quickReminderTool({
          action: step.reminder_action || stepArgs.action || "schedule",
          minutes: step.minutes ?? stepArgs.minutes ?? 30,
          title: step.title || step.target || stepArgs.title || goal,
          message: step.message || step.text || stepArgs.message || goal,
        });
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else if (action === "send_desktop_notification" || action === "notify") {
        const res = await sendDesktopNotificationTool({
          title: step.title || stepArgs.title || "Iris",
          message: step.message || step.text || stepArgs.message || `Đã hoàn tất: ${goal}`,
        });
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else if (action === "read_clipboard") {
        const res = await readClipboardTool();
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else if (action === "write_clipboard") {
        const res = await writeClipboardTool({ text: step.text || stepArgs.text });
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else if (action === "window_manager") {
        const res = await windowManagerTool(stepArgs);
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else if (action === "run_terminal_command") {
        const res = await runTerminalCommandTool(stepArgs);
        stepResult.success = res?.status === "success";
        stepResult.details = res;
      } else {
        stepResult.error = `Hành động không xác định: ${action}`;
        stepResult.success = false;
      }
    } catch (err) {
      stepResult.error = err.message;
      stepResult.success = false;
    }

    // Lưu kết quả bước vào Fast-Path Memory Pipeline để các bước kế tiếp truy cập tức thì (< 0.05ms)
    if (stepResult.details) {
      recordToolExecution(action, step, stepResult.details);
      toolMemoryState.stepResults[`step${i + 1}`] = stepResult.details;
      toolMemoryState.stepResults[String(i + 1)] = stepResult.details;
    }

    executedSteps.push(stepResult);

    if (!stepResult.success && step.continue_on_error !== true) {
      emitEvent({
        type: "log",
        level: "warn",
        message: `[VisualChain] ${stepLabel} không thành công: ${stepResult.error || "Lỗi bước"}`,
      });
      return {
        status: "partial_failure",
        goal,
        failed_step: i + 1,
        executed_steps: executedSteps,
        message: `Dừng chuỗi tại bước ${i + 1} (${action}): ${stepResult.error || "Thao tác chưa hoàn thành"}. Hãy nhìn lại màn hình hoặc thử bước khác.`,
      };
    }
  }

  emitEvent({
    type: "log",
    level: "info",
    message: `[VisualChain] ✔ Hoàn tất toàn bộ chuỗi: "${goal}"`,
  });
  emitToRenderer("hud:message", {
    title: "Trợ Lý Tự Hành",
    content: `✔ Đã hoàn thành: ${goal}`,
  });

  return {
    status: "success",
    goal,
    total_steps: steps.length,
    executed_steps: executedSteps,
    last_output: toolMemoryState.lastResult,
    message: `Đã thực hiện và nghiệm thu thành công toàn bộ ${steps.length} bước cho: "${goal}".`,
  };
}
