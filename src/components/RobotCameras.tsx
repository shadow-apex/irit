import { useEffect, useRef, useState } from "react";
import { X, Bot, RefreshCw, WifiOff, Maximize2, Minimize2 } from "lucide-react";
import DraggablePiP from "./DraggablePiP";

// Khoảng thời gian refresh ảnh camera (3 giây)
// Đủ nhanh để thấy sự thay đổi mà không flood network
const REFRESH_INTERVAL_MS = 3_000;

// FIX-CAM-03: Phân biệt URL "stream" (MJPEG multipart, VD ESP32-CAM
// ":81/stream") với URL "snapshot" (1 ảnh JPEG tĩnh, VD mock robot dùng
// picsum.photos). Bản gốc coi mọi camera_url như nhau: cứ mỗi 3 giây lại
// remount <img> với timestamp mới để "phá cache". Với snapshot điều đó đúng,
// nhưng với 1 stream MJPEG thật thì đây là lỗi kiến trúc — trình duyệt vốn
// đã giữ SẴN 1 kết nối TCP mở liên tục để nhận nhiều frame; việc hủy/tạo lại
// <img> mỗi 3s buộc phải đóng rồi mở lại kết nối đó liên tục, gây giật hình
// và có thể làm quá tải ESP32-CAM (phần cứng rất yếu, chỉ chịu được rất ít
// kết nối HTTP đồng thời — đây chính là kiểu "tự DDoS" camera của chính mình).
function isStreamUrl(url: string): boolean {
  return /:81(\/|$)/.test(url) || /\/stream(\?|$)/i.test(url);
}

// ============================================================
// NEW: Bảng Điều Khiển Cánh Tay Robot
// ============================================================
// Chỉ hiển thị cho robot có config.has_arm === true (xem robots.json).
// Gửi lệnh "arm_move" qua cùng kênh IPC/HTTP đã dùng cho WASD
// (window.iris.triggerRobotAction), main.mjs sẽ forward xuống control_url.
type ArmAngles = { base: number; shoulder: number; elbow: number; gripper: number };

const ARM_DEFAULT_ANGLES: ArmAngles = { base: 90, shoulder: 90, elbow: 90, gripper: 90 };
// ARM-01: Throttle gửi lệnh khi kéo slider. Sự kiện onChange của <input
// type="range"> bắn RẤT nhiều lần/giây khi kéo — gửi HTTP cho mỗi lần bắn
// sẽ dội hàng chục request/giây xuống robot, dễ làm nghẽn WebServer yếu
// trên ESP32 (đúng kiểu rủi ro flood đã nói ở phần WASD). Throttle 120ms
// vẫn đủ mượt để mắt người thấy cánh tay di chuyển liên tục.
const ARM_SEND_THROTTLE_MS = 120;

function ArmControlPanel({ robotId }: { robotId: string }) {
  const [angles, setAngles] = useState<ArmAngles>(ARM_DEFAULT_ANGLES);
  const lastSentAtRef = useRef(0);
  const pendingRef = useRef<ArmAngles | null>(null);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ARM-02: Reset về vị trí giữa (90°, an toàn) mỗi khi chuyển sang điều
  // khiển robot khác — tránh trường hợp góc của robot A "rò" sang UI/state
  // của robot B nếu người dùng phóng to lần lượt nhiều robot.
  useEffect(() => {
    setAngles(ARM_DEFAULT_ANGLES);
  }, [robotId]);

  useEffect(() => {
    return () => {
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    };
  }, []);

  const sendNow = (next: ArmAngles) => {
    lastSentAtRef.current = Date.now();
    window.iris?.triggerRobotAction?.({
      robot_id: robotId,
      action: "arm_move",
      params: next,
    }).catch((err: any) => {
      console.error("[ArmControlPanel] Loi gui lenh canh tay:", err);
    });
  };

  const scheduleSend = (next: ArmAngles) => {
    pendingRef.current = next;
    const elapsed = Date.now() - lastSentAtRef.current;
    if (elapsed >= ARM_SEND_THROTTLE_MS) {
      sendNow(next);
      pendingRef.current = null;
    } else if (!throttleTimerRef.current) {
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
        if (pendingRef.current) {
          sendNow(pendingRef.current);
          pendingRef.current = null;
        }
      }, ARM_SEND_THROTTLE_MS - elapsed);
    }
  };

  const handleChange = (joint: keyof ArmAngles, value: number) => {
    // ARM-03: Kẹp góc 0-180 ngay tại UI (lớp bảo vệ đầu tiên; main.mjs kẹp
    // lại lần nữa làm lớp thứ hai — xem FIX-ARM-01 trong main.mjs).
    const clamped = Math.max(0, Math.min(180, value));
    const next = { ...angles, [joint]: clamped };
    setAngles(next);
    scheduleSend(next);
  };

  // ARM-04: Vị trí CUỐI CÙNG khi thả chuột/thả tay luôn được gửi ngay lập
  // tức, bỏ qua throttle — vì đây là vị trí "nghỉ" thật sự, không thể chấp
  // nhận việc throttle làm rớt mất giá trị cuối (đặc biệt với gripper: kẹp
  // hụt 1-2 độ có thể làm rơi vật đang gắp).
  const handleCommit = () => {
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    sendNow(angles);
    pendingRef.current = null;
  };

  const joints: Array<{ key: keyof ArmAngles; label: string }> = [
    { key: "base", label: "Base" },
    { key: "shoulder", label: "Shoulder" },
    { key: "elbow", label: "Elbow" },
    { key: "gripper", label: "Gripper" },
  ];

  return (
    <div
      style={{
        padding: "10px 14px",
        borderTop: "1px solid #222",
        backgroundColor: "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        flexShrink: 0,
      }}
      // Chặn click trên panel để không kích hoạt onClick "thu nhỏ" của thẻ camera cha
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 11, color: "#888", fontWeight: 600, letterSpacing: 0.5 }}>
        ĐIỀU KHIỂN CÁNH TAY
      </div>
      {joints.map(({ key, label }) => (
        <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#aaa", width: 62 }}>{label}</span>
          <input
            type="range"
            min={0}
            max={180}
            value={angles[key]}
            onChange={(e) => handleChange(key, Number(e.target.value))}
            onMouseUp={handleCommit}
            onTouchEnd={handleCommit}
            style={{ flex: 1, accentColor: "rgb(40, 205, 170)" }}
          />
          <span style={{ fontSize: 11, color: "#ddd", width: 32, textAlign: "right" }}>
            {angles[key]}°
          </span>
        </div>
      ))}
    </div>
  );
}

export default function RobotCameras({ onClose }: { onClose: () => void }) {
  const [robots, setRobots] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Dùng Date.now() timestamp thay vì counter để phá cache tuyệt đối.
  // Counter (0,1,2...) có thể bị browser cache nếu cùng URL đã được lưu trước đó.
  const [timestamp, setTimestamp] = useState(() => Date.now());
  // BUG-CAM-02 FIX: Track lỗi img per-robot bằng map, tránh conflict DOM
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  // FIX-CAM-04: đếm số lần "thử lại" riêng cho camera dạng stream. Vì
  // camera_url của stream không đổi theo timestamp (FIX-CAM-03), trình
  // duyệt sẽ KHÔNG mở lại kết nối nếu chỉ đổi key rồi lại giữ nguyên src —
  // ta cần một giá trị thực sự khác đi (retry tick) để buộc remount + kết
  // nối lại mỗi khi camera đó đang lỗi.
  const [streamRetryTick, setStreamRetryTick] = useState<Record<string, number>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Lấy danh sách robots từ main process khi component mount.
  // Có error handling để không bị trống vĩnh viễn nếu IPC lỗi.
  useEffect(() => {
    if (window.iris?.getRobots) {
      window.iris
        .getRobots()
        .then((data: any) => {
          // Đảm bảo data là object hợp lệ, không phải null/undefined
          setRobots(data && typeof data === "object" ? data : {});
        })
        .catch((err: any) => {
          console.error("[RobotCameras] Lỗi khi lấy robots config:", err);
          setLoadError(true);
          setRobots({});
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      // window.iris chưa sẵn sàng (dev mode) — không crash
      setLoading(false);
    }
  }, []);

  // Refresh timestamp mỗi 3 giây để force reload ảnh.
  // Đồng thời reset imgErrors để camera vừa offline có cơ hội được thử lại.
  useEffect(() => {
    const id = setInterval(() => {
      setTimestamp(Date.now()); // Timestamp thật → phá cache tuyệt đối (dùng cho snapshot)
      // BUG-CAM-02 FIX + FIX-CAM-04: reset để retry camera offline. Với các
      // camera đang lỗi VÀ là stream, tăng retryTick riêng của chúng để ép
      // remount <img> (đổi key) dù URL gốc không đổi — nếu không, ảnh lỗi sẽ
      // đứng yên vĩnh viễn vì trình duyệt không có lý do để tải lại.
      setImgErrors((prev) => {
        const erroredIds = Object.keys(prev).filter((key) => prev[key]);
        if (erroredIds.length > 0) {
          setStreamRetryTick((prevTicks) => {
            const next = { ...prevTicks };
            erroredIds.forEach((robotId) => {
              next[robotId] = (next[robotId] || 0) + 1;
            });
            return next;
          });
        }
        return {};
      });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Keyboard Control (WASD)
  //
  // FIX-CAM-01: Arduino/ESP32 phía firmware giờ có failsafe watchdog — nếu
  // không nhận được lệnh nào trong ~400ms sẽ TỰ ĐỘNG DỪNG (an toàn khi mất
  // kết nối). Nhưng bản gốc chỉ gửi 1 lệnh DUY NHẤT lúc keydown rồi im lặng
  // trong lúc giữ phím -> nếu giữ W lâu hơn 400ms, robot sẽ tự dừng dù người
  // dùng vẫn đang giữ phím! Giải pháp: khi có phím đang giữ, gửi lại
  // (heartbeat) cùng 1 action mỗi 150ms — vừa nuôi watchdog phía firmware,
  // vừa không đổi hành vi gửi 1 lần khi vừa nhấn/nhả.
  const ROBOT_HEARTBEAT_MS = 150;

  useEffect(() => {
    if (!expandedId || !window.iris?.triggerRobotAction) return;

    const activeKeys = new Set<string>();
    let heartbeatId: ReturnType<typeof setInterval> | null = null;

    const keyToAction = (key: string) => {
      if (key === 'w') return "forward";
      if (key === 's') return "backward";
      if (key === 'a') return "left";
      if (key === 'd') return "right";
      return "";
    };

    // FIX-CAM-02: mọi lệnh gửi đi đều .catch() — trước đây promise của
    // triggerRobotAction bị bỏ trống, lỗi IPC/network sẽ trở thành
    // "unhandled promise rejection" âm thầm, không ai biết lệnh có gửi
    // được hay không.
    const sendAction = (action: string) => {
      window.iris.triggerRobotAction?.({ robot_id: expandedId, action })?.catch((err: any) => {
        console.error("[RobotCameras] Loi gui lenh dieu khien:", err);
      });
    };

    const currentAction = () => {
      if (activeKeys.size === 0) return "stop";
      // Fallback to the remaining/most-recent active key
      const remainingKey = Array.from(activeKeys)[activeKeys.size - 1];
      return keyToAction(remainingKey);
    };

    const stopHeartbeat = () => {
      if (heartbeatId) {
        clearInterval(heartbeatId);
        heartbeatId = null;
      }
    };

    const startHeartbeat = () => {
      if (heartbeatId) return;
      heartbeatId = setInterval(() => {
        if (activeKeys.size === 0) {
          stopHeartbeat();
          return;
        }
        sendAction(currentAction());
      }, ROBOT_HEARTBEAT_MS);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!['w', 'a', 's', 'd'].includes(key)) return;
      if (activeKeys.has(key)) return; // Prevent auto-repeat spam

      activeKeys.add(key);
      sendAction(keyToAction(key));
      startHeartbeat();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!['w', 'a', 's', 'd'].includes(key)) return;

      activeKeys.delete(key);
      if (activeKeys.size === 0) {
        stopHeartbeat();
        sendAction("stop");
      } else {
        // Fallback to the remaining active key (e.g. released W but still holding A)
        sendAction(currentAction());
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      stopHeartbeat();
      sendAction("stop");
    };
  }, [expandedId]);

  const robotList = Object.entries(robots);

  return (
    <DraggablePiP
      title={
        <>
          <Bot size={16} style={{ color: "rgb(40, 205, 170)" }} />
          Live: Đội Hình Robot
        </>
      }
      onClose={onClose}
      defaultPosition={{ x: 20, y: 80 }}
      defaultSize={{ width: 400, height: 300 }}
    >
      <div
        style={{
          padding: 16,
          display: expandedId ? "flex" : "grid",
          flexDirection: "column",
          gridTemplateColumns: expandedId ? undefined : "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
          height: expandedId ? "100%" : "auto",
          boxSizing: "border-box"
        }}
      >
        {/* Trạng thái đang tải */}
        {loading && (
          <div
            style={{
              color: "#888",
              textAlign: "center",
              gridColumn: "1/-1",
              paddingTop: 40,
              fontSize: 14,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <RefreshCw size={20} style={{ animation: "spin 1s linear infinite", color: "rgb(40, 205, 170)" }} />
            Đang tải danh sách robot...
          </div>
        )}

        {/* Lỗi khi load config */}
        {!loading && loadError && (
          <div
            style={{
              color: "#f66",
              textAlign: "center",
              gridColumn: "1/-1",
              paddingTop: 40,
              fontSize: 13,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <WifiOff size={20} />
            Không đọc được robots.json.
            <span style={{ fontSize: 11, color: "#555" }}>
              Kiểm tra file robots.json tại thư mục gốc.
            </span>
          </div>
        )}

        {/* Chưa cấu hình robot nào */}
        {!loading && !loadError && robotList.length === 0 && (
          <div
            style={{
              color: "#888",
              textAlign: "center",
              gridColumn: "1/-1",
              paddingTop: 40,
              fontSize: 14,
            }}
          >
            Chưa có cấu hình robot nào trong file <code>robots.json</code>.<br />
            <span style={{ fontSize: 12, color: "#555", marginTop: 8, display: "block" }}>
              Thêm robot vào <code>robots.json</code> tại thư mục gốc.
            </span>
          </div>
        )}

        {/* Danh sách camera từng robot */}
        {!loading &&
          !loadError &&
          robotList.map(([id, config]: any) => {
            if (expandedId && expandedId !== id) return null;

            const hasUrl = Boolean(config?.camera_url);
            const isStream = hasUrl && isStreamUrl(config.camera_url);

            // FIX-CAM-03 (tiếp): chỉ phá cache bằng timestamp cho snapshot.
            // Stream giữ nguyên URL gốc, không đổi theo mỗi tick refresh.
            const imgUrl = hasUrl
              ? isStream
                ? config.camera_url
                : `${config.camera_url}${config.camera_url.includes("?") ? "&" : "?"}ts=${timestamp}`
              : "";

            const hasError = imgErrors[id] === true;

            return (
              <div
                key={id}
                style={{
                  backgroundColor: "#000",
                  borderRadius: 8,
                  overflow: "hidden",
                  border: "1px solid #333",
                  display: "flex",
                  flexDirection: "column",
                  flex: expandedId === id ? 1 : undefined,
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
                onClick={() => setExpandedId(expandedId === id ? null : id)}
                title={expandedId === id ? "Thu nhỏ" : "Phóng to"}
              >
                {/* Thanh tiêu đề mỗi camera */}
                <div
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid #222",
                    fontSize: 13,
                    fontWeight: "600",
                    color: "#ddd",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>{config?.name || id} {expandedId === id && <span style={{ color: '#4ade80', fontSize: 11, marginLeft: 8 }}>(WASD to move)</span>}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        fontSize: 11,
                        color: hasError || !hasUrl ? "#f66" : "#4c8",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <RefreshCw size={10} />
                      {!hasUrl ? "Chưa cấu hình" : hasError ? "Offline" : "Live"}
                    </span>
                    {expandedId === id ? <Minimize2 size={14} color="#aaa" /> : <Maximize2 size={14} color="#aaa" />}
                  </div>
                </div>

                {/* Vùng hiển thị camera */}
                <div
                  style={{
                    minHeight: 180,
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#050505",
                    position: "relative",
                  }}
                >
                  {/* Hiển thị ảnh camera nếu có URL và không lỗi.
                      Key thay đổi mỗi khi timestamp đổi → force React re-mount img
                      → trình duyệt fetch ảnh mới hoàn toàn thay vì dùng cache. */}
                  {hasUrl && !hasError && (
                    <img
                      key={isStream ? `${id}-stream-${streamRetryTick[id] || 0}` : `${id}-${timestamp}`}
                      src={imgUrl}
                      alt={config?.name || id}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        position: "absolute",
                        inset: 0,
                      }}
                      onError={() =>
                        setImgErrors((prev) => ({ ...prev, [id]: true }))
                      }
                    />
                  )}

                  {/* Fallback UI khi không có URL hoặc camera offline */}
                  {(!hasUrl || hasError) && (
                    <div
                      style={{
                        color: "#555",
                        fontSize: 12,
                        zIndex: 10,
                        textAlign: "center",
                        padding: "0 16px",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <WifiOff size={20} style={{ color: "#444" }} />
                      {hasUrl
                        ? "Không thể tải Camera... (đang thử lại)"
                        : "Không có Camera URL"}
                    </div>
                  )}
                </div>

                {/* Bảng điều khiển cánh tay — chỉ hiện khi đang phóng to VÀ
                    robot có has_arm: true trong robots.json (không phải mọi
                    robot điều khiển được đều có cánh tay, VD usb_robot_1 chỉ
                    có bánh xe). */}
                {expandedId === id && config?.has_arm === true && (
                  <ArmControlPanel robotId={id} />
                )}
              </div>
            );
          })}
      </div>

      {/* Animation cho spinner loading */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </DraggablePiP>
  );
}
