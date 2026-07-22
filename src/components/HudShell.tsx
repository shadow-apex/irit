import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { ChevronDown, Hand, Maximize2, MessageSquare, Mic, MicOff, Power, Terminal, Eye } from "lucide-react";
import ReactorCore from "./ReactorCore";
import WorkCard from "./WorkCard";
import PoQuestionBanner from "./PoQuestionBanner";
import ContextSupplementInput from "./ContextSupplementInput";
import { HandSkeleton } from "./CameraDock";
import type { HandoffTone, ReactorState, TaskCard, TranscriptLine } from "../types";
import type { HandState } from "../hooks/useHandControl";
import { acceptedKey } from "../lib/tasks";

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
  hudMessage?: { title: string; content: string } | null;
  onDismissHudMessage?: () => void;
}) {
  // Show the full stream (state caps at 20); the column has a fixed max height
  // and palm-scrolls like Comms.
  const visibleTasks = tasks;
  const recentTranscript = transcript.slice(-8);
  // Comms is glanceable, not essential — collapsed by default (the caption
  // pill by the orb already shows the latest line). Tasks are the core of the
  // HUD, so they start open but can be tucked away the same way.
  const [commsOpen, setCommsOpen] = useState(false);
  const [workOpen, setWorkOpen] = useState(true);

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

  return (
    <div className={`hud-shell ${awake ? "awake" : "asleep"}`}>
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

      {/* Iron Man Glass System Stats */}
      {hudStats && awake ? (
        <div className="hud-stats-widget hud-hit">
          <div className="stats-row">
            <span className="stats-label">RAM</span>
            <span className="stats-value">
              {Math.round((hudStats.ramTotal - hudStats.ramFree) / 1024 / 1024 / 1024 * 10) / 10}GB / {Math.round(hudStats.ramTotal / 1024 / 1024 / 1024)}GB
            </span>
            <div className="stats-bar">
              <div 
                className="stats-fill" 
                style={{ width: `${((hudStats.ramTotal - hudStats.ramFree) / hudStats.ramTotal) * 100}%` }} 
              />
            </div>
          </div>
          <div className="stats-row">
            <span className="stats-label">TASKS</span>
            <span className="stats-value">
              {hudStats.activeTasks} RUNNING / {hudStats.queuedTasks} QUEUED
            </span>
          </div>
        </div>
      ) : null}

      {/* Center Message Widget */}
      {hudMessage ? (
        <div 
          className="hud-message-center hud-hit"
          onMouseDown={handleMsgMouseDown}
          style={{ 
            transform: `translate(calc(-50% + ${msgPos.x}px), ${msgPos.y}px)`,
            transition: isMsgDragging ? "none" : "transform 0.1s ease-out",
            cursor: isMsgDragging ? "grabbing" : "auto"
          }}
        >
          <button className="hud-message-close" onClick={onDismissHudMessage} style={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
            </svg>
          </button>
          <div className="hud-message-body" style={{ marginTop: 15, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {hudMessage.content.split("\n").map((line: string, i: number) => {
              if (line.trim().length === 0) return null;
              if (line.startsWith("💡")) {
                return <div key={i} className="ai-suggestion-box">{line}</div>;
              }
              if (line.startsWith("[Bạn]")) {
                return <p key={i} style={{ color: '#4ade80' }}><strong>Bạn:</strong> {line.replace("[Bạn]", "").trim()}</p>;
              } else if (line.startsWith("[Đối tác]")) {
                return <p key={i} style={{ color: '#60a5fa' }}><strong>Đối tác:</strong> {line.replace("[Đối tác]", "").trim()}</p>;
              } else if (line.startsWith("[Chung]")) {
                return <p key={i} style={{ color: '#9ca3af' }}>{line.replace("[Chung]", "").trim()}</p>;
              }
              return <p key={i}>{line}</p>;
            })}
          </div>
        </div>
      ) : null}

      {/* Slim work stream, top-right — collapsible like Comms */}
      {visibleTasks.length > 0 ? (
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
              {visibleTasks.map((task) => (
                <WorkCard
                  key={task.id}
                  task={task}
                  accepted={Boolean(acceptedIds[acceptedKey(task.task)])}
                  stepsOpen={Boolean(stepsOpenIds[task.id])}
                  onToggleSteps={() => onToggleSteps(task.id)}
                  onOpen={() => onOpenTask(task)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Left column, bottom-left: collapsible comms on top, camera at the corner */}
      <div className="hud-left">
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
        <div className={`hud-caption ${captionDim ? "dim" : ""}`}>
          {awake ? caption : wakeWordEnabled ? "Say “Hey Iris”" : "Iris is asleep"}
        </div>
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
          <button className="hud-btn" onClick={onExitHud} title="Back to deck (⌥Space)">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
