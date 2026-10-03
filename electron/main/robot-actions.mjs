/**
 * electron/main/robot-actions.mjs
 *
 * Robot arm/base control: resolving a natural-language robot name to a
 * configured device, clamping arm-move parameters to safe ranges, and
 * dispatching the actual HTTP action with a timeout + de-dupe guard.
 */
import { getRobotsConfig } from "./device-config.mjs";

export function normalizeViText(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // bỏ dấu
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim();
}

export function tokenize(s) {
  return normalizeViText(s).split(/\s+/).filter(Boolean);
}

export function resolveRobotDevice(device) {
  if (!device) return { status: "none" };
  const robots = getRobotsConfig();

  // 1) Khớp chính xác theo id (key trong robots.json) — không đổi hành vi cũ
  if (robots[device]) return { status: "ok", id: device };

  const needleNorm = normalizeViText(device);
  const needleTokens = tokenize(device);

  // 2) Khớp chính xác theo id hoặc tên (chuẩn hoá dấu + hoa/thường)
  const exactMatches = [];
  for (const [id, cfg] of Object.entries(robots)) {
    const nameNorm = normalizeViText(cfg?.name || "");
    if (normalizeViText(id) === needleNorm || nameNorm === needleNorm) {
      exactMatches.push(id);
    }
  }
  if (exactMatches.length === 1) return { status: "ok", id: exactMatches[0] };
  if (exactMatches.length > 1) return { status: "ambiguous", ids: exactMatches };

  // 3) Khớp theo token: mọi từ trong lệnh phải xuất hiện TRỌN VẸN trong tên
  // thiết bị (không phải substring ký tự) để tránh khớp nhầm kiểu "đèn" lọt
  // vào giữa 1 từ khác không liên quan.
  if (needleTokens.length > 0) {
    const tokenMatches = [];
    for (const [id, cfg] of Object.entries(robots)) {
      const nameTokens = tokenize(cfg?.name || "");
      if (needleTokens.every((t) => nameTokens.includes(t))) {
        tokenMatches.push(id);
      }
    }
    if (tokenMatches.length === 1) return { status: "ok", id: tokenMatches[0] };
    if (tokenMatches.length > 1) return { status: "ambiguous", ids: tokenMatches };
  }

  return { status: "none" };
}

export async function triggerSmartHome({ device, action }) {
  // 1) Ưu tiên robots.json nếu có thiết bị khớp và có control_url
  const resolved = resolveRobotDevice(device);

  if (resolved.status === "ambiguous") {
    // AUDIT-SH-01: không được đoán bừa khi tên gọi khớp nhiều thiết bị cùng
    // lúc. Trả lỗi để AI/người dùng biết cần nói tên cụ thể hơn.
    const robots = getRobotsConfig();
    const names = resolved.ids.map((id) => robots[id]?.name || id).join(", ");
    return {
      status: "error",
      error: `Tên thiết bị "${device}" khớp với nhiều hơn 1 thiết bị (${names}). Hãy nói tên cụ thể hơn để tránh điều khiển nhầm.`,
    };
  }

  if (resolved.status === "ok") {
    const matchedId = resolved.id;
    const robots = getRobotsConfig();
    if (robots[matchedId]?.control_url) {
      const result = await triggerRobotAction({ robot_id: matchedId, action, params: {} });
      if (result.status === "success") {
        return { status: "success", message: `Command sent to ${device} (${matchedId}): ${action}` };
      }
      return result;
    }
  }

  // 2) Fallback: webhook nhà thông minh chung (VD Home Assistant)
  const url = process.env.SMART_HOME_WEBHOOK_URL;
  if (!url) {
    // T-03: KHÔNG được báo "success" khi chưa điều khiển thiết bị nào — Gemini sẽ
    // nói với người dùng "đã bật đèn" dù không có gì xảy ra.
    return {
      status: "not_configured",
      error: "Chưa cấu hình control_url cho thiết bị trong robots.json hoặc SMART_HOME_WEBHOOK_URL trong .env, nên chưa điều khiển được thiết bị nào.",
    };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const token = process.env.SMART_HOME_TOKEN;
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    // We send a generic POST request
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ device, action }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { status: "success", message: `Command sent to ${device}: ${action}` };
  } catch (error) {
    if (error.name === "AbortError") {
      return { status: "error", error: "Smart Home server khong phan hoi (timeout)" };
    }
    return { status: "error", error: error.message };
  } finally {
    clearTimeout(timeoutId);
  }
}

// FIX-ROBOT-01: Theo dõi request đang bay theo từng robot_id để có thể hủy
// (AbortController) khi có lệnh mới hơn tới trước khi lệnh cũ kịp trả lời.
// Lý do: 2 request HTTP gửi gần nhau (VD "forward" rồi nhả phím ra "stop")
// không đảm bảo trả lời theo đúng thứ tự gửi đi (độ trễ mạng/WiFi dao động).
// Nếu không xử lý, "stop" có thể resolve trước "forward" và robot bị kẹt ở
// trạng thái chạy dù người dùng đã nhả phím từ lâu — rất nguy hiểm với thiết
// bị vật lý. Giải pháp: mỗi robot chỉ giữ 1 request "đang hiệu lực", request
// cũ hơn luôn bị hủy ngay khi có request mới.
// FIX-ARM-01: Kẹp góc servo (0-180°) ngay tại main.mjs — đây là lớp bảo vệ
// bắt buộc, KHÔNG được chỉ dựa vào việc UI (RobotCameras.tsx) đã kẹp giá trị
// slider. main.mjs là ranh giới tin cậy cuối cùng phía phần mềm trước khi
// lệnh chạm tới động cơ thật: UI có thể có bug, DevTools có thể bị chỉnh tay,
// hoặc trong tương lai lệnh "arm_move" có thể được gọi từ nơi khác (VD từ
// voice/AI tool) mà không đi qua slider này.
export const ARM_JOINT_RANGE = { base: [0, 180], shoulder: [0, 180], elbow: [0, 180], gripper: [0, 180] };

export function clampArmParams(params) {
  if (!params || typeof params !== "object") return params;
  const clamped = { ...params };
  for (const [joint, [min, max]] of Object.entries(ARM_JOINT_RANGE)) {
    if (typeof clamped[joint] === "number" && Number.isFinite(clamped[joint])) {
      clamped[joint] = Math.min(max, Math.max(min, clamped[joint]));
    }
  }
  return clamped;
}

export const _robotActionControllers = new Map();
export const ROBOT_ACTION_TIMEOUT_MS = 1500;

// Firmware chỉ hiểu forward/backward/left/right/stop (+ arm_move). Tool mô tả cho
// Gemini dùng 'move_forward', 'turn_left'... nên phải chuẩn hoá, nếu không firmware
// bỏ qua lệnh mà phía Node vẫn báo thành công.
export const DRIVE_ACTIONS = new Set(["forward", "backward", "left", "right"]);
const ACTION_ALIASES = {
  move_forward: "forward", go_forward: "forward", forwards: "forward", ahead: "forward",
  move_backward: "backward", go_backward: "backward", move_back: "backward", back: "backward", reverse: "backward",
  turn_left: "left", move_left: "left", turn_right: "right", move_right: "right",
  halt: "stop", brake: "stop",
};
export function normalizeRobotAction(action) {
  const a = String(action || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ACTION_ALIASES[a] || a;
}

export const _timedDrives = new Map();
export function cancelTimedDrive(robot_id) {
  const t = _timedDrives.get(robot_id);
  if (t) { clearInterval(t); _timedDrives.delete(robot_id); }
}
export function cancelAllTimedDrives() {
  for (const id of [..._timedDrives.keys()]) cancelTimedDrive(id);
}

export const DRIVE_HEARTBEAT_MS = 200; // <= 300 ms để nuôi deadman 600 ms của firmware
export const DRIVE_DEFAULT_MS = 1000;
export const DRIVE_MAX_MS = 5000;

/**
 * Lái có thời hạn (đường lệnh thoại/AI): gửi lệnh lái lặp mỗi 200 ms trong `duration_ms`
 * (mặc định 1 s, tối đa 5 s) rồi TỰ gửi stop. Không để robot chạy vô thời hạn.
 */
export async function triggerRobotActionTimed({ robot_id, action, params }) {
  const act = normalizeRobotAction(action);
  if (!DRIVE_ACTIONS.has(act)) return triggerRobotAction({ robot_id, action: act, params });

  const first = await triggerRobotAction({ robot_id, action: act, params });
  if (first.status !== "success") return first;

  const rawMs = Number(params?.duration_ms ?? (params?.seconds != null ? Number(params.seconds) * 1000 : NaN));
  const dur = Math.min(DRIVE_MAX_MS, Math.max(200, Number.isFinite(rawMs) ? rawMs : DRIVE_DEFAULT_MS));
  cancelTimedDrive(robot_id);
  const started = Date.now();
  const iv = setInterval(() => {
    if (Date.now() - started >= dur) {
      cancelTimedDrive(robot_id);
      triggerRobotAction({ robot_id, action: "stop" }).catch(() => {});
    } else {
      triggerRobotAction({ robot_id, action: act }).catch(() => {});
    }
  }, DRIVE_HEARTBEAT_MS);
  _timedDrives.set(robot_id, iv);
  return { status: "success", message: `Robot ${act} trong ${dur} ms rồi tự dừng.` };
}

export async function triggerRobotAction({ robot_id, action: rawAction, params }) {
  const action = normalizeRobotAction(rawAction);
  if (action === "stop") cancelTimedDrive(robot_id);
  const robots = getRobotsConfig();
  if (!robot_id || !robots[robot_id]) {
    return { status: "error", error: "Invalid or missing robot_id." };
  }

  const robot = robots[robot_id];
  const url = robot.control_url;
  if (!url) {
    // T-03: thiếu control_url => not_configured (không phải success).
    return { status: "not_configured", error: `Robot ${robot_id} chưa có control_url trong robots.json nên chưa điều khiển được.` };
  }

  // Hủy request trước đó của CÙNG robot này (nếu còn đang chờ phản hồi)
  const prevController = _robotActionControllers.get(robot_id);
  if (prevController) prevController.abort();

  const controller = new AbortController();
  _robotActionControllers.set(robot_id, controller);

  // FIX-ROBOT-02: timeout cứng cho request điều khiển robot. fetch() mặc
  // định không có timeout — nếu ESP32 treo hoặc usb_server.py mất phản hồi,
  // request sẽ treo vô thời hạn và renderer (nút bấm WASD) không bao giờ
  // biết lệnh có tới nơi hay không.
  const timeoutId = setTimeout(() => controller.abort(), ROBOT_ACTION_TIMEOUT_MS);

  try {
    const headers = { "Content-Type": "application/json" };
    if (robot.token) headers["Authorization"] = `Bearer ${robot.token}`;
    // FIX-ARM-01 (tiếp): chỉ kẹp góc cho action arm_move, các action khác
    // (forward/backward/left/right/stop) đi qua nguyên vẹn như cũ.
    const safeParams = action === "arm_move" ? clampArmParams(params) : params;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, params: safeParams }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { status: "success", message: `Command sent to robot: ${action}` };
  } catch (error) {
    if (error.name === "AbortError") {
      return { status: "error", error: "Robot khong phan hoi (timeout hoac bi lenh moi hon ghi de)" };
    }
    return { status: "error", error: error.message };
  } finally {
    clearTimeout(timeoutId);
    if (_robotActionControllers.get(robot_id) === controller) {
      _robotActionControllers.delete(robot_id);
    }
  }
}
