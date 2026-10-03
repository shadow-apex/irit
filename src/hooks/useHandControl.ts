import { useEffect, useRef, useState } from "react";
import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";

export type HandPoint = { x: number; y: number };
export type HandLandmark = { x: number; y: number };

export type TrackedHand = {
  id: string;
  point: HandPoint;
  landmarks: HandLandmark[];
  gesture: string;
  gestureScore: number;
  pointing: boolean;
  openPalm: boolean;
  fist: boolean;
  /** Normalized thumb-tip-to-index-tip distance (landmarks 4/8); smaller = tighter pinch. */
  pinchDistance: number;
};

export type HandState = {
  active: boolean;
  present: boolean;
  point: HandPoint | null;
  gesture: string;
  gestureScore: number;
  pointing: boolean;
  openPalm: boolean;
  fist: boolean;
  pinchDistance: number;
  hands: TrackedHand[];
  shush: boolean;
  pinch: boolean;
  swipe: "left" | "right" | null;
  zoom: "in" | "out" | null;
  grab: boolean;
};

// Giữ phiên bản này TRÙNG với @mediapipe/tasks-vision trong package.json (đã ghim cứng) để
// tránh lệch ABI giữa JS API và WASM.
const CDN_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const CDN_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";
// Bản cục bộ do `npm run setup:mediapipe` (scripts/prepare-mediapipe.mjs) chép vào public/mediapipe/
// — chạy được offline, không phụ thuộc CDN. Thiếu thì tự rơi về CDN.
const LOCAL_WASM_URL = "./mediapipe/wasm";
const LOCAL_MODEL_URL = "./mediapipe/gesture_recognizer.task";

async function resolveAssetUrls(): Promise<{ wasm: string; model: string }> {
  try {
    const [w, m] = await Promise.all([
      fetch(`${LOCAL_WASM_URL}/vision_wasm_internal.js`, { method: "HEAD" }),
      fetch(LOCAL_MODEL_URL, { method: "HEAD" }),
    ]);
    if (w.ok && m.ok) return { wasm: LOCAL_WASM_URL, model: LOCAL_MODEL_URL };
  } catch {
    /* không có bản cục bộ -> CDN */
  }
  return { wasm: CDN_WASM_URL, model: CDN_MODEL_URL };
}

// Camera coordinates rarely use the full 0..1 range in practice. Expand the
// useful center region to the full screen so reaching UI edges doesn't require
// moving your hand to the physical edge of the camera frame.
const INPUT_RANGE = {
  xMin: 0.18,
  xMax: 0.82,
  yMin: 0.12,
  yMax: 0.82,
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function remapToScreen(value: number, min: number, max: number, size: number) {
  return clamp01((value - min) / (max - min)) * size;
}

const EMPTY_STATE: HandState = {
  active: false,
  present: false,
  point: null,
  gesture: "None",
  gestureScore: 0,
  pointing: false,
  openPalm: false,
  fist: false,
  pinchDistance: 0,
  hands: [],
  shush: false,
  pinch: false,
  swipe: null,
  zoom: null,
  grab: false,
};

/**
 * Camera hand tracking powered by MediaPipe GestureRecognizer.
 *
 * We rely on the edge ML model's canned classes instead of hand-written angle
 * heuristics. Supported classes include Closed_Fist, Open_Palm, Pointing_Up,
 * Thumb_Up, Thumb_Down, Victory, ILoveYou, and None.
 */
export const SYSTEM_DEFAULT_CAMERA = "default";

function videoConstraintsFor(deviceId: string): MediaTrackConstraints {
  if (!deviceId || deviceId === SYSTEM_DEFAULT_CAMERA) {
    return { width: 640, height: 480, facingMode: "user" };
  }
  return { width: 640, height: 480, deviceId: { exact: deviceId } };
}

/** V-18: thử deviceId đã lưu; camera đã bị rút (OverconstrainedError/NotFoundError) => facingMode "user"
 *  và báo `onInvalid` để xoá id đã lưu (trước đây lỗi lặp vĩnh viễn). */
async function getCamera(deviceId: string, onInvalid?: () => void): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: videoConstraintsFor(deviceId) });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    const isSaved = !!deviceId && deviceId !== SYSTEM_DEFAULT_CAMERA;
    if (isSaved && (name === "OverconstrainedError" || name === "NotFoundError")) {
      onInvalid?.();
      return navigator.mediaDevices.getUserMedia({ video: videoConstraintsFor(SYSTEM_DEFAULT_CAMERA) });
    }
    throw err;
  }
}

/** V-18: ưu tiên GPU; không được (driver/WebGL) thì thử lại bằng CPU. */
async function createRecognizer(
  fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  modelAssetPath: string,
): Promise<GestureRecognizer> {
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath, delegate },
    runningMode: "VIDEO" as const,
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
    cannedGesturesClassifierOptions: { scoreThreshold: 0.55 },
  });
  try {
    return await GestureRecognizer.createFromOptions(fileset, options("GPU"));
  } catch (gpuErr) {
    console.warn("[hand] GPU delegate failed, falling back to CPU:", gpuErr);
    return GestureRecognizer.createFromOptions(fileset, options("CPU"));
  }
}

function discreteKey(s: HandState): string {
  return [
    s.present, s.gesture, s.pointing, s.openPalm, s.fist, s.swipe, s.zoom, s.grab, s.shush, s.pinch,
    s.hands.map((h) => `${h.id}:${h.gesture}`).join(","),
  ].join("|");
}

export function useHandControl(
  enabled: boolean,
  deviceId: string = SYSTEM_DEFAULT_CAMERA,
  onDeviceInvalid?: () => void,
) {
  const [state, setStateRaw] = useState<HandState>(EMPTY_STATE);
  // Ported from myiris (second-brain-galaxy-view): VaultGalaxy's nav loop
  // reads hand data every rAF, not via React state/re-render — this ref
  // always mirrors `state`, updated through the same single setter below.
  const stateRef = useRef<HandState>(EMPTY_STATE);
  function setState(next: HandState) {
    stateRef.current = next;
    setStateRaw(next);
  }
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY_STATE);
      setStream(null);
      return;
    }

    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let recognizer: GestureRecognizer | null = null;
    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;

    let smooth: HandPoint | null = null;
    let primaryId = "";
    let primaryPoint: HandPoint | null = null;
    const stableGestureById = new Map<string, string>();
    const candidateGestureById = new Map<string, string>();
    const candidateFramesById = new Map<string, number>();
    let swipeHistory: { x: number; time: number }[] = [];
    let zoomHistory: { d: number; time: number }[] = [];

    // V-08: sau MỖI await kiểm `cancelled` và giải phóng NGAY tài nguyên vừa tạo — trước đây camera
    // vẫn được mở (đèn LED sáng mãi) và recognizer rò rỉ nếu effect bị cleanup giữa chừng.
    async function setup() {
      setError(null);
      try {
        const urls = await resolveAssetUrls();
        if (cancelled) return;
        const fileset = await FilesetResolver.forVisionTasks(urls.wasm);
        if (cancelled) return;
        recognizer = await createRecognizer(fileset, urls.model);
        if (cancelled) {
          recognizer.close();
          recognizer = null;
          return;
        }
        stream = await getCamera(deviceId, onDeviceInvalid);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
          return;
        }
        setStream(stream);
        setState({ ...EMPTY_STATE, active: true });
        loop();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    function stabilizeGesture(id: string, rawGesture: string) {
      const candidateGesture = candidateGestureById.get(id) ?? "None";
      const candidateFrames = candidateFramesById.get(id) ?? 0;
      if (rawGesture === candidateGesture) {
        candidateFramesById.set(id, Math.min(candidateFrames + 1, 8));
      } else {
        candidateGestureById.set(id, rawGesture);
        candidateFramesById.set(id, 1);
      }
      if ((candidateFramesById.get(id) ?? 0) >= 3) {
        stableGestureById.set(id, rawGesture);
      }
      return stableGestureById.get(id) ?? "None";
    }

    function nearestTo(point: HandPoint, hands: TrackedHand[]) {
      return hands.reduce((best, hand) => {
        const bestDistance = Math.hypot(best.point.x - point.x, best.point.y - point.y);
        const handDistance = Math.hypot(hand.point.x - point.x, hand.point.y - point.y);
        return handDistance < bestDistance ? hand : best;
      }, hands[0]);
    }

    function choosePrimary(hands: TrackedHand[]) {
      const pointingHands = hands.filter((hand) => hand.pointing);
      const previous = hands.find((hand) => hand.id === primaryId);

      // If only one hand is intentionally pointing, switch to it immediately.
      // This fixes the "wrong hand stays primary" issue when both hands are visible.
      if (pointingHands.length === 1) return pointingHands[0];

      // If both point, avoid flicker by keeping the existing primary if possible.
      if (pointingHands.length > 1) {
        const previousPointing = pointingHands.find((hand) => hand.id === primaryId);
        if (previousPointing) return previousPointing;
        if (primaryPoint) return nearestTo(primaryPoint, pointingHands);
        return pointingHands[0];
      }

      // No pointing hand: preserve continuity for scroll/resize/read states.
      if (previous) return previous;
      if (primaryPoint) return nearestTo(primaryPoint, hands);
      return hands[0];
    }

    // V-18: chạy theo khung hình CAMERA (rVFC ~30 fps) thay vì rAF 60 Hz, và bỏ qua khi khung không đổi.
    let lastVideoTime = -1;
    let videoCb = 0;
    let lastCommittedKey = "";
    let lastCommittedPoint: HandPoint | null = null;
    let lastCommitAt = 0;
    const hasRvfc = "requestVideoFrameCallback" in video;
    function schedule() {
      if (cancelled) return;
      if (hasRvfc) videoCb = video.requestVideoFrameCallback(() => loop());
      else raf = requestAnimationFrame(loop);
    }
    // stateRef luôn là bản mới nhất (cho các vòng rAF đọc trực tiếp); chỉ re-render React khi có thay đổi
    // đáng kể: cử chỉ rời rạc đổi, hoặc điểm di chuyển > 2px (tối đa ~30 Hz).
    function commitFrame(next: HandState, now: number) {
      stateRef.current = next;
      const key = discreteKey(next);
      const moved =
        !!next.point &&
        (!lastCommittedPoint ||
          Math.hypot(next.point.x - lastCommittedPoint.x, next.point.y - lastCommittedPoint.y) > 2);
      if (key !== lastCommittedKey || (moved && now - lastCommitAt >= 33)) {
        lastCommittedKey = key;
        lastCommittedPoint = next.point ? { ...next.point } : null;
        lastCommitAt = now;
        setStateRaw(next);
      }
    }

    function loop() {
      if (cancelled || !recognizer) return;
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const now = performance.now();
        const result = recognizer.recognizeForVideo(video, now);
        const landmarks = result.landmarks ?? [];
        const gestures = result.gestures ?? [];

        if (landmarks.length > 0) {
          const detected = landmarks.slice(0, 2).map((hand, index) => {
            const topGesture = gestures[index]?.[0];
            const score = topGesture?.score ?? 0;
            const rawGesture = score >= 0.55 ? topGesture?.categoryName ?? "None" : "None";
            const indexTip = hand[8];
            const thumbTip = hand[4];
            const mirroredX = 1 - indexTip.x;
            const point = {
              x: remapToScreen(mirroredX, INPUT_RANGE.xMin, INPUT_RANGE.xMax, window.innerWidth),
              y: remapToScreen(indexTip.y, INPUT_RANGE.yMin, INPUT_RANGE.yMax, window.innerHeight),
            };
            const pinchDistance = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
            return {
              rawGesture,
              score,
              point,
              landmarks: hand.map((landmark) => ({ x: 1 - landmark.x, y: landmark.y })),
              pinchDistance,
            };
          });

          // V-18: id theo handedness của model (không theo vị trí X nên không đổi chỗ khi hai tay bắt chéo).
          const usedIds = new Set<string>();
          const hands: TrackedHand[] = detected.map((hand, index) => {
            const label = (result.handedness?.[index]?.[0]?.categoryName || "").toLowerCase();
            let id = label === "left" || label === "right" ? label : `hand${index}`;
            if (usedIds.has(id)) id = `${id}${index}`; // hai tay cùng nhãn: tách để không trộn trạng thái
            usedIds.add(id);
            const gesture = stabilizeGesture(id, hand.rawGesture);
            return {
              id,
              point: hand.point,
              landmarks: hand.landmarks,
              gesture,
              gestureScore: hand.score,
              pointing: gesture === "Pointing_Up",
              openPalm: gesture === "Open_Palm",
              fist: gesture === "Closed_Fist",
              pinchDistance: hand.pinchDistance,
            };
          });

          const primary = choosePrimary(hands);
          primaryId = primary.id;
          smooth = smooth
            ? {
                x: smooth.x + (primary.point.x - smooth.x) * 0.5,
                y: smooth.y + (primary.point.y - smooth.y) * 0.5,
              }
            : primary.point;
          primaryPoint = smooth;

          const shush =
            primary.pointing &&
            primary.point.y < window.innerHeight * 0.4 &&
            primary.point.x > window.innerWidth * 0.3 &&
            primary.point.x < window.innerWidth * 0.7;

          const pinch = hands.length === 2 && hands.every((h) => h.pinchDistance < 0.05);

          let swipe: "left" | "right" | null = null;
          if (primary.openPalm) {
            swipeHistory.push({ x: primary.point.x, time: now });
            // Hard cap: prevent unbounded growth when Open_Palm is held for
            // a long time at 60fps (could otherwise reach ~18k entries/min).
            if (swipeHistory.length > 120) swipeHistory = swipeHistory.slice(-60);
            swipeHistory = swipeHistory.filter((h) => now - h.time < 500);

            if (swipeHistory.length > 5) {
              const dx = swipeHistory[swipeHistory.length - 1].x - swipeHistory[0].x;
              const dt = swipeHistory[swipeHistory.length - 1].time - swipeHistory[0].time;
              if (dt > 100 && Math.abs(dx) > window.innerWidth * 0.4) {
                swipe = dx > 0 ? "right" : "left";
                swipeHistory = [];
              }
            }
          } else {
            swipeHistory = [];
          }

          let zoom: "in" | "out" | null = null;
          if (hands.length === 2 && hands.every(h => h.openPalm || h.pointing || h.fist)) {
            const d = Math.hypot(hands[0].point.x - hands[1].point.x, hands[0].point.y - hands[1].point.y);
            zoomHistory.push({ d, time: now });
            if (zoomHistory.length > 120) zoomHistory = zoomHistory.slice(-60);
            zoomHistory = zoomHistory.filter((h) => now - h.time < 500);

            if (zoomHistory.length > 5) {
              const dd = zoomHistory[zoomHistory.length - 1].d - zoomHistory[0].d;
              const dt = zoomHistory[zoomHistory.length - 1].time - zoomHistory[0].time;
              if (dt > 100 && Math.abs(dd) > window.innerWidth * 0.15) {
                zoom = dd > 0 ? "in" : "out";
                zoomHistory = [];
              }
            }
          } else {
            zoomHistory = [];
          }

          const grab = primary.fist;

          commitFrame({
            active: true,
            present: true,
            point: smooth,
            gesture: primary.gesture,
            gestureScore: primary.gestureScore,
            pointing: primary.pointing,
            openPalm: primary.openPalm,
            fist: primary.fist,
            pinchDistance: primary.pinchDistance,
            hands: hands.map((item) => (item === primary ? { ...item, point: smooth! } : item)),
            shush,
            pinch,
            swipe,
            zoom,
            grab,
          }, now);
        } else {
          smooth = null;
          primaryId = "";
          primaryPoint = null;
          stableGestureById.clear();
          candidateGestureById.clear();
          candidateFramesById.clear();
          commitFrame({ ...EMPTY_STATE, active: true }, now);
        }
      }
      schedule();
    }

    setup();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (hasRvfc && videoCb) video.cancelVideoFrameCallback(videoCb);
      recognizer?.close();
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      setStream(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, deviceId]);

  return { state, error, stream, stateRef };
}
