import { useEffect, useState } from "react";
import { X, Bot, RefreshCw, WifiOff } from "lucide-react";
import DraggablePiP from "./DraggablePiP";

// Khoảng thời gian refresh ảnh camera (3 giây)
// Đủ nhanh để thấy sự thay đổi mà không flood network
const REFRESH_INTERVAL_MS = 3_000;

export default function RobotCameras({ onClose }: { onClose: () => void }) {
  const [robots, setRobots] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Dùng Date.now() timestamp thay vì counter để phá cache tuyệt đối.
  // Counter (0,1,2...) có thể bị browser cache nếu cùng URL đã được lưu trước đó.
  const [timestamp, setTimestamp] = useState(() => Date.now());
  // BUG-CAM-02 FIX: Track lỗi img per-robot bằng map, tránh conflict DOM
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

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
      setTimestamp(Date.now()); // Timestamp thật → phá cache tuyệt đối
      setImgErrors({}); // BUG-CAM-02 FIX: reset để retry camera offline
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

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
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
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
            // Thêm timestamp thật vào URL để phá cache trình duyệt.
            // Dùng Date.now() thay vì counter để đảm bảo URL luôn unique tuyệt đối.
            const imgUrl = config?.camera_url
              ? `${config.camera_url}${config.camera_url.includes("?") ? "&" : "?"}ts=${timestamp}`
              : "";

            const hasError = imgErrors[id] === true;
            const hasUrl = Boolean(config?.camera_url);

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
                }}
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
                </div>

                {/* Vùng hiển thị camera */}
                <div
                  style={{
                    minHeight: 180,
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
                      key={`${id}-${timestamp}`}
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
