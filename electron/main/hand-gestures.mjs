/**
 * electron/main/hand-gestures.mjs
 *
 * V-10: xử lý IPC `iris:hand-gesture` an toàn.
 *  - Validate payload (whitelist chuỗi hoặc {type:"grab"|"release", nx, ny} với nx,ny ∈ [0,1]).
 *  - Toạ độ: renderer gửi TỈ LỆ; main đổi sang toạ độ màn hình qua getContentBounds + dipToScreenPoint
 *    (đúng với DPI 125/150% và đa màn hình — trước đây dùng thẳng toạ độ CSS px làm toạ độ chuột).
 *  - Cử chỉ HỆ THỐNG (Win, Win+D, Alt+F4, Alt+Tab, Ctrl±) chỉ chạy khi IRIS_HAND_SYSTEM_GESTURES=1
 *    (mặc định tắt); khi tắt, chúng chỉ tác động tới UI của Iris.
 *  - `pinch` không còn minimize cửa sổ (không nhận diện được tiếp khi bị thu nhỏ) mà bật/tắt HUD.
 *  - Trạng thái giữ chuột là biến module (không dùng global.isGrabbing).
 *
 * Module thuần: mọi phụ thuộc (nut-js, cửa sổ, screen...) được truyền vào.
 */

export const DISCRETE_GESTURES = new Set([
  "pinch", "swipe_left", "swipe_right", "zoom_in", "zoom_out", "thumb_up", "thumb_down", "victory",
]);

const isRatio = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/** @returns {{kind:"discrete",name:string}|{kind:"grab",nx:number,ny:number}|{kind:"release"}|null} */
export function parseHandGesture(payload) {
  if (typeof payload === "string") {
    return DISCRETE_GESTURES.has(payload) ? { kind: "discrete", name: payload } : null;
  }
  if (payload && typeof payload === "object") {
    if (payload.type === "release") return { kind: "release" };
    if (payload.type === "grab" && isRatio(payload.nx) && isRatio(payload.ny)) {
      return { kind: "grab", nx: payload.nx, ny: payload.ny };
    }
  }
  return null;
}

export function systemGesturesEnabled(env = process.env) {
  return String(env.IRIS_HAND_SYSTEM_GESTURES || "").trim() === "1";
}

/** Tỉ lệ trong cửa sổ -> toạ độ màn hình vật lý. */
export function ratioToScreenPoint(nx, ny, bounds, screen) {
  const dip = { x: Math.round(bounds.x + nx * bounds.width), y: Math.round(bounds.y + ny * bounds.height) };
  const p = typeof screen?.dipToScreenPoint === "function" ? screen.dipToScreenPoint(dip) : dip;
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/**
 * @param {object} deps
 * @param {() => Promise<any>} deps.getNut          nut-js đã nạp
 * @param {() => any} deps.getMainWindow
 * @param {any} deps.screen                         electron.screen
 * @param {() => void} deps.toggleHud
 * @param {(m:string)=>void} [deps.log]
 * @param {() => Record<string,string|undefined>} [deps.env]
 */
export function createHandGestureHandler(deps) {
  const env = () => (deps.env ? deps.env() : process.env);
  let isGrabbing = false;

  async function releaseGrabIfHeld() {
    if (!isGrabbing) return;
    isGrabbing = false;
    try {
      const { mouse, Button } = await deps.getNut();
      await mouse.releaseButton(Button.LEFT);
    } catch (e) {
      deps.log?.(`Không nhả được chuột: ${e.message}`);
    }
  }

  async function press(keys) {
    const { keyboard, Key } = await deps.getNut();
    const list = keys.map((k) => Key[k]);
    await keyboard.pressKey(...list);
    await keyboard.releaseKey(...list);
  }

  // Cử chỉ khi KHÔNG bật hệ thống: chỉ tác động UI Iris.
  function irisOnly(name) {
    const win = deps.getMainWindow?.();
    if (name === "zoom_in" || name === "zoom_out") {
      if (win && !win.isDestroyed?.()) {
        const wc = win.webContents;
        const next = Math.min(1.6, Math.max(0.6, wc.getZoomFactor() + (name === "zoom_in" ? 0.1 : -0.1)));
        wc.setZoomFactor(next);
      }
    } else if (name === "victory") {
      deps.toggleHud();
    } else if (name === "thumb_up") {
      if (win && !win.isDestroyed?.()) { win.show(); win.focus(); }
    }
    // swipe_*, thumb_down: không làm gì khi tắt cử chỉ hệ thống (không bao giờ Alt+F4/Alt+Tab).
  }

  async function handle(payload) {
    const g = parseHandGesture(payload);
    if (!g) return { ok: false, reason: "invalid" };
    try {
      if (g.kind === "release") {
        await releaseGrabIfHeld();
        return { ok: true };
      }
      if (g.kind === "grab") {
        const win = deps.getMainWindow?.();
        if (!win || win.isDestroyed?.()) return { ok: false, reason: "no-window" };
        const { mouse, Point, Button } = await deps.getNut();
        const p = ratioToScreenPoint(g.nx, g.ny, win.getContentBounds(), deps.screen);
        if (!isGrabbing) {
          isGrabbing = true;
          await mouse.setPosition(new Point(p.x, p.y));
          await mouse.pressButton(Button.LEFT);
        } else {
          await mouse.setPosition(new Point(p.x, p.y));
        }
        return { ok: true };
      }
      // discrete
      if (g.name === "pinch") {
        deps.toggleHud();
        return { ok: true };
      }
      if (!systemGesturesEnabled(env())) {
        irisOnly(g.name);
        return { ok: true, system: false };
      }
      switch (g.name) {
        case "swipe_right": await press(["LeftAlt", "Tab"]); break;
        case "swipe_left": await press(["LeftAlt", "LeftShift", "Tab"]); break;
        case "zoom_in": await press(["LeftControl", "Equal"]); break;
        case "zoom_out": await press(["LeftControl", "Minus"]); break;
        case "thumb_up": await press(["LeftSuper"]); break;
        case "victory": await press(["LeftSuper", "D"]); break;
        case "thumb_down": await press(["LeftAlt", "F4"]); break;
        default: return { ok: false, reason: "unknown" };
      }
      return { ok: true, system: true };
    } catch (e) {
      deps.log?.(`Hand gesture error: ${e.message}`);
      return { ok: false, reason: "error", error: e.message };
    }
  }

  return { handle, releaseGrabIfHeld, isGrabbing: () => isGrabbing };
}
