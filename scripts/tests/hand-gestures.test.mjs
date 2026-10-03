// V-10 — validate payload, đổi toạ độ theo tỉ lệ, cử chỉ hệ thống mặc định tắt.
import test from "node:test";
import assert from "node:assert/strict";
import { parseHandGesture, createHandGestureHandler, ratioToScreenPoint } from "../../electron/main/hand-gestures.mjs";

const mkNut = () => {
  const log = [];
  const Key = new Proxy({}, { get: (_t, k) => String(k) });
  return {
    log,
    nut: {
      keyboard: { pressKey: async (...k) => log.push(["press", ...k]), releaseKey: async (...k) => log.push(["release", ...k]) },
      mouse: { setPosition: async (p) => log.push(["move", p.x, p.y]), pressButton: async () => log.push(["down"]), releaseButton: async () => log.push(["up"]) },
      Point: class { constructor(x, y) { this.x = x; this.y = y; } },
      Button: { LEFT: "L" },
      Key,
    },
  };
};
const mkHandler = (envObj = {}) => {
  const { log, nut } = mkNut();
  const hud = [];
  const win = {
    isDestroyed: () => false, getContentBounds: () => ({ x: 100, y: 50, width: 1000, height: 500 }),
    show() { hud.push("show"); }, focus() {}, webContents: { _z: 1, getZoomFactor() { return this._z; }, setZoomFactor(z) { this._z = z; hud.push(["zoom", z]); } },
  };
  const screen = { dipToScreenPoint: (p) => ({ x: p.x * 1.5, y: p.y * 1.5 }) }; // DPI 150%
  const h = createHandGestureHandler({ getNut: async () => nut, getMainWindow: () => win, screen, toggleHud: () => hud.push("hud"), env: () => envObj });
  return { h, log, hud };
};

test("parseHandGesture: whitelist + kiểm kiểu/khoảng", () => {
  assert.deepEqual(parseHandGesture("thumb_up"), { kind: "discrete", name: "thumb_up" });
  for (const bad of ["rm -rf", "", null, undefined, 5, [], {}, { type: "grab" }, { type: "grab", nx: 2, ny: 0.5 }, { type: "grab", nx: "0.5", ny: 0.5 }, { type: "grab", nx: NaN, ny: 0 }, { type: "grab", x: 10, y: 10 }]) {
    assert.equal(parseHandGesture(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(parseHandGesture({ type: "release" }), { kind: "release" });
  assert.deepEqual(parseHandGesture({ type: "grab", nx: 0.5, ny: 1 }), { kind: "grab", nx: 0.5, ny: 1 });
});

test("ratioToScreenPoint đổi tỉ lệ -> DIP -> màn hình (DPI 150%)", () => {
  const p = ratioToScreenPoint(0.5, 0.5, { x: 100, y: 50, width: 1000, height: 500 }, { dipToScreenPoint: (d) => ({ x: d.x * 1.5, y: d.y * 1.5 }) });
  assert.deepEqual(p, { x: 900, y: 450 }); // (100+500)*1.5, (50+250)*1.5
});

test("MẶC ĐỊNH cử chỉ hệ thống KHÔNG gửi phím nào (Win/Alt+F4/Alt+Tab/Ctrl±)", async () => {
  const { h, log } = mkHandler({});
  for (const g of ["thumb_up", "victory", "thumb_down", "swipe_left", "swipe_right", "zoom_in", "zoom_out"]) await h.handle(g);
  assert.deepEqual(log.filter((e) => e[0] === "press" || e[0] === "release"), []);
});

test("IRIS_HAND_SYSTEM_GESTURES=1 mới gửi phím", async () => {
  const { h, log } = mkHandler({ IRIS_HAND_SYSTEM_GESTURES: "1" });
  await h.handle("thumb_down");
  assert.deepEqual(log[0], ["press", "LeftAlt", "F4"]);
  await h.handle("victory");
  assert.deepEqual(log.at(-2), ["press", "LeftSuper", "D"]);
});

test("pinch bật/tắt HUD (không minimize)", async () => {
  const { h, hud } = mkHandler({});
  await h.handle("pinch");
  assert.deepEqual(hud, ["hud"]);
});

test("zoom khi tắt hệ thống chỉ zoom UI Iris", async () => {
  const { h, hud, log } = mkHandler({});
  await h.handle("zoom_in");
  assert.deepEqual(hud[0], ["zoom", 1.1]);
  assert.equal(log.length, 0);
});

test("grab/release: đổi toạ độ, giữ chuột đúng một lần, release nhả đúng", async () => {
  const { h, log } = mkHandler({});
  await h.handle({ type: "grab", nx: 0.5, ny: 0.5 });
  await h.handle({ type: "grab", nx: 0.6, ny: 0.5 });
  assert.deepEqual(log, [["move", 900, 450], ["down"], ["move", 1050, 450]]);
  assert.equal(h.isGrabbing(), true);
  await h.handle({ type: "release" });
  await h.handle({ type: "release" });
  assert.deepEqual(log.slice(3), [["up"]]);
  assert.equal(h.isGrabbing(), false);
});

test("payload xấu bị bỏ qua, không ném lỗi", async () => {
  const { h, log } = mkHandler({ IRIS_HAND_SYSTEM_GESTURES: "1" });
  for (const bad of [null, "format c:", { type: "grab", nx: 9, ny: 9 }, 42]) assert.equal((await h.handle(bad)).ok, false);
  assert.equal(log.length, 0);
});
