// V-02 / V-03 — grabJpeg không treo trên MJPEG; vòng lặp frame không tự chết.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { grabJpeg, createFrameLoop } from "../../electron/main/vision-capture.mjs";

const jpeg = (tag) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(String(tag).padEnd(64, "x")), Buffer.from([0xff, 0xd9])]);
const sockets = new Set();
let mjpegAlive = 0;
const server = http.createServer((req, res) => {
  if (req.url === "/snap") {
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    return res.end(jpeg("snap"));
  }
  if (req.url === "/stream") {
    // MJPEG VÔ HẠN, frame bị cắt ngang chunk
    res.writeHead(200, { "Content-Type": "multipart/x-mixed-replace; boundary=frame" });
    mjpegAlive++;
    let n = 0;
    const iv = setInterval(() => {
      const f = jpeg(`f${n++}`);
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.length}\r\n\r\n`);
      res.write(f.subarray(0, 10));
      setTimeout(() => { try { res.write(f.subarray(10)); res.write("\r\n"); } catch {} }, 5);
    }, 30);
    res.on("close", () => { clearInterval(iv); mjpegAlive--; });
    return;
  }
  if (req.url === "/hang") return; // không bao giờ trả lời
  if (req.url === "/big") {
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    return res.end(Buffer.alloc(5_000_000, 1));
  }
  if (req.url === "/404") { res.writeHead(404); return res.end(); }
  res.writeHead(500); res.end();
});
server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { for (const s of sockets) s.destroy(); server.close(); });

test("grabJpeg: snapshot thường", async () => {
  const b = await grabJpeg(`${base}/snap`);
  assert.equal(b[0], 0xff); assert.equal(b[1], 0xd8);
  assert.equal(b.subarray(-2).toString("hex"), "ffd9");
});

test("grabJpeg: MJPEG vô hạn => trả đúng 1 frame nguyên vẹn trong <2s và đóng kết nối", async () => {
  const t0 = Date.now();
  const b = await grabJpeg(`${base}/stream`, { timeoutMs: 4000 });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(b.subarray(0, 2).toString("hex"), "ffd8");
  assert.equal(b.subarray(-2).toString("hex"), "ffd9");
  assert.match(b.toString("latin1"), /^\xff\xd8\xff\xe0f\d+x+\xff\xd9$/);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(mjpegAlive, 0, "kết nối MJPEG phải được đóng (không rò kết nối)");
});

test("grabJpeg: server treo => timeout, HTTP lỗi => ném, quá lớn => ném", async () => {
  const t0 = Date.now();
  await assert.rejects(grabJpeg(`${base}/hang`, { timeoutMs: 400 }));
  assert.ok(Date.now() - t0 < 1500);
  await assert.rejects(grabJpeg(`${base}/404`), /HTTP 404/);
  await assert.rejects(grabJpeg(`${base}/big`), /too large/);
});

const mkLoop = (over = {}) => {
  const st = { sent: [], events: [], stopped: 0, session: true, active: true, frames: [jpeg("a")], captures: 0 };
  const loop = createFrameLoop({
    label: "test",
    intervalMs: 3_600_000, // chỉ gọi tick() thủ công
    capture: async () => { st.captures++; const f = st.frames.shift() ?? jpeg("last"); if (f instanceof Error) throw f; return f; },
    isActive: () => st.active,
    hasSession: () => st.session,
    send: (b64) => (st.sent.push(b64), true),
    emit: (e) => st.events.push(e),
    onStop: () => st.stopped++,
    ...over,
  });
  return { st, loop };
};

test("frame loop: gửi, dedupe frame trùng", async () => {
  const { st, loop } = mkLoop({});
  st.frames = [jpeg("a"), jpeg("a"), jpeg("b")];
  await loop.tick(); await loop.tick(); await loop.tick();
  assert.equal(st.sent.length, 2);
  loop.stop();
});

test("frame loop: KHÔNG tự tắt khi mất phiên Gemini; khi nối lại gửi lại frame (reset dedupe)", async () => {
  const { st, loop } = mkLoop({});
  st.frames = [jpeg("a"), jpeg("a"), jpeg("a")];
  await loop.tick();
  st.session = false;
  await loop.tick(); await loop.tick(); // đang reconnect
  assert.equal(st.stopped, 0);
  assert.equal(st.captures, 1, "không chụp khi chưa có phiên");
  st.session = true;
  await loop.tick();
  assert.equal(st.sent.length, 2, "phiên mới phải nhận lại frame dù ảnh không đổi");
  loop.stop();
});

test("frame loop: không chồng request (in-flight)", async () => {
  let release; const gate = new Promise((r) => (release = r));
  const { st, loop } = mkLoop({ capture: async () => { st.captures++; await gate; return jpeg("z"); } });
  const p1 = loop.tick(); const p2 = loop.tick(); const p3 = loop.tick();
  await p2; await p3;
  assert.equal(st.captures, 1);
  release(); await p1;
  assert.equal(st.sent.length, 1);
  loop.stop();
});

test("frame loop: 5 lỗi liên tiếp => dừng CÓ báo; thành công giữa chừng reset bộ đếm", async () => {
  const { st, loop } = mkLoop({});
  const err = () => new Error("boom");
  st.frames = [err(), err(), jpeg("ok1"), err(), err(), err(), err(), err()];
  for (let i = 0; i < 7; i++) await loop.tick();
  assert.equal(st.stopped, 0, "4 lỗi sau 1 thành công chưa đủ 5");
  await loop.tick();
  assert.equal(st.stopped, 1);
  assert.ok(st.events.some((e) => e.level === "error" && /đã dừng/.test(e.message)));
  loop.stop();
});

test("frame loop: không hoạt động khi isActive=false", async () => {
  const { st, loop } = mkLoop({});
  st.active = false;
  await loop.tick();
  assert.equal(st.captures, 0);
  loop.stop();
});
