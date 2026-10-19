import { useCallback, useEffect, useState } from "react";
import { Hand, PictureInPicture2, Radio, Settings, Bot, Smartphone, Monitor, Subtitles, Disc, Loader2 } from "lucide-react";
import AppLauncher from "./AppLauncher";

function StatusDot({ tone, state, label }: { tone: string; state: string; label: string }) {
  return (
    <span className={`status-dot ${tone} ${state}`}>
      <i />
      {label}
    </span>
  );
}

export default function TopBar({
  geminiDot,
  claudeDot,
  audioDot,
  linked,
  pid,
  handControl,
  onToggleHand,
  onOpenSettings,
  onOpenRobotCameras,
  onOpenCompanionQR,
}: {
  geminiDot: string;
  claudeDot: string;
  audioDot: string;
  linked: boolean;
  pid: number | null;
  handControl: boolean;
  onToggleHand: () => void;
  onOpenSettings: () => void;
  onOpenRobotCameras: () => void;
  onOpenCompanionQR: () => void;
}) {
  const [isScreenVision, setIsScreenVision] = useState(false);
  const [isMeetingRecording, setIsMeetingRecording] = useState(false);
  const [isMeetingSummarizing, setIsMeetingSummarizing] = useState(false);
  const [meetingStatusText, setMeetingStatusText] = useState("");
  const [meetingStartTime, setMeetingStartTime] = useState<number | null>(null);
  const [recordingDuration, setRecordingDuration] = useState("");
  const [isTeleprompter, setIsTeleprompter] = useState(false);

  const refreshStates = useCallback(() => {
    window.iris?.getScreenVisionState?.().then((s) => setIsScreenVision(!!s?.isVisionEnabled)).catch(() => {});
    window.iris
      ?.getMeetingRecordingState?.()
      .then((s) => {
        setIsMeetingRecording(!!s?.isRecording);
        setIsMeetingSummarizing(!!s?.isSummarizing);
        setMeetingStatusText(s?.statusText || "");
        setMeetingStartTime(s?.startTime || null);
      })
      .catch(() => {});
    window.iris?.getTeleprompterState?.().then((s) => setIsTeleprompter(!!s?.transcriberActive)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isMeetingRecording || !meetingStartTime) {
      setRecordingDuration("");
      return;
    }
    const tick = () => {
      const sec = Math.max(0, Math.floor((Date.now() - meetingStartTime) / 1000));
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      setRecordingDuration(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [isMeetingRecording, meetingStartTime]);

  useEffect(() => {
    refreshStates();
    const iv = setInterval(refreshStates, 1500);
    return () => clearInterval(iv);
  }, [refreshStates]);

  const handleToggleScreenVision = async () => {
    await window.iris?.toggleScreenVision?.();
    refreshStates();
  };

  const handleToggleTeleprompter = async () => {
    await window.iris?.toggleLiveTranscriber?.();
    refreshStates();
  };

  const handleToggleMeeting = async () => {
    if (isMeetingSummarizing) return;
    await window.iris?.toggleMeetingRecording?.();
    refreshStates();
  };

  return (
    <header className="deck-top">
      <div className="deck-top-left">
        <div className="win-controls">
          <button
            className="win-dot close"
            onClick={() => window.iris?.windowControl("close")}
            title="Close"
            aria-label="Close window"
          />
          <button
            className="win-dot min"
            onClick={() => window.iris?.windowControl("minimize")}
            title="Minimize"
            aria-label="Minimize window"
          />
          <button
            className="win-dot max"
            onClick={() => window.iris?.toggleFullscreen?.()}
            title="Toàn màn hình (Ctrl + Space)"
            aria-label="Toggle Fullscreen"
          />
        </div>
        <div className="deck-status">
          <StatusDot tone="gemini" state={geminiDot} label="Gemini" />
          <StatusDot tone="claude" state={claudeDot} label="Claude" />
          <StatusDot tone="audio" state={audioDot} label="Audio" />
        </div>
      </div>
      <div className="deck-brand">
        <span className="brand-mark">I.R.I.S</span>
      </div>
      <div className="deck-top-right">
        <button
          className={`theme-toggle ${isScreenVision ? "active" : ""}`}
          onClick={handleToggleScreenVision}
          title={`Chia sẻ màn hình / Screen Vision (Alt+S)${isScreenVision ? " · Đang chia sẻ" : ""}`}
          aria-label="Toggle Screen Vision"
        >
          <Monitor size={16} />
        </button>
        <button
          className={`theme-toggle ${isTeleprompter ? "active" : ""}`}
          onClick={handleToggleTeleprompter}
          title={`Live Teleprompter / Nhắc bài & Dịch (Alt+T)${isTeleprompter ? " · Đang bật" : ""}`}
          aria-label="Toggle Live Teleprompter"
        >
          <Subtitles size={16} />
        </button>
        <button
          className={`theme-toggle ${isMeetingRecording || isMeetingSummarizing ? "active" : ""}`}
          onClick={handleToggleMeeting}
          disabled={isMeetingSummarizing}
          title={
            isMeetingSummarizing
              ? `Đang xử lý cuộc họp: ${meetingStatusText || "Đang bóc băng & tóm tắt..."}`
              : `Ghi âm & Tóm tắt cuộc họp (Alt+M)${isMeetingRecording ? ` · Đang ghi âm (${recordingDuration || "00:00"})` : ""}`
          }
          aria-label="Toggle Meeting Recording"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            width: isMeetingRecording && recordingDuration ? "auto" : undefined,
            padding: isMeetingRecording && recordingDuration ? "0 8px" : undefined,
          }}
        >
          {isMeetingSummarizing ? <Loader2 size={16} className="spin" /> : <Disc size={16} />}
          {isMeetingRecording && recordingDuration && (
            <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: "#ef4444" }}>
              {recordingDuration}
            </span>
          )}
        </button>
        <AppLauncher />
        <button
          className="theme-toggle"
          onClick={() => window.iris?.toggleHud()}
          title="Glass HUD — float Iris over your screen (⌥Space)"
        >
          <PictureInPicture2 size={16} />
        </button>
        <button
          className="theme-toggle"
          onClick={onOpenRobotCameras}
          title="Robot Cameras (Alt+R)"
        >
          <Bot size={16} />
        </button>
        <button
          className="theme-toggle"
          onClick={onOpenCompanionQR}
          title="Companion App QR Code (Alt+Q)"
        >
          <Smartphone size={16} />
        </button>
        <button
          className={`theme-toggle ${handControl ? "active" : ""}`}
          onClick={onToggleHand}
          title={handControl ? "Disable hand control" : "Enable hand control (camera)"}
        >
          <Hand size={16} />
        </button>
        <span
          className={`link-indicator ${linked ? "on" : "off"}`}
          title={linked ? `Linked${pid ? ` · ${pid}` : ""}` : "Offline"}
        >
          <Radio size={16} />
        </span>
        <button className="theme-toggle" onClick={onOpenSettings} title="Settings">
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
