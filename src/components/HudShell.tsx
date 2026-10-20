import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { ChevronDown, Crop, Monitor, Hand, Maximize2, MessageSquare, Mic, MicOff, Power, Terminal, Eye, PenTool, Network, X, GripHorizontal, Search, History } from "lucide-react";
import ReactorCore from "./ReactorCore";
import WorkCard from "./WorkCard";
import PoQuestionBanner from "./PoQuestionBanner";
import ContextSupplementInput from "./ContextSupplementInput";
import { HandSkeleton } from "./CameraDock";
import DrawingCanvas from "./DrawingCanvas";
import VaultGalaxy, { type GalaxyNode } from "./VaultGalaxy";
import HudTopNotch from "./HudTopNotch";
import type { HandoffTone, ReactorState, TaskCard, TranscriptLine } from "../types";
import type { HandState } from "../hooks/useHandControl";
import { acceptedKey } from "../lib/tasks";
import { useFloatingPanel } from "../hooks/useFloatingPanel";

const ORB_ACCENT: Record<ReactorState, string> = {
  idle: "120, 170, 150",
  online: "18, 163, 148",
  listening: "40, 205, 170",
  speaking: "238, 122, 92",
  working: "120, 180, 120",
};

function HudCamera({
  stream,
  hand,
  actionLabel,
  actionTone,
}: {
  stream: MediaStream | null;
  hand: HandState;
  actionLabel: string;
  actionTone: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="hud-camera hud-hit">
      <div className="camera-frame">
        <video ref={videoRef} autoPlay playsInline muted />
        <div className="cam-scan" />
        <HandSkeleton hands={hand.hands} />
        <span className="cam-status">
          <i />
          {hand.present ? "tracking" : "no hand"}
        </span>
        <span className={`gesture-chip ${actionTone}`}>
          <span className="dot" />
          {actionLabel}
        </span>
      </div>
    </div>
  );
}

/**
 * Glass HUD layout: Iris floating over the whole desktop. Everything is
 * pointer-transparent except elements marked `.hud-hit` — the main process
 * toggles window click-through based on what the pointer is over, so you can
 * keep working in the apps underneath.
 */
export default function HudShell({
  reactorState,
  inputLevelRef,
  outputLevelRef,
  thinking,
  wakeKey,
  rippleKey,
  orbStageRef,
  orbFlash,
  onOrbFlashEnd,
  awake,
  caption,
  captionDim,
  wakeWordEnabled,
  muted,
  onToggleMute,
  onWake,
  onSleep,
  onExitHud,
  tasks,
  acceptedIds,
  stepsOpenIds,
  workScrollRef,
  onToggleSteps,
  onOpenTask,
  transcript,
  commsScrollRef,
  onSendSupplement,
  handControl,
  onToggleHand,
  hand,
  handStream,
  handActionLabel,
  handActionTone,
  poQuestion,
  isVisionEnabled,
  hudStats,
  hudMessage,
  onDismissHudMessage,
  teleprompterState,
  onToggleTranslate,
  onToggleInterviewCopilot,
  drawingActive,
  onToggleDrawing,
  secondBrainAvailable,
  secondBrainActive,
  onToggleSecondBrain,
  onOpenNote,
  onForceCloseSecondBrain,
  galaxyPositionsRef,
  handStateRef,
  readerOpen,
  hudTopNotchEnabled,
  onOpenMeetingHistory,
}: {
  reactorState: ReactorState;
  inputLevelRef: { current: number };
  outputLevelRef: { current: number };
  thinking: boolean;
  wakeKey: number;
  rippleKey: number;
  orbStageRef: RefObject<HTMLDivElement | null>;
  orbFlash: { id: string; tone: HandoffTone } | null;
  onOrbFlashEnd: () => void;
  awake: boolean;
  caption: string;
  captionDim: boolean;
  wakeWordEnabled: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onWake: () => void;
  onSleep: () => void;
  onExitHud: () => void;
  tasks: TaskCard[];
  acceptedIds: Record<string, number>;
  stepsOpenIds: Record<string, boolean>;
  workScrollRef: RefObject<HTMLDivElement | null>;
  onToggleSteps: (id: string) => void;
  onOpenTask: (task: TaskCard) => void;
  transcript: TranscriptLine[];
  commsScrollRef: RefObject<HTMLDivElement | null>;
  onSendSupplement: (text: string) => void;
  handControl: boolean;
  onToggleHand: () => void;
  hand: HandState;
  handStream: MediaStream | null;
  handActionLabel: string;
  handActionTone: string;
  // Claude-specific delta vs upstream (design.md D2): a pending PO question
  // must stay answerable (voice, click, or dwell-click) while floating.
  poQuestion: {
    questions: PoQuestion[];
    answers: Record<string, string>;
    onPick: (question: string, choice: string) => void;
  } | null;
  isVisionEnabled?: boolean;
  hudStats?: {
    ramTotal: number;
    ramFree: number;
    activeTasks: number;
    queuedTasks: number;
  } | null;
  hudMessage?: {
    title: string;
    content: string;
    copilotHistory?: TeleprompterCopilotEntry[];
    copilotStatus?: string;
  } | null;
  onDismissHudMessage?: () => void;
  // 2 nút Dịch/Nhắc bài trên cửa sổ Live Teleprompter (Alt+T). "Nhắc bài"
  // hiển thị gợi ý MINH BẠCH trên HUD (bảng câu hỏi/gợi ý cuộn được, có tìm
  // kiếm) — không có cơ chế tự tắt mic.
  teleprompterState?: {
    transcriberActive: boolean;
    translateEnabled: boolean;
    translateTargetLang: string;
    copilotEnabled: boolean;
  } | null;
  onToggleTranslate?: (targetLang: string) => void;
  onToggleInterviewCopilot?: () => void;
  // Ported from myiris (hud-drawing-canvas / second-brain-galaxy-view):
  // optional so this component keeps working even before App.tsx wires them.
  drawingActive?: boolean;
  onToggleDrawing?: () => void;
  secondBrainAvailable?: boolean;
  secondBrainActive?: boolean;
  onToggleSecondBrain?: () => void;
  onOpenNote?: (id: string, title: string) => void;
  onForceCloseSecondBrain?: () => void;
  galaxyPositionsRef?: { current: Map<string, GalaxyNode> };
  /** Per-frame hand data (useHandControl's stateRef) — read every rAF, not React state. */
  handStateRef?: { current: HandState };
  readerOpen?: boolean;
  hudTopNotchEnabled?: boolean;
  onOpenMeetingHistory?: () => void;
}) {
  // Show the full stream (state caps at 20); the column has a fixed max height
  // and palm-scrolls like Comms.
  const visibleTasks = tasks;
  const recentTranscript = transcript.slice(-8);
  // Comms is glanceable, not essential — collapsed by default (the caption
  // pill by the orb already shows the latest line). Tasks are the core of the
  // HUD, so they start open but can be tucked away the same way.
    const [commsOpen, setCommsOpen] = useState(false);

  // Tự động đóng tab Comms khi click ra ngoài (click vào tab khác)
  const commsWrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!commsOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (commsWrapperRef.current && !commsWrapperRef.current.contains(e.target as Node)) {
        setCommsOpen(false);
      }
    }
    function handleBlur() {
      setCommsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("blur", handleBlur);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("blur", handleBlur);
    };
  }, [commsOpen]);
    const [workOpen, setWorkOpen] = useState(() => visibleTasks.length > 0);
    const prevTaskCountRef = useRef(visibleTasks.length);

    useEffect(() => {
      if (visibleTasks.length > prevTaskCountRef.current) {
        setWorkOpen(true);
      }
      prevTaskCountRef.current = visibleTasks.length;
    }, [visibleTasks.length]);

  // Tự động đóng tab Tasks sau 3 giây nếu có task bị lỗi
  const failedTasksRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let hasNewFailure = false;
    visibleTasks.forEach(t => {
      if ((t.status === "failed" || t.status === "error") && !failedTasksRef.current.has(t.id)) {
        failedTasksRef.current.add(t.id);
        hasNewFailure = true;
      }
    });

    if (hasNewFailure) {
      setWorkOpen(true);
      setTimeout(() => {
        setWorkOpen(false);
      }, 3000);
    }
  }, [visibleTasks]);

  // Dropdown chọn ngôn ngữ cho nút Dịch — nhỏ gọn để không che khung transcript.
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const langPickerWrapRef = useRef<HTMLDivElement>(null);
  const TRANSLATE_LANGS = [
    "Tiếng Việt",
    "Tiếng Anh",
    "Tiếng Trung",
    "Tiếng Nhật",
    "Tiếng Hàn",
    "Tiếng Pháp",
  ];

  useEffect(() => {
    if (!langPickerOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (langPickerWrapRef.current && !langPickerWrapRef.current.contains(e.target as Node)) {
        setLangPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [langPickerOpen]);


  // Export minutes to Second Brain state
  const [isExportingMinutes, setIsExportingMinutes] = useState(false);
  const [minutesExportStatus, setMinutesExportStatus] = useState("");

  // Interactive Snipping Tool & Full Screen Vision state
  const [isSnipping, setIsSnipping] = useState(false);
  const [snipStart, setSnipStart] = useState<{ x: number; y: number } | null>(null);
  const [snipCurrent, setSnipCurrent] = useState<{ x: number; y: number } | null>(null);
  const [isWaitingVision, setIsWaitingVision] = useState(false);
  const [waitingVisionText, setWaitingVisionText] = useState("");
  const [pendingVisionQuery, setPendingVisionQuery] = useState("");

  useEffect(() => {
    if (!isSnipping) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsSnipping(false);
        setSnipStart(null);
        setSnipCurrent(null);
        setPendingVisionQuery("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSnipping]);

  // Kích hoạt Khoanh vùng (Nhập câu hỏi trước -> Ẩn HUD -> Khoanh vùng -> Chờ kết quả mới mở lại HUD)
  const handleStartSnip = (customQuery?: string) => {
    const q = (customQuery ?? aiQueryText).trim() || "Giải đáp chi tiết nội dung trong vùng màn hình vừa được khoanh vùng này.";
    setPendingVisionQuery(q);
    setShowAiQuery(false);
    setIsSnipping(true);
  };

  // Kích hoạt Toàn màn hình (Nhập câu hỏi trước -> Ẩn HUD -> Chụp màn hình -> Chờ kết quả mới mở lại HUD)
  const handleFullScreenVision = (customQuery?: string) => {
    const q = (customQuery ?? aiQueryText).trim() || "Phân tích nội dung chính đang hiển thị trên toàn bộ màn hình và tóm tắt những điểm quan trọng.";
    setShowAiQuery(false);
    setAiQueryText("");
    setWaitingVisionText("Đang chụp & phân tích toàn màn hình với Gemini Vision...");
    setIsWaitingVision(true);

    // Độ trễ 180ms để HUD ẩn hoàn toàn khỏi màn hình trước khi chụp
    setTimeout(async () => {
      try {
        if (window.iris?.askTeleprompter) {
          const res = await window.iris.askTeleprompter(q, {
            isFullScreen: true,
            hideUntilResolved: true,
          });
          if (res && res.status === "error") {
            setAiQueryError(res.error || "Lỗi khi gọi AI");
          }
        }
      } catch (err: any) {
        setAiQueryError(err?.message || "Lỗi kết nối khi gửi câu hỏi");
      } finally {
        setIsWaitingVision(false);
      }
    }, 180);
  };

  // Hỏi AI trực tiếp từ HUD (Icon kính lúp)
  const [showAiQuery, setShowAiQuery] = useState(false);
  const [aiQueryText, setAiQueryText] = useState("");
  const [isAskingAi, setIsAskingAi] = useState(false);
  const [aiQueryError, setAiQueryError] = useState("");
  const aiQueryWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showAiQuery) return;
    function handleClickOutside(e: MouseEvent) {
      if (aiQueryWrapRef.current && !aiQueryWrapRef.current.contains(e.target as Node)) {
        setShowAiQuery(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showAiQuery]);

  // Bảng lịch sử câu hỏi/gợi ý của "Nhắc bài" — tự cuộn xuống mục mới nhất TRỪ KHI 
  // người dùng đang chủ động cuộn lên xem/tìm lại các mục cũ.
  const copilotScrollRef = useRef<HTMLDivElement | null>(null);
  const copilotStickToBottomRef = useRef(true);
  const copilotHistory = hudMessage?.copilotHistory ?? [];
  const filteredCopilotHistory = copilotHistory;

  useEffect(() => {
    const el = copilotScrollRef.current;
    if (el && copilotStickToBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [copilotHistory.length]);

  // Drag state for HUD Message
  const [msgPos, setMsgPos] = useState({ x: 0, y: 0 });
  const [isMsgDragging, setIsMsgDragging] = useState(false);
  const msgDragStart = useRef({ x: 0, y: 0, initialX: 0, initialY: 0 });

  useEffect(() => {
    if (!isMsgDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      setMsgPos({
        x: msgDragStart.current.initialX + (e.clientX - msgDragStart.current.x),
        y: msgDragStart.current.initialY + (e.clientY - msgDragStart.current.y),
      });
    };
    const handleMouseUp = () => setIsMsgDragging(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isMsgDragging]);

  const handleMsgMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    setIsMsgDragging(true);
    msgDragStart.current = {
      x: e.clientX,
      y: e.clientY,
      initialX: msgPos.x,
      initialY: msgPos.y,
    };
  };

  // Reset position when a new message appears
  useEffect(() => {
    if (hudMessage) {
      setMsgPos({ x: 0, y: 0 });
    }
  }, [hudMessage]);

  // Dòng phụ đề/transcript thô (bản gốc + bản dịch, nếu Dịch đang bật) — dùng
  // chung cho khung "hud-message-body" và khung phụ đề rút gọn phía trên
  // bảng Nhắc bài.
  const renderTranscriptLine = (line: string, i: number) => {
    if (line.trim().length === 0) return null;
    if (line.startsWith("💡")) {
      return <div key={i} className="ai-suggestion-box">{line}</div>;
    }
    if (line.startsWith("🌐 [Dịch")) {
      return (
        <p key={i} style={{ color: '#38bdf8', fontSize: 11, fontWeight: 600, borderTop: '1px dashed rgba(255,255,255,0.15)', paddingTop: 4, marginTop: 4 }}>
          {line}
        </p>
      );
    }
    if (line.startsWith("[Đang dịch]")) {
      return (
        <p key={i} style={{ color: '#facc15', fontStyle: 'italic', fontSize: 12 }}>
          ⏳ {line}
        </p>
      );
    }
    if (line.startsWith("⚠️ Lỗi dịch")) {
      return (
        <p key={i} style={{ color: '#f87171', fontSize: 11 }}>
          {line}
        </p>
      );
    }
    if (line.startsWith("[Bạn]")) {
      return <p key={i} style={{ color: '#4ade80' }}><strong>Bạn:</strong> {line.replace("[Bạn]", "").trim()}</p>;
    } else if (line.startsWith("[Đối tác]")) {
      return <p key={i} style={{ color: '#60a5fa' }}><strong>Đối tác:</strong> {line.replace("[Đối tác]", "").trim()}</p>;
    } else if (line.startsWith("[Chung]")) {
      return <p key={i} style={{ color: '#9ca3af' }}>{line.replace("[Chung]", "").trim()}</p>;
    }
    return <p key={i}>{line}</p>;
  };

  return (
    <div className={`hud-shell ${awake ? "awake" : "asleep"}`}>
      {hudTopNotchEnabled !== false && <HudTopNotch />}
      {/* A pending PO question outranks everything else in the HUD — it stays
          a lit, always-visible island rather than tucked behind a toggle. */}
      {poQuestion ? (
        <div className="hud-po-question hud-hit">
          <PoQuestionBanner
            questions={poQuestion.questions}
            answers={poQuestion.answers}
            onPick={poQuestion.onPick}
          />
        </div>
      ) : null}


      {/* Interactive Full-Screen Snipping Overlay for Vision OCR & Q&A */}
      {isSnipping ? (
        <div
          className="snipping-tool-overlay hud-hit"
          style={{
            position: "fixed",
            inset: 0,
            width: "100vw",
            height: "100vh",
            zIndex: 9999999,
            cursor: "crosshair",
            userSelect: "none",
            backgroundColor: "rgba(0, 0, 0, 0.12)",
          }}
          onMouseDown={(e) => {
            if (e.button === 0) {
              setSnipStart({ x: e.clientX, y: e.clientY });
              setSnipCurrent({ x: e.clientX, y: e.clientY });
            }
          }}
          onMouseMove={(e) => {
            if (snipStart) {
              setSnipCurrent({ x: e.clientX, y: e.clientY });
            }
          }}
          onMouseUp={async (e) => {
            if (e.button !== 0 || !snipStart || !snipCurrent) {
              setIsSnipping(false);
              setSnipStart(null);
              setSnipCurrent(null);
              return;
            }
            const x1 = Math.min(snipStart.x, snipCurrent.x);
            const y1 = Math.min(snipStart.y, snipCurrent.y);
            const x2 = Math.max(snipStart.x, snipCurrent.x);
            const y2 = Math.max(snipStart.y, snipCurrent.y);
            const width = x2 - x1;
            const height = y2 - y1;

            setIsSnipping(false);
            setSnipStart(null);
            setSnipCurrent(null);

            if (width >= 15 && height >= 15) {
              const xRatio = Math.max(0, Math.min(1, x1 / window.innerWidth));
              const yRatio = Math.max(0, Math.min(1, y1 / window.innerHeight));
              const widthRatio = Math.max(0.01, Math.min(1 - xRatio, width / window.innerWidth));
              const heightRatio = Math.max(0.01, Math.min(1 - yRatio, height / window.innerHeight));

              const query = pendingVisionQuery || aiQueryText.trim() || "Giải đáp chi tiết nội dung trong vùng màn hình vừa được khoanh vùng này.";
              setPendingVisionQuery("");
              setAiQueryText("");
              setWaitingVisionText(`Đang phân tích vùng chọn (${width}×${height}px) với Gemini Vision...`);
              setIsWaitingVision(true);

              try {
                if (window.iris?.askTeleprompter) {
                  const res = await window.iris.askTeleprompter(query, {
                    cropRect: { x: x1, y: y1, width, height, xRatio, yRatio, widthRatio, heightRatio },
                    hideUntilResolved: true,
                  });
                  if (res && res.status === "error") {
                    setAiQueryError(res.error || "Lỗi khi hỏi AI");
                  }
                }
              } catch (err: any) {
                setAiQueryError(err?.message || "Lỗi kết nối khi gửi câu hỏi");
              } finally {
                setIsWaitingVision(false);
              }
            } else {
              setPendingVisionQuery("");
            }
          }}
        >
          {/* Top Instruction Pill */}
          <div
            style={{
              position: "absolute",
              top: 28,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(15, 23, 42, 0.92)",
              border: "1px solid rgba(56, 189, 248, 0.4)",
              borderRadius: 24,
              padding: "7px 20px",
              color: "#f8fafc",
              fontSize: 13,
              fontWeight: 500,
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              backdropFilter: "blur(12px)",
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              gap: 10,
              zIndex: 10000001,
            }}
          >
            <span style={{ color: "#38bdf8", fontSize: 16 }}>✂️</span>
            <span>Nhấn giữ & kéo chuột để khoanh vùng màn hình cần hỏi AI</span>
            <span style={{ fontSize: 11, color: "#94a3b8", background: "rgba(255,255,255,0.1)", padding: "2px 8px", borderRadius: 12 }}>
              ESC để huỷ
            </span>
          </div>

          {/* Dynamic Selection Box */}
          {snipStart && snipCurrent && (
            <div
              style={{
                position: "absolute",
                left: Math.min(snipStart.x, snipCurrent.x),
                top: Math.min(snipStart.y, snipCurrent.y),
                width: Math.abs(snipCurrent.x - snipStart.x),
                height: Math.abs(snipCurrent.y - snipStart.y),
                border: "2px dashed #38bdf8",
                backgroundColor: "rgba(56, 189, 248, 0.12)",
                boxShadow: "0 0 0 99999px rgba(0, 0, 0, 0.35)",
                pointerEvents: "none",
                zIndex: 10000000,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  bottom: -24,
                  right: 0,
                  background: "#0284c7",
                  color: "#fff",
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontFamily: "monospace",
                  fontWeight: 600,
                  boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
                  whiteSpace: "nowrap",
                }}
              >
                {Math.abs(snipCurrent.x - snipStart.x)} × {Math.abs(snipCurrent.y - snipStart.y)} px
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Top Floating Badge while AI is analyzing screenshot in background */}
      {isWaitingVision && (
        <div
          className="hud-hit"
          style={{
            position: "fixed",
            top: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(15, 23, 42, 0.94)",
            border: "1px solid rgba(56, 189, 248, 0.5)",
            borderRadius: 24,
            padding: "8px 22px",
            color: "#f8fafc",
            fontSize: 13,
            fontWeight: 500,
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            backdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            zIndex: 9999999,
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              border: "2px solid #38bdf8",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
          <span>{waitingVisionText}</span>
          <button
            type="button"
            onClick={() => setIsWaitingVision(false)}
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 12,
              marginLeft: 4,
              padding: "2px 4px",
            }}
            title="Đóng thông báo"
          >
            ✕
          </button>
        </div>
      )}

      {/* Center Message Widget */}
      {hudMessage && !isSnipping && !isWaitingVision ? (
        <div 
          className="hud-message-center hud-hit"
          onMouseDown={handleMsgMouseDown}
          style={{ 
            /* BUG-HUD-CENTER-01 FIX: `.hud-message-center` in
               src/styles/hud.css positions this box with
               `top: 50%; left: 50%; transform: translate(-50%, -50%);` so it
               sits truly centered on screen at rest. But this inline `style`
               REPLACES the whole `transform` property (inline styles always
               win over the stylesheet rule for the same property), and the
               old code only kept the `-50%` on the X axis:
                 translate(calc(-50% + x), y)   ← Y never had -50%
               So even with a fresh message (msgPos = {x:0, y:0}) the box's
               transform became `translate(-50%, 0px)` instead of
               `translate(-50%, -50%)`: horizontally centered, but its top
               edge landed exactly at screen-middle and the box hung downward
               from there — never actually centered, and on a laptop screen
               it visually reads as sitting low/off to one side rather than
               centered. This affects the report widget, Meeting Recorder
               (Alt+M), and Live Teleprompter (Alt+T) alike since they all
               render through this same component. Restoring the `-50%` on
               both axes fixes all three at once; dragging (msgPos) now
               offsets FROM true center instead of from the top-center point. */
            transform: `translate(calc(-50% + ${msgPos.x}px), calc(-50% + ${msgPos.y}px))`,
            transition: isMsgDragging ? "none" : "transform 0.1s ease-out",
            cursor: isMsgDragging ? "grabbing" : "auto"
          }}
        >
          <button className="hud-message-close" onClick={onDismissHudMessage} style={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
            </svg>
          </button>
          {hudMessage.title === "Live Teleprompter" && (onToggleTranslate || onToggleInterviewCopilot) ? (
            <div
              className="hud-hit"
              style={{ position: "absolute", top: 8, left: 12, display: "flex", gap: 6, alignItems: "center", zIndex: 10 }}
            >
              {onToggleTranslate ? (
                <div ref={langPickerWrapRef} style={{ position: "relative" }}>
                  <button
                    onClick={() => setLangPickerOpen((v) => !v)}
                    style={{
                      fontSize: 11,
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid #333",
                      background: teleprompterState?.translateEnabled ? "rgba(96,165,250,0.18)" : "#151515",
                      color: teleprompterState?.translateEnabled ? "#60a5fa" : "#ccc",
                      cursor: "pointer",
                    }}
                  >
                    🌐 {teleprompterState?.translateEnabled
                      ? ((teleprompterState.translateTargetLang || "").replace(/\s*\(.*?\)/g, "").trim() || "Dịch")
                      : "Dịch"}
                  </button>
                  {langPickerOpen ? (
                    <div
                      style={{
                        position: "absolute",
                        top: "110%",
                        left: 0,
                        background: "#111",
                        border: "1px solid #333",
                        borderRadius: 6,
                        padding: 4,
                        minWidth: 170,
                        zIndex: 20,
                        boxShadow: "0 4px 14px rgba(0,0,0,0.6)",
                      }}
                    >
                      {teleprompterState?.translateEnabled ? (
                        <button
                          style={{
                            display: "block", width: "100%", textAlign: "left", padding: "6px 8px",
                            fontSize: 11, color: "#f87171", background: "none", border: "none",
                            cursor: "pointer", borderBottom: "1px solid #222", marginBottom: 2,
                          }}
                          onClick={() => { onToggleTranslate(""); setLangPickerOpen(false); }}
                        >
                          ✖ Tắt dịch
                        </button>
                      ) : null}
                      {TRANSLATE_LANGS.map((lang) => {
                        const cleanCurrent = (teleprompterState?.translateTargetLang || "").replace(/\s*\(.*?\)/g, "").trim();
                        const isCurrent = teleprompterState?.translateEnabled && (teleprompterState?.translateTargetLang === lang || cleanCurrent === lang);
                        return (
                          <button
                            key={lang}
                            style={{
                              display: "block", width: "100%", textAlign: "left", padding: "6px 8px",
                              fontSize: 11, color: isCurrent ? "#60a5fa" : "#ccc",
                              background: isCurrent ? "rgba(96,165,250,0.12)" : "none",
                              borderRadius: 4, border: "none", cursor: "pointer",
                            }}
                            onClick={() => { onToggleTranslate(lang); setLangPickerOpen(false); }}
                          >
                            {isCurrent ? "✓ " : ""}{lang}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {onToggleInterviewCopilot ? (
                <button
                  onClick={onToggleInterviewCopilot}
                  title="Gợi ý trả lời khi người đối diện hỏi — hiện thành bảng câu hỏi/gợi ý cuộn được"
                  style={{
                    fontSize: 11,
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: "1px solid #333",
                    background: teleprompterState?.copilotEnabled ? "rgba(74,222,128,0.18)" : "#151515",
                    color: teleprompterState?.copilotEnabled ? "#4ade80" : "#ccc",
                    cursor: "pointer",
                  }}
                >
                  💡 Nhắc bài{teleprompterState?.copilotEnabled ? " (ON)" : ""}
                </button>
              ) : null}

              {/* Ai Query Kính Lúp */}
              <div ref={aiQueryWrapRef} style={{ display: "flex", alignItems: "center", position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setShowAiQuery(!showAiQuery)}
                  title="Hỏi AI về cuộc trò chuyện hoặc màn hình"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: "4px", borderRadius: 6, border: "1px solid #333",
                    background: (showAiQuery || isAskingAi) ? "rgba(168,85,247,0.18)" : "#151515",
                    color: (showAiQuery || isAskingAi) ? "#a855f7" : "#ccc", cursor: "pointer",
                  }}
                >
                  <Search size={14} className={isAskingAi ? "animate-pulse" : ""} />
                </button>

                {/* Nút Xuất Biên Bản (Chỉ hiện icon) */}
                <button
                  type="button"
                  onClick={async () => {
                    if (isExportingMinutes) return;
                    setIsExportingMinutes(true);
                    setMinutesExportStatus("Đang lưu...");
                    try {
                      const res = await window.iris?.exportTeleprompterMinutes();
                      if (res && res.ok) {
                        setMinutesExportStatus(`✓ Đã lưu (${res.count || 0})`);
                      } else {
                        setMinutesExportStatus("⚠️ " + (res?.message || res?.error || "Lỗi lưu"));
                      }
                    } catch (err: any) {
                      setMinutesExportStatus("⚠️ " + (err?.message || "Lỗi lưu"));
                    } finally {
                      setIsExportingMinutes(false);
                      setTimeout(() => setMinutesExportStatus(""), 4000);
                    }
                  }}
                  title={minutesExportStatus ? `Biên bản: ${minutesExportStatus}` : "Lưu biên bản cuộc họp & nhắc bài vào Second Brain Markdown"}
                  style={{
                    fontSize: 12,
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: "1px solid #333",
                    background: minutesExportStatus.startsWith("✓") ? "rgba(34,197,94,0.18)" : "#151515",
                    color: minutesExportStatus.startsWith("✓") ? "#4ade80" : "#ccc",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {minutesExportStatus.startsWith("✓") ? "✓" : (isExportingMinutes ? "⏳" : "💾")}
                </button>

                {showAiQuery && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const text = aiQueryText.trim();
                      if (text && !isAskingAi) {
                        setIsAskingAi(true);
                        setAiQueryError("");
                        setAiQueryText("");
                        setShowAiQuery(false);
                        try {
                          if (window.iris?.askTeleprompter) {
                            const res = await window.iris.askTeleprompter(text);
                            if (res && res.status === "error") {
                              setAiQueryError(res.error || "Lỗi khi hỏi AI");
                            }
                          } else if (onSendSupplement) {
                            onSendSupplement(text);
                          }
                        } catch (err: any) {
                          setAiQueryError(err?.message || "Lỗi kết nối khi gửi câu hỏi");
                        } finally {
                          setIsAskingAi(false);
                        }
                      }
                    }}
                    style={{
                      position: "absolute",
                      left: "100%",
                      marginLeft: 6,
                      display: "flex",
                      alignItems: "center",
                      width: 290,
                      zIndex: 40,
                      gap: 4,
                      background: "#111",
                      padding: "4px 6px",
                      borderRadius: 8,
                      border: "1px solid #444",
                      boxShadow: "0 6px 18px rgba(0,0,0,0.6)",
                    }}
                  >
                    <input
                      autoFocus
                      type="text"
                      placeholder="Hỏi AI... (Enter để hỏi ngay)"
                      value={aiQueryText}
                      onChange={(e) => setAiQueryText(e.target.value)}
                      style={{
                        flex: 1,
                        padding: "4px 6px",
                        borderRadius: 4,
                        border: "none",
                        background: "#1e1e1e",
                        color: "#fff",
                        fontSize: 11,
                        outline: "none",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleStartSnip(aiQueryText)}
                      title="Khoanh vùng màn hình kèm câu hỏi này"
                      style={{
                        padding: "4px 6px",
                        borderRadius: 5,
                        border: "1px solid #333",
                        background: "#1c1c1c",
                        color: "#aaa",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "#fff";
                        e.currentTarget.style.borderColor = "#555";
                        e.currentTarget.style.background = "#2a2a2a";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "#aaa";
                        e.currentTarget.style.borderColor = "#333";
                        e.currentTarget.style.background = "#1c1c1c";
                      }}
                    >
                      <Crop size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFullScreenVision(aiQueryText)}
                      title="Chụp toàn màn hình kèm câu hỏi này"
                      style={{
                        padding: "4px 6px",
                        borderRadius: 5,
                        border: "1px solid #333",
                        background: "#1c1c1c",
                        color: "#aaa",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "#fff";
                        e.currentTarget.style.borderColor = "#555";
                        e.currentTarget.style.background = "#2a2a2a";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "#aaa";
                        e.currentTarget.style.borderColor = "#333";
                        e.currentTarget.style.background = "#1c1c1c";
                      }}
                    >
                      <Monitor size={12} />
                    </button>
                  </form>
                )}
              </div>
            </div>
          ) : (hudMessage.title === "Meeting Summarizer" ||
               hudMessage.title.toLowerCase().includes("cuộc họp") ||
               hudMessage.title.toLowerCase().includes("meeting") ||
               hudMessage.title.toLowerCase().includes("ghi âm") ||
               hudMessage.title.toLowerCase().includes("tóm tắt")) && onOpenMeetingHistory ? (
            <div
              className="hud-hit"
              style={{ position: "absolute", top: 8, left: 12, display: "flex", gap: 6, alignItems: "center", zIndex: 10 }}
            >
              <button
                onClick={onOpenMeetingHistory}
                title="Xem lịch sử các lần tóm tắt trước (Ctrl+Alt+M)"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid rgba(52, 211, 153, 0.4)",
                  background: "rgba(16, 185, 129, 0.15)",
                  color: "#6ee7b7",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                <History size={13} />
                Lịch sử tóm tắt
              </button>
            </div>
          ) : null}
          <div
            className="hud-message-body"
            style={{
              marginTop:
                hudMessage.title === "Live Teleprompter" ||
                ((hudMessage.title === "Meeting Summarizer" ||
                  hudMessage.title.toLowerCase().includes("cuộc họp") ||
                  hudMessage.title.toLowerCase().includes("meeting") ||
                  hudMessage.title.toLowerCase().includes("ghi âm") ||
                  hudMessage.title.toLowerCase().includes("tóm tắt")) &&
                  onOpenMeetingHistory)
                  ? 34
                  : 15,
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {hudMessage.title === "Live Teleprompter" && (teleprompterState?.copilotEnabled || filteredCopilotHistory.length > 0 || isAskingAi || Boolean(hudMessage.copilotStatus) || Boolean(aiQueryError)) ? (
              // Nhắc bài đang bật hoặc có câu hỏi AI: thu gọn phụ đề thô lại thành 1 dải nhỏ phía
              // trên (vẫn thấy được đang nói gì), nhường phần lớn không gian
              // cho bảng câu hỏi/gợi ý — đây là phần chính người dùng cần khi
              // "sếp hỏi thông tin".
              <div
                className="teleprompter-caption-strip hud-hit"
                style={{
                  maxHeight: teleprompterState?.translateEnabled && teleprompterState?.copilotEnabled ? "140px" : undefined,
                  overflowY: teleprompterState?.translateEnabled && teleprompterState?.copilotEnabled ? "auto" : undefined,
                  borderBottom: teleprompterState?.translateEnabled && teleprompterState?.copilotEnabled ? "1px solid rgba(255,255,255,0.08)" : undefined,
                  paddingBottom: teleprompterState?.translateEnabled && teleprompterState?.copilotEnabled ? "6px" : undefined,
                  marginBottom: teleprompterState?.translateEnabled && teleprompterState?.copilotEnabled ? "6px" : undefined,
                }}
              >
                {hudMessage.content.split("\n").map(renderTranscriptLine)}
              </div>
            ) : (
              hudMessage.content.split("\n").map(renderTranscriptLine)
            )}

            {hudMessage.title === "Live Teleprompter" && (teleprompterState?.copilotEnabled || filteredCopilotHistory.length > 0 || isAskingAi || Boolean(hudMessage.copilotStatus) || Boolean(aiQueryError)) ? (
              <div className="copilot-panel hud-hit">
                <div
                  className="copilot-history-scroll"
                  ref={copilotScrollRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    // Coi là "đang ở cuối" nếu còn cách đáy dưới 60px — cho phép
                    // tự cuộn tiếp khi có gợi ý mới, trừ khi người dùng chủ động
                    // kéo lên xem lại các câu hỏi cũ.
                    copilotStickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                  }}
                >
                  {filteredCopilotHistory.length === 0 ? (
                    <div className="copilot-history-empty">
                      💡 Nhắc bài đã bật — câu hỏi và gợi ý trả lời sẽ hiện ở đây, không bị mất khi có câu hỏi mới.
                    </div>
                  ) : (
                    filteredCopilotHistory.map((entry) => (
                      <div key={entry.id} className="copilot-entry">
                        <div className="copilot-entry-meta">
                          <span className="copilot-entry-question" title={entry.question}>❓ {entry.question}</span>
                          {entry.engine ? (
                            <span
                              className="copilot-entry-engine"
                              style={{
                                fontSize: 10,
                                padding: "1px 6px",
                                borderRadius: 4,
                                marginLeft: "auto",
                                marginRight: 8,
                                fontWeight: 500,
                                color: entry.engine.toLowerCase().includes("claude") ? "#fb923c" : "#38bdf8",
                                background: entry.engine.toLowerCase().includes("claude") ? "rgba(251,146,60,0.15)" : "rgba(56,189,248,0.15)",
                                border: `1px solid ${entry.engine.toLowerCase().includes("claude") ? "rgba(251,146,60,0.3)" : "rgba(56,189,248,0.3)"}`,
                              }}
                            >
                              {entry.engine}
                            </span>
                          ) : null}
                          <span className="copilot-entry-time">{new Date(entry.ts).toLocaleTimeString()}</span>
                        </div>
                        <div className="ai-suggestion-box">💡 {entry.answer}</div>
                      </div>
                    ))
                  )}
                </div>
                {hudMessage.copilotStatus ? (
                  <div className="ai-suggestion-status">{hudMessage.copilotStatus}</div>
                ) : isAskingAi ? (
                  <div className="ai-suggestion-status">⏳ Đang gửi câu hỏi tới AI...</div>
                ) : null}
                {aiQueryError ? (
                  <div className="ai-suggestion-status" style={{ color: "#f87171" }}>
                    ⚠️ {aiQueryError}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Slim work stream, top-right — collapsible like Comms */}
      <div className="hud-right">
        <button
          type="button"
          className={`hud-comms-toggle hud-hit ${workOpen ? "open" : ""}`}
          onClick={() => setWorkOpen((current) => !current)}
          title={workOpen ? "Collapse tasks" : "Show tasks"}
        >
          <Terminal size={12} />
          Tasks
          <span className="count">{visibleTasks.length}</span>
          <ChevronDown size={12} className="chev" />
        </button>
        {workOpen ? (
          <div className="hud-work hud-hit" ref={workScrollRef}>
            {visibleTasks.length === 0 ? (
              <div className="hud-work-empty">
                Chưa có tác vụ nào
              </div>
            ) : (
              visibleTasks.map((task) => (
                <WorkCard
                  key={task.id}
                  task={task}
                  accepted={Boolean(acceptedIds[acceptedKey(task.task)])}
                  stepsOpen={Boolean(stepsOpenIds[task.id])}
                  onToggleSteps={() => onToggleSteps(task.id)}
                  onOpen={() => onOpenTask(task)}
                />
              ))
            )}
          </div>
        ) : null}
      </div>

      {/* Left column, bottom-left: collapsible comms on top, camera at the corner */}
      <div className="hud-left" ref={commsWrapperRef}>
        {recentTranscript.length > 0 ? (
          <>
            <button
              type="button"
              className={`hud-comms-toggle hud-hit ${commsOpen ? "open" : ""}`}
              onClick={() => setCommsOpen((current) => !current)}
              title={commsOpen ? "Collapse conversation" : "Show conversation"}
            >
              <MessageSquare size={12} />
              Comms
              <span className="count">{recentTranscript.length}</span>
              <ChevronDown size={12} className="chev" />
            </button>
            {commsOpen ? (
              <>
                <div className="hud-comms hud-hit" ref={commsScrollRef}>
                  {recentTranscript.map((line) => {
                    const self = /you|user/i.test(line.speaker);
                    return (
                      <div className={`bubble ${self ? "self" : "iris"}`} key={line.id}>
                        <span className="who">{self ? "You" : "Iris"}</span>
                        {line.text}
                      </div>
                    );
                  })}
                </div>
                <div className="hud-hit">
                  <ContextSupplementInput disabled={!awake} onSubmit={onSendSupplement} />
                </div>
              </>
            ) : null}
          </>
        ) : null}
        {handControl ? (
          <HudCamera
            stream={handStream}
            hand={hand}
            actionLabel={handActionLabel}
            actionTone={handActionTone}
          />
        ) : null}
      </div>

      {/* Orb cluster, bottom-right */}
      <div className="hud-orb-cluster hud-hit">
        <div
          className="orb-stage hud-orb"
          ref={orbStageRef}
          style={{ "--orb-accent": ORB_ACCENT[reactorState] } as CSSProperties}
        >
          <span className="orb-ring" />
          <span className="orb-radar" />
          <ReactorCore
            state={reactorState}
            inputLevelRef={inputLevelRef}
            outputLevelRef={outputLevelRef}
            thinking={thinking}
            wakeKey={wakeKey}
            rippleKey={rippleKey}
          />
          {orbFlash ? (
            <span key={orbFlash.id} className={`orb-flash ${orbFlash.tone}`} onAnimationEnd={onOrbFlashEnd} />
          ) : null}
          {isVisionEnabled ? (
            <div className="vision-indicator" title="Live screen vision active">
              <Eye size={18} />
            </div>
          ) : null}
        </div>
        <div className={`hud-controls ${hand.present ? "show" : ""}`}>
          {awake ? (
            <>
              <button
                className={`hud-btn ${muted ? "muted" : ""}`}
                onClick={onToggleMute}
                title={muted ? "Unmute microphone" : "Mute microphone"}
              >
                {muted ? <MicOff size={14} /> : <Mic size={14} />}
              </button>
              <button className="hud-btn danger" onClick={onSleep} title="Sleep">
                <Power size={14} />
              </button>
            </>
          ) : (
            <button className="hud-btn wake" onClick={onWake} title="Wake Iris">
              <Power size={14} />
            </button>
          )}
          <button
            className={`hud-btn ${handControl ? "active" : ""}`}
            onClick={onToggleHand}
            title={handControl ? "Disable hand control" : "Enable hand control (camera)"}
          >
            <Hand size={14} />
          </button>
          {onToggleDrawing ? (
            <button
              className={`hud-btn ${drawingActive ? "active" : ""}`}
              onClick={onToggleDrawing}
              title={drawingActive ? "Hide drawing panel" : "Show drawing panel"}
            >
              <PenTool size={14} />
            </button>
          ) : null}
          {onToggleSecondBrain && secondBrainAvailable ? (
            <button
              className={`hud-btn ${secondBrainActive ? "active" : ""}`}
              onClick={onToggleSecondBrain}
              title={secondBrainActive ? "Hide second brain" : "Show second brain"}
            >
              <Network size={14} />
            </button>
          ) : null}
          <button className="hud-btn" onClick={onExitHud} title="Back to deck (⌥Space)">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      {/* Ported from myiris (hud-drawing-canvas / second-brain-galaxy-view) */}
      {drawingActive ? <DrawingCanvas onClose={onToggleDrawing} /> : null}
      {secondBrainActive ? (
        <SecondBrainPanel
          running={awake}
          positionsRef={galaxyPositionsRef ?? { current: new Map() }}
          onOpenNote={onOpenNote ?? (() => {})}
          onForceClose={onForceCloseSecondBrain ?? (() => {})}
          onClose={onToggleSecondBrain}
          handRef={handStateRef ?? { current: hand }}
          handControl={Boolean(handControl)}
          readerOpen={Boolean(readerOpen)}
        />
      ) : null}
    </div>
  );
}

// Same drag-to-move / corner-to-resize behavior as DrawingCanvas, split into
// its own component because useFloatingPanel is a hook and secondBrainActive
// mounts/unmounts this whole subtree rather than toggling within it — so the
// hook lives here, not in HudShell itself, keeping HudShell's own hook order
// unconditional.
function SecondBrainPanel({
  onClose,
  ...galaxyProps
}: {
  onClose: (() => void) | undefined;
} & Parameters<typeof VaultGalaxy>[0]) {
  const [initialRect] = useState(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return { left: vw * 0.08, top: vh * 0.08, width: vw * 0.84, height: vh * 0.84 };
  });
  const { rect, startDrag, startResize } = useFloatingPanel(initialRect);

  return (
    <div
      className="hud-galaxy-wrap hud-hit"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <div className="hud-panel-header" onPointerDown={startDrag} title="Drag to move">
        <GripHorizontal size={14} className="hud-panel-grip" />
        <span className="hud-panel-title">Second Brain</span>
        {onClose ? (
          <button
            type="button"
            data-panel-no-drag
            className="hud-drawing-close"
            onClick={onClose}
            title="Close second brain (Esc)"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>
      <div className="hud-panel-body">
        <VaultGalaxy {...galaxyProps} />
      </div>
      <div className="hud-panel-resize-handle" onPointerDown={startResize} title="Drag to resize" />
    </div>
  );
}
