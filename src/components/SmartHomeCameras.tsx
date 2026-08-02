import { useEffect, useState } from "react";
import { Home, RefreshCw, WifiOff, Maximize2, Minimize2 } from "lucide-react";
import DraggablePiP from "./DraggablePiP";

// FEAT-SH-CAM-01: Smart Home Camera Vision UI — nhân bản đúng cấu trúc
// RobotCameras.tsx (snapshot refresh 3s / giữ nguyên <img> cho MJPEG,
// DraggablePiP, xử lý lỗi WifiOff) nhưng đọc từ smarthome_cameras.json thay
// vì robots.json, và KHÔNG có phần điều khiển cánh tay/WASD (đó là
// robot-only — camera nhà thông minh không di chuyển được).

const REFRESH_INTERVAL_MS = 3_000;

// Cùng ý tưởng isStreamUrl() của RobotCameras.tsx, nhưng nhận thêm field
// "stream" tường minh từ config (nếu có) — vì camera ESPHome
// (esp32_camera_web_server, xem setupsmarthome/myiris_smarthome_camera.yaml)
// phục vụ MJPEG stream ngay ở path gốc "/" (VD "http://<ip>:8080/"), không
// khớp quy ước đoán ":81" hay "/stream" mà robots.json vẫn dùng. Khi
// "stream" được set rõ ràng trong smarthome_cameras.json, ưu tiên dùng nó;
// nếu không có, fallback về đoán qua hình dạng URL như cũ.
function isStreamUrl(url: string, explicitStream?: boolean): boolean {
  if (typeof explicitStream === "boolean") return explicitStream;
  return /:81(\/|$)/.test(url) || /\/stream(\?|$)/i.test(url);
}

export default function SmartHomeCameras({ onClose }: { onClose: () => void }) {
  const [cameras, setCameras] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [timestamp, setTimestamp] = useState(() => Date.now());
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [streamRetryTick, setStreamRetryTick] = useState<Record<string, number>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Lấy danh sách camera nhà thông minh từ main process khi component mount.
  useEffect(() => {
    if (window.iris?.getSmartHomeCamerasConfig) {
      window.iris
        .getSmartHomeCamerasConfig()
        .then((data: any) => {
          setCameras(data && typeof data === "object" ? data : {});
        })
        .catch((err: any) => {
          console.error("[SmartHomeCameras] Lỗi khi lấy config camera:", err);
          setLoadError(true);
          setCameras({});
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      // window.iris chưa sẵn sàng (dev mode) — không crash
      setLoading(false);
    }
  }, []);

  // Refresh timestamp mỗi 3 giây để force reload ảnh (snapshot), đồng thời
  // reset imgErrors để camera vừa offline có cơ hội được thử lại; với
  // camera đang lỗi VÀ là stream, tăng retryTick riêng để ép remount.
  useEffect(() => {
    const id = setInterval(() => {
      setTimestamp(Date.now());
      setImgErrors((prev) => {
        const erroredIds = Object.keys(prev).filter((key) => prev[key]);
        if (erroredIds.length > 0) {
          setStreamRetryTick((prevTicks) => {
            const next = { ...prevTicks };
            erroredIds.forEach((camId) => {
              next[camId] = (next[camId] || 0) + 1;
            });
            return next;
          });
        }
        return {};
      });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const manualRefresh = () => {
    setTimestamp(Date.now());
    setImgErrors({});
    setStreamRetryTick((prev) => {
      const next: Record<string, number> = {};
      Object.keys(prev).forEach((camId) => {
        next[camId] = (prev[camId] || 0) + 1;
      });
      return next;
    });
  };

  const cameraList = Object.entries(cameras);

  return (
    <DraggablePiP
      title={
        <>
          <Home size={16} style={{ color: "rgb(40, 205, 170)" }} />
          Live: Camera Nhà Thông Minh
        </>
      }
      onClose={onClose}
      defaultPosition={{ x: 20, y: 400 }}
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
        {/* Nút refresh thủ công + Trạng thái đang tải */}
        {!loading && !loadError && cameraList.length > 0 && (
          <div
            style={{
              gridColumn: "1/-1",
              display: "flex",
              justifyContent: "flex-end",
              marginBottom: -8,
            }}
          >
            <button
              onClick={manualRefresh}
              title="Làm mới thủ công"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "none",
                border: "1px solid #333",
                borderRadius: 6,
                color: "#aaa",
                fontSize: 11,
                padding: "4px 8px",
                cursor: "pointer",
              }}
            >
              <RefreshCw size={11} /> Làm mới
            </button>
          </div>
        )}

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
            Đang tải danh sách camera...
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
            Không đọc được smarthome_cameras.json.
            <span style={{ fontSize: 11, color: "#555" }}>
              Kiểm tra file smarthome_cameras.json tại thư mục gốc.
            </span>
          </div>
        )}

        {/* Chưa cấu hình camera nào */}
        {!loading && !loadError && cameraList.length === 0 && (
          <div
            style={{
              color: "#888",
              textAlign: "center",
              gridColumn: "1/-1",
              paddingTop: 40,
              fontSize: 14,
            }}
          >
            Chưa có cấu hình camera nào trong file <code>smarthome_cameras.json</code>.<br />
            <span style={{ fontSize: 12, color: "#555", marginTop: 8, display: "block" }}>
              Thêm camera vào <code>smarthome_cameras.json</code> tại thư mục gốc — xem ví dụ
              ESPHome trong <code>setupsmarthome/myiris_smarthome_camera.yaml</code>.
            </span>
          </div>
        )}

        {/* Danh sách camera nhà thông minh */}
        {!loading &&
          !loadError &&
          cameraList.map(([id, config]: any) => {
            if (expandedId && expandedId !== id) return null;

            const hasUrl = Boolean(config?.camera_url);
            const isStream = hasUrl && isStreamUrl(config.camera_url, config?.stream);

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
                  <span>{config?.name || id}</span>
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
              </div>
            );
          })}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </DraggablePiP>
  );
}
