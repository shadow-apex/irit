import { useEffect, useRef, useState, useCallback } from "react";
import {
  X,
  FolderOpen,
  ArrowLeft,
  Clock,
  History,
  Calendar,
  FileText,
  Mic,
  Square,
  Loader2,
  Timer,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MeetingHistoryModalProps {
  onClose: () => void;
}

function formatDuration(sec: number | undefined): string {
  if (!sec || sec <= 0) return "00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDurationHuman(sec: number | undefined): string {
  if (!sec || sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  if (m > 0) {
    return `${m}p ${s}s`;
  }
  return `${s}s`;
}

export default function MeetingHistoryModal({ onClose }: MeetingHistoryModalProps) {
  const [history, setHistory] = useState<MeetingHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<MeetingHistoryItem | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(3);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Trạng thái ghi âm thời gian thực của Sidecar
  const [recordingState, setRecordingState] = useState<{
    isRecording: boolean;
    isSummarizing?: boolean;
    statusText?: string;
    startTime?: number | null;
    elapsedSeconds?: number;
  }>({ isRecording: false, isSummarizing: false, statusText: "" });

  // Live timer đếm từng giây khi đang ghi âm
  const [liveElapsedSeconds, setLiveElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!recordingState.isRecording || !recordingState.startTime) {
      setLiveElapsedSeconds(0);
      return;
    }
    const update = () => {
      const diff = Math.max(0, Math.floor((Date.now() - (recordingState.startTime || Date.now())) / 1000));
      setLiveElapsedSeconds(diff);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [recordingState.isRecording, recordingState.startTime]);

  // Theo dõi thời gian không hoạt động để tự ẩn sau 3 giây (như HUD Alt+M)
  const lastActiveRef = useRef<number>(Date.now());
  const resetInactivity = useCallback(() => {
    lastActiveRef.current = Date.now();
    setRemainingSeconds(3);
  }, []);

  const handleClose = useCallback(() => {
    if (window.iris?.closeMeetingHistory) {
      window.iris.closeMeetingHistory().catch(() => {});
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    resetInactivity();
    const interval = window.setInterval(() => {
      // Khi đang ghi âm hoặc đang gỡ băng & tóm tắt AI: giữ Hub luôn mở, không tự động đóng
      if (processingId || recordingState.isSummarizing || recordingState.isRecording) {
        lastActiveRef.current = Date.now();
        setRemainingSeconds(3);
        return;
      }
      const elapsed = Date.now() - lastActiveRef.current;
      const left = Math.max(0, 3000 - elapsed);
      const secs = Math.ceil(left / 1000);
      setRemainingSeconds(secs);
      if (left <= 0) {
        handleClose();
      }
    }, 200);

    return () => window.clearInterval(interval);
  }, [handleClose, resetInactivity, processingId, recordingState.isSummarizing, recordingState.isRecording]);

  // Cập nhật trạng thái ghi âm định kỳ khi Hub đang mở
  const refreshRecordingState = useCallback(async () => {
    if (window.iris?.getMeetingRecordingState) {
      try {
        const state = await window.iris.getMeetingRecordingState();
        setRecordingState(state);
      } catch {}
    }
  }, []);

  useEffect(() => {
    refreshRecordingState();
    const interval = window.setInterval(refreshRecordingState, 600);
    return () => window.clearInterval(interval);
  }, [refreshRecordingState]);

  // Tải danh sách lịch sử các phiên họp từ Main Process
  const loadHistory = useCallback(() => {
    if (window.iris?.getMeetingHistory) {
      window.iris
        .getMeetingHistory()
        .then((items) => {
          setHistory(items || []);
          setLoading(false);
        })
        .catch((err) => {
          console.error("Lỗi khi tải lịch sử tóm tắt:", err);
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Bật/tắt ghi âm trực tiếp ngay trên Hub
  const handleToggleRecording = async () => {
    resetInactivity();
    if (recordingState.isSummarizing) return;
    if (window.iris?.toggleMeetingRecording) {
      await window.iris.toggleMeetingRecording();
      await refreshRecordingState();
      loadHistory();
    }
  };

  // Xử lý khi nhấp vào một phiên họp trong lịch sử:
  // - Nếu đã có tóm tắt: mở xem chi tiết
  // - Nếu chưa có tóm tắt: bắt đầu phân tích âm thanh & tạo tóm tắt AI
  const handleItemClick = async (item: MeetingHistoryItem) => {
    resetInactivity();
    setActionError(null);

    if (item.hasSummary) {
      setSelectedSession(item);
      return;
    }

    if (!item.hasWav && !item.wavPath) {
      setActionError("Phiên họp này không có file âm thanh (.wav) để tóm tắt.");
      return;
    }

    if (processingId || recordingState.isSummarizing) {
      return;
    }

    setProcessingId(item.id);
    try {
      if (window.iris?.summarizeMeetingSession) {
        const res = await window.iris.summarizeMeetingSession(item.wavPath || item.folderPath);
        if (res.status === "success") {
          // Tải lại danh sách lịch sử mới nhất
          if (window.iris?.getMeetingHistory) {
            const updated = await window.iris.getMeetingHistory();
            setHistory(updated || []);
            const found = updated?.find((x) => x.id === item.id);
            if (found && found.hasSummary) {
              setSelectedSession(found);
            }
          }
        } else {
          setActionError(res.error || "Không thể tạo tóm tắt cuộc họp.");
        }
      }
    } catch (err: any) {
      setActionError(err?.message || "Lỗi khi tạo tóm tắt cuộc họp.");
    } finally {
      setProcessingId(null);
    }
  };

  // Phím Escape để quay lại hoặc đóng
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      resetInactivity();
      if (e.key === "Escape") {
        if (selectedSession) {
          setSelectedSession(null);
        } else {
          handleClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose, selectedSession, resetInactivity]);

  // Mở thư mục bằng 1 click (shell.openPath), không hiển thị đường dẫn thô
  const handleOpenFolder = (e: React.MouseEvent, folderPath: string) => {
    e.stopPropagation();
    resetInactivity();
    if (window.iris?.openMeetingFolder) {
      window.iris.openMeetingFolder(folderPath);
    }
  };

  return (
    <div
      className="meeting-history-modal hud-hit"
      onMouseMove={resetInactivity}
      onMouseDown={resetInactivity}
      onClick={resetInactivity}
      onScroll={resetInactivity}
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 760,
        maxWidth: "92vw",
        height: 560,
        maxHeight: "86vh",
        background: "linear-gradient(180deg, rgba(14, 23, 38, 0.95), rgba(7, 11, 19, 0.98))",
        border: "1px solid rgba(52, 211, 153, 0.28)",
        borderRadius: 16,
        boxShadow: "0 25px 60px rgba(0, 0, 0, 0.75), inset 0 1px 0 rgba(255, 255, 255, 0.12)",
        display: "flex",
        flexDirection: "column",
        zIndex: 999,
        color: "#e2e8f0",
        fontFamily: "var(--font-sans, system-ui, -apple-system, sans-serif)",
        pointerEvents: "auto",
        backdropFilter: "blur(18px)",
        overflow: "hidden",
      }}
    >
      {/* 1. Header Hub */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          background: "rgba(255, 255, 255, 0.02)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {selectedSession ? (
            <button
              onClick={() => {
                resetInactivity();
                setSelectedSession(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: 6,
                color: "#e2e8f0",
                fontSize: 12,
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              <ArrowLeft size={14} /> Quay lại danh sách
            </button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: "rgba(52, 211, 153, 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Mic size={16} color="#34d399" />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#f8fafc", letterSpacing: "0.3px" }}>
                  HUB GHI ÂM CUỘC HỌP
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>
                  Phím tắt: <strong>Ctrl + Alt + M</strong> mở Hub · <strong>Alt + M</strong> bật/tắt ghi âm
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Badge đếm ngược tự ẩn 3s */}
          <div
            title="Hub sẽ tự ẩn sau 3 giây nếu không có thao tác chuột hoặc cuộn trang (như HUD Alt+M)"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              padding: "3px 10px",
              borderRadius: 20,
              background: "rgba(52, 211, 153, 0.12)",
              border: "1px solid rgba(52, 211, 153, 0.3)",
              color: "#6ee7b7",
            }}
          >
            <Clock size={12} />
            <span>Tự ẩn sau {remainingSeconds}s</span>
          </div>

          <button
            onClick={handleClose}
            title="Đóng (Esc)"
            style={{
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: 6,
              color: "#94a3b8",
              cursor: "pointer",
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 2. Dải trạng thái Ghi âm trực tiếp (Live Recorder Status Bar) */}
      {!selectedSession && (
        <div
          style={{
            margin: "12px 18px 0 18px",
            padding: "10px 14px",
            borderRadius: 10,
            border: recordingState.isRecording
              ? "1px solid rgba(239, 68, 68, 0.55)"
              : (recordingState.isSummarizing || Boolean(processingId))
              ? "1px solid rgba(234, 179, 8, 0.45)"
              : "1px solid rgba(255, 255, 255, 0.1)",
            background: recordingState.isRecording
              ? "rgba(239, 68, 68, 0.12)"
              : (recordingState.isSummarizing || Boolean(processingId))
              ? "rgba(234, 179, 8, 0.12)"
              : "rgba(255, 255, 255, 0.04)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {recordingState.isRecording ? (
              <>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: "#ef4444",
                    boxShadow: "0 0 10px #ef4444",
                  }}
                />
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#fca5a5" }}>
                      Đang ghi âm cuộc họp
                    </span>
                    {/* ĐỒNG HỒ ĐẾM THỜI GIAN THỰC ĐANG GHI ÂM */}
                    <span
                      title="Thời gian đã ghi âm"
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        fontFamily: "var(--font-mono, monospace)",
                        color: "#ffffff",
                        background: "rgba(239, 68, 68, 0.35)",
                        padding: "2px 8px",
                        borderRadius: 6,
                        border: "1px solid rgba(239, 68, 68, 0.6)",
                        letterSpacing: "0.8px",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Timer size={13} color="#fca5a5" />
                      {formatDuration(liveElapsedSeconds)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#f87171", marginTop: 2 }}>
                    {recordingState.statusText || "Đang thu đồng thời âm thanh loa máy tính & microphone..."}
                  </div>
                </div>
              </>
            ) : (recordingState.isSummarizing || Boolean(processingId)) ? (
              <>
                <Loader2 size={16} className="spin" color="#facc15" />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fde047" }}>
                    ⏳ Đang gỡ băng âm thanh & tóm tắt AI...
                  </div>
                  <div style={{ fontSize: 11, color: "#eab308" }}>
                    {recordingState.statusText || "Đang phân tích và tạo tóm tắt cuộc họp..."}
                  </div>
                </div>
              </>
            ) : (
              <>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "#64748b",
                  }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9" }}>
                    ⚪ Trạng thái: Sẵn sàng ghi âm
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    Chưa ghi âm. Bấm nút bên phải hoặc phím <strong>Alt + M</strong> để bắt đầu.
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Nút bấm Bắt đầu / Dừng ghi âm trực tiếp ngay trên Hub */}
          <button
            onClick={handleToggleRecording}
            disabled={recordingState.isSummarizing || Boolean(processingId)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 8,
              border: recordingState.isRecording
                ? "1px solid rgba(239, 68, 68, 0.5)"
                : "1px solid rgba(52, 211, 153, 0.45)",
              background: recordingState.isRecording
                ? "rgba(239, 68, 68, 0.25)"
                : "rgba(16, 185, 129, 0.22)",
              color: recordingState.isRecording ? "#fca5a5" : "#6ee7b7",
              cursor: (recordingState.isSummarizing || Boolean(processingId)) ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 600,
              transition: "all 0.15s ease",
            }}
          >
            {recordingState.isRecording ? (
              <>
                <Square size={13} fill="#fca5a5" />
                Dừng & Tóm tắt (Alt+M)
              </>
            ) : (
              <>
                <Mic size={13} />
                Bắt đầu ghi âm (Alt+M)
              </>
            )}
          </button>
        </div>
      )}

      {/* Thông báo lỗi thao tác nếu có */}
      {actionError && (
        <div
          style={{
            margin: "8px 18px 0 18px",
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.4)",
            color: "#fca5a5",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>⚠️ {actionError}</span>
          <button
            onClick={() => setActionError(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "#fca5a5",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* 3. Tiêu đề danh sách Lịch sử các lần tóm tắt trước */}
      {!selectedSession && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px 6px 18px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#cbd5e1", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            <History size={14} color="#38bdf8" />
            Lịch sử các lần tóm tắt trước
          </div>

          {history.length > 0 && history[0]?.folderPath && (
            <button
              onClick={(e) => handleOpenFolder(e, history[0].folderPath)}
              title="Mở thư mục lưu trữ các file cuộc họp trên máy tính"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: "transparent",
                border: "none",
                color: "#93c5fd",
                fontSize: 11,
                cursor: "pointer",
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              <FolderOpen size={13} />
              Mở thư mục lưu trữ
            </button>
          )}
        </div>
      )}

      {/* 4. Body Content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 18px 14px 18px",
          minHeight: 0,
        }}
      >
        {loading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#94a3b8",
              fontSize: 13,
            }}
          >
            Đang tải dữ liệu...
          </div>
        ) : selectedSession ? (
          /* View chi tiết bản tóm tắt */
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
                paddingBottom: 10,
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: "#94a3b8" }}>
                <span>📅 {selectedSession.date}</span>
                <span>⏰ {selectedSession.time}</span>
                {selectedSession.durationSeconds ? (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      color: "#fcd34d",
                      fontWeight: 500,
                    }}
                  >
                    <Clock size={13} /> Thời lượng: {formatDurationHuman(selectedSession.durationSeconds)} ({formatDuration(selectedSession.durationSeconds)})
                  </span>
                ) : null}
              </div>

              {/* Nút mở thư mục một chạm (Không hiện chuỗi đường dẫn raw) */}
              <button
                onClick={(e) => handleOpenFolder(e, selectedSession.folderPath)}
                title="Mở thư mục chứa file ghi âm và tóm tắt trên máy tính"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 12px",
                  borderRadius: 6,
                  border: "1px solid rgba(59, 130, 246, 0.4)",
                  background: "rgba(59, 130, 246, 0.15)",
                  color: "#93c5fd",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                <FolderOpen size={14} />
                Mở thư mục
              </button>
            </div>

            <div
              style={{
                fontSize: 14,
                lineHeight: 1.7,
                color: "#e2e8f0",
              }}
            >
              {selectedSession.summaryContent ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedSession.summaryContent}</ReactMarkdown>
              ) : (
                <div style={{ color: "#94a3b8", fontStyle: "italic" }}>
                  Phiên làm việc này chưa có nội dung tóm tắt văn bản. Bạn có thể mở thư mục để kiểm tra file âm thanh .wav.
                </div>
              )}
            </div>
          </div>
        ) : history.length === 0 ? (
          /* Trạng thái trống */
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: 180,
              gap: 10,
              color: "#94a3b8",
              textAlign: "center",
            }}
          >
            <History size={36} strokeWidth={1.5} color="#475569" />
            <div style={{ fontSize: 13, color: "#cbd5e1" }}>Chưa có bản ghi âm cuộc họp nào trong lịch sử.</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Bấm nút "Bắt đầu ghi âm" ở trên hoặc phím <strong>Alt + M</strong> để bắt đầu ghi âm cuộc họp đầu tiên.
            </div>
          </div>
        ) : (
          /* Danh sách các phiên họp */
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {history.map((item) => {
              const isProcessingThis = processingId === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => handleItemClick(item)}
                  title={
                    item.hasSummary
                      ? "Nhấp để xem chi tiết bản tóm tắt cuộc họp"
                      : isProcessingThis
                      ? "Đang phân tích dữ liệu âm thanh & tạo tóm tắt AI..."
                      : "Nhấp để bắt đầu tóm tắt AI cho cuộc họp này"
                  }
                  style={{
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: isProcessingThis
                      ? "1px solid rgba(250, 204, 21, 0.6)"
                      : item.hasSummary
                      ? "1px solid rgba(255, 255, 255, 0.08)"
                      : "1px solid rgba(56, 189, 248, 0.3)",
                    background: isProcessingThis
                      ? "rgba(250, 204, 21, 0.08)"
                      : "rgba(255, 255, 255, 0.03)",
                    cursor: isProcessingThis ? "wait" : "pointer",
                    transition: "all 0.15s ease",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                  onMouseEnter={(e) => {
                    if (!isProcessingThis) {
                      e.currentTarget.style.background = item.hasSummary
                        ? "rgba(255, 255, 255, 0.06)"
                        : "rgba(56, 189, 248, 0.08)";
                      e.currentTarget.style.borderColor = item.hasSummary
                        ? "rgba(52, 211, 153, 0.35)"
                        : "rgba(56, 189, 248, 0.5)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isProcessingThis) {
                      e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)";
                      e.currentTarget.style.borderColor = item.hasSummary
                        ? "rgba(255, 255, 255, 0.08)"
                        : "rgba(56, 189, 248, 0.3)";
                    }
                  }}
                >
                  {/* Dòng 1: Ngày giờ, trạng thái file, thời lượng, nút mở thư mục */}
                  <div style={{ display: "flex", alignItems: "center", justifyItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 600, color: "#f1f5f9" }}>
                        <Calendar size={13} color="#94a3b8" />
                        {item.date}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#94a3b8" }}>
                        <Clock size={12} />
                        {item.time}
                      </div>

                      {/* Badge thời lượng cuộc họp */}
                      {item.durationSeconds ? (
                        <span
                          title={`Thời lượng ghi âm: ${formatDurationHuman(item.durationSeconds)}`}
                          style={{
                            fontSize: 11,
                            padding: "2px 7px",
                            borderRadius: 4,
                            background: "rgba(245, 158, 11, 0.15)",
                            color: "#fcd34d",
                            border: "1px solid rgba(245, 158, 11, 0.3)",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            fontWeight: 500,
                            fontFamily: "var(--font-mono, monospace)",
                          }}
                        >
                          <Timer size={11} /> {formatDuration(item.durationSeconds)}
                        </span>
                      ) : null}

                      <div style={{ display: "flex", gap: 5 }}>
                        {item.hasSummary && (
                          <span
                            style={{
                              fontSize: 10,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: "rgba(16, 185, 129, 0.15)",
                              color: "#6ee7b7",
                              border: "1px solid rgba(16, 185, 129, 0.3)",
                              display: "flex",
                              alignItems: "center",
                              gap: 3,
                            }}
                          >
                            <FileText size={10} /> Tóm tắt
                          </span>
                        )}
                        {item.hasWav && (
                          <span
                            style={{
                              fontSize: 10,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: "rgba(99, 102, 241, 0.15)",
                              color: "#a5b4fc",
                              border: "1px solid rgba(99, 102, 241, 0.3)",
                              display: "flex",
                              alignItems: "center",
                              gap: 3,
                            }}
                          >
                            <Mic size={10} /> Audio
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Nút mở thư mục 1 chạm (Không hiển thị text đường dẫn raw) */}
                    <button
                      onClick={(e) => handleOpenFolder(e, item.folderPath)}
                      title="Mở thư mục chứa phiên làm việc này trên máy tính"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: "1px solid rgba(59, 130, 246, 0.35)",
                        background: "rgba(59, 130, 246, 0.12)",
                        color: "#93c5fd",
                        cursor: "pointer",
                        fontSize: 11,
                        fontWeight: 500,
                      }}
                    >
                      <FolderOpen size={13} />
                      Mở thư mục
                    </button>
                  </div>

                  {/* Dòng 2: Trích đoạn tóm tắt HOẶC Nút Bắt đầu tóm tắt AI */}
                  <div
                    style={{
                      fontSize: 12,
                      lineHeight: 1.5,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    {isProcessingThis ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#fde047", fontWeight: 500 }}>
                        <Loader2 size={13} className="spin" color="#facc15" />
                        <span>{recordingState.statusText || "Đang gỡ băng âm thanh và tạo tóm tắt AI..."}</span>
                      </div>
                    ) : item.hasSummary ? (
                      <div
                        style={{
                          color: "#cbd5e1",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.snippet}
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                        <span style={{ color: "#94a3b8" }}>
                          Bản ghi âm cuộc họp (chưa có tóm tắt văn bản)
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: "rgba(56, 189, 248, 0.15)",
                            border: "1px solid rgba(56, 189, 248, 0.4)",
                            color: "#38bdf8",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            fontWeight: 500,
                            flexShrink: 0,
                          }}
                        >
                          ⚡ Nhấp để tóm tắt
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Footer bar */}
      <div
        style={{
          padding: "8px 18px",
          borderTop: "1px solid rgba(255, 255, 255, 0.06)",
          background: "rgba(0, 0, 0, 0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 11,
          color: "#64748b",
        }}
      >
        <span>Phím tắt: <strong>Ctrl + Alt + M</strong> mở Hub · <strong>Alt + M</strong> bật/tắt ghi âm</span>
        <span>Di chuyển chuột hoặc cuộn trang để giữ hiển thị</span>
      </div>
    </div>
  );
}
