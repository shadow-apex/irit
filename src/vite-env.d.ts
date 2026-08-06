/// <reference types="vite/client" />

type SidecarMode = "none" | "camera" | "screen";

type SidecarEvent = {
  type: string;
  timestamp?: number;
  [key: string]: unknown;
};

type LiveAudioChunk = {
  data: string;
  mimeType?: string;
};

type AgentRole = "po" | "dev" | "study";

// Live Teleprompter (Alt+T) "Nhắc bài" — 1 gợi ý đã lưu vào lịch sử, kèm
// nguyên văn ngữ cảnh/câu hỏi đã dùng để tạo ra gợi ý đó (để dễ tìm lại).
type TeleprompterCopilotEntry = {
  id: string;
  question: string;
  answer: string;
  ts: number;
  engine?: string;
};

// Ported from myiris (prompt-review-gate spec): a brief parked by
// submit_claude_task for Approve/Edit/Cancel before any Claude tokens are
// spent.
type PendingTaskReview = {
  workstreamId: string;
  task: string;
  urgency: string;
  agent: AgentRole | null;
};

type PromptReviewResolveAction = "approve" | "cancel";

// Ported from myiris (hud-drawing-canvas): the canonical excalidraw scene
// JSON (serializeAsJSON's shape) — main only caches/persists it, never
// inspects elements/appState contents, so this stays loosely typed.
type CanvasScene = {
  type: string;
  version?: number;
  source?: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

type NativeFileResult = { canceled: true } | { canceled: false; filePath: string };

// Ported from myiris (second-brain-galaxy-view): position-free — the
// renderer's force simulation owns x/y/z. A ghost node (unresolved wikilink
// target) is not openable.
type VaultGraphNode = {
  id: string;
  title: string;
  tags: string[];
  ghost: boolean;
  malformed: boolean;
};

type VaultGraphLink = {
  source: string;
  target: string;
};

type VaultGraph = {
  nodes: VaultGraphNode[];
  links: VaultGraphLink[];
};

type SecondBrainAvailability = { available: boolean };
type SecondBrainGraphResult = { graph: VaultGraph; available: boolean };
type SecondBrainReadNoteResult = { ok: true; content: string } | { ok: false };

type CanvasApplyPayload = { elements: unknown[] };
type CanvasImageRequestPayload = { id: string };
type CanvasImagePayload = { mimeType: string; data: string } | null;

type ClaudeSession = {
  id: string;
  label: string;
  agent_sessions: Partial<Record<AgentRole | "default", string>>;
  active_agent: AgentRole | null;
  last_agent_used: AgentRole | null;
  cwd: string | null;
  created_at: number;
  last_used_at: number;
  last_task: string;
};

type SessionsSnapshot = {
  active: string | null;
  sessions: ClaudeSession[];
};

type AgentInfo = {
  key: AgentRole;
  label: string;
  installed: boolean;
  description: string;
  model: string | null;
};

type AgentsSnapshot = {
  roster: AgentInfo[];
  installed: boolean;
  hasProject: boolean;
  gates: {
    slug: string | null;
    byRole: Partial<Record<AgentRole, boolean>>;
  };
};

type AgentsInstallResult = {
  status: "ok" | "partial" | "error";
  error?: string;
  installed: string[];
  skipped: string[];
  removed?: string[];
  errors: string[];
};

type PoQuestionOption = {
  label: string;
  description: string;
  preview?: string;
};

type PoQuestion = {
  question: string;
  header: string;
  options: PoQuestionOption[];
};

type PoQuestionAnswer = {
  question: string;
  choice: string;
};

type IrisConfig = {
  geminiApiKey: string;
  geminiModel: string;
  geminiVoice: string;
  userName: string;
  loadTestData: boolean;
  wakeWord: boolean;
  promptReviewMode: boolean;
  configured: boolean;
  voices: string[];
  models: string[];
  configPath: string;
};

type ClaudeHealth = {
  reachable: boolean;
  version?: string;
  error?: string;
  billingOk: boolean;
  billingError?: string;
};

type UiActionPayload = {
  action: string;
  target_id?: string;
  query?: string;
};

type UiMode = "deck" | "hud";

type UiContextSnapshot = {
  expandedTaskId: string | null;
  focusedTaskId: string | null;
  latestResultTaskId: string | null;
  pendingTaskMatches: Array<{ index: number; id: string; task: string; status: string }>;
  showHistory: boolean;
  tasks: Array<{
    id: string;
    task: string;
    status: string;
    hasResult: boolean;
    stepCount: number;
    stepsOpen: boolean;
    updatedAt: number;
  }>;
  uiMode: UiMode;
};

type IrisApi = {
  startSidecar: (options?: { mode?: SidecarMode }) => Promise<{ running: boolean; pid: number | null }>;
  stopSidecar: () => Promise<{ running: boolean; pid: number | null }>;
  getSidecarStatus: () => Promise<{ running: boolean; pid: number | null }>;
  sendCommand: (command: Record<string, unknown>) => Promise<void>;
  getSessions: () => Promise<SessionsSnapshot>;
  selectSession: (id: string) => Promise<SessionsSnapshot & { status?: string }>;
  newSession: (label?: string) => Promise<SessionsSnapshot & { status?: string }>;
  chooseProjectFolder: (
    id?: string,
  ) => Promise<SessionsSnapshot & { status?: string; error?: string }>;
  listAgents: (workstreamId?: string) => Promise<AgentsSnapshot>;
  selectAgent: (
    workstreamId: string,
    agent: AgentRole | null,
  ) => Promise<SessionsSnapshot & { status?: string; error?: string }>;
  getRobots: () => Promise<any>;
  // FEAT-SH-CAM-01: Smart Home Camera Vision config (smarthome_cameras.json)
  getSmartHomeCamerasConfig?: () => Promise<any>;
  installAgents: () => Promise<AgentsInstallResult>;
  setAgentModel: (
    workstreamId: string,
    role: AgentRole,
    model: string,
  ) => Promise<SessionsSnapshot & { status?: string; error?: string }>;
  answerPoQuestion: (answers: PoQuestionAnswer[]) => Promise<{ status: string; error?: string }>;
  sendContextSupplement: (text: string) => Promise<{ status: string; error?: string }>;
  sendPhoneCommand: (text: string) => Promise<{ status: string; error?: string }>;
  toggleHud: () => Promise<{ mode: UiMode }>;
  setHudInteractive: (on: boolean) => void;
  windowControl: (action: "close" | "minimize") => void;
  onHudMode: (callback: (payload: { mode: UiMode }) => void) => () => void;
  onWakeRequest: (callback: () => void) => () => void;
  getConfig: () => Promise<IrisConfig>;
  saveConfig: (updates: Partial<Record<string, string>>) => Promise<IrisConfig>;
  testGemini: (key: string) => Promise<{ ok: boolean; error?: string }>;
  testClaude: () => Promise<ClaudeHealth>;
  previewVoice: (payload: { voice: string; key: string }) => Promise<{ ok: boolean; error?: string }>;
  // --- Ported from myiris ---
  getPromptStatus: () => Promise<{ reviewMode: boolean }>;
  resolvePromptReview: (payload: {
    action: PromptReviewResolveAction;
    editedTask?: string;
  }) => Promise<{ status: string; error?: string }>;
  setPromptReviewMode: (enabled: boolean) => Promise<{ status: string; reviewMode: boolean }>;
  activateDrawingCanvas: () => void;
  saveCanvasScene: (scene: CanvasScene) => void;
  getCanvasScene: () => Promise<CanvasScene | null>;
  nativeOpenCanvasFile: () => Promise<{ canceled: true } | { canceled: false; content: string }>;
  nativeSaveCanvasFile: (content: string, suggestedName?: string) => Promise<NativeFileResult>;
  nativeExportCanvasImage: (
    data: string,
    format: "png" | "svg",
    suggestedName?: string,
  ) => Promise<NativeFileResult>;
  onCanvasApply: (callback: (payload: CanvasApplyPayload) => void) => () => void;
  onCanvasImageRequest: (callback: (payload: CanvasImageRequestPayload) => void) => () => void;
  replyCanvasImage: (id: string, image: CanvasImagePayload) => void;
  getSecondBrainAvailability: () => Promise<SecondBrainAvailability>;
  getSecondBrainGraph: () => Promise<SecondBrainGraphResult>;
  readSecondBrainNote: (id: string) => Promise<SecondBrainReadNoteResult>;
  activateSecondBrain: () => void;
  deactivateSecondBrain: () => void;
  onSecondBrainGraphUpdated: (callback: (graph: VaultGraph) => void) => () => void;
  installNotesSkills: () => Promise<{ status: string; installed: string[]; skipped: string[]; errors: string[] }>;
  getNotesSkillsStatus: () => Promise<{ ok: boolean; missing: string[]; skillsDir: string }>;
  sendUiContext: (context: UiContextSnapshot) => void;
  notifyBootDone: () => void;
  onUiAction: (callback: (payload: UiActionPayload) => void) => () => void;
  onSleepRequest: (callback: () => void) => () => void;
  sendAudioChunk: (chunk: ArrayBuffer) => void;
  onAudioChunk: (callback: (chunk: LiveAudioChunk) => void) => () => void;
  onAudioInterrupt: (callback: () => void) => () => void;
  onSilentModeChange: (callback: (payload: { enabled: boolean }) => void) => () => void;
  onActionLanesChange: (callback: (payload: any[]) => void) => () => void;
  onSidecarEvent: (callback: (event: SidecarEvent) => void) => () => void;
  sendHandGesture: (gesture: string | { type: string; x?: number; y?: number }) => void;
  onHudStats: (callback: (stats: any) => void) => () => void;
  onHudMessage: (callback: (msg: any) => void) => () => void;
  getTeleprompterState: () => Promise<{
    transcriberActive: boolean;
    translateEnabled: boolean;
    translateTargetLang: string;
    copilotEnabled: boolean;
    copilotHistory: TeleprompterCopilotEntry[];
    copilotStatus: string;
  }>;
  toggleTranslate: (targetLang: string) => Promise<{ status: string; message: string }>;
  toggleInterviewCopilot: () => Promise<{ status: string; message: string }>;
  askTeleprompter: (question: string) => Promise<{ status: string; error?: string }>;
  onSnapDeskVision: (callback: () => void) => () => void;
  sendDeskVisionFrame: (data: string) => void;
  onToggleDeskContinuous: (callback: (enabled: boolean) => void) => () => void;
  // FEAT-VIS-DIRECT-01: Direct Stream Vision (companion/robot camera, no desktopCapturer)
  sendCameraStreamFrame: (data: string) => void;
  onToggleCameraStreamVision: (callback: (enabled: boolean) => void) => () => void;
  getLocalIp?: () => Promise<string>;
  startCompanionExpo?: () => Promise<any>;
  getCompanionTunnel?: () => Promise<string | null>;
  // BUG-COMP-02 FIX: Expose companion camera frame listener types
  onCompanionFrame?: (callback: (base64Jpeg: string) => void) => () => void;
  onCompanionStatus?: (callback: (payload: any) => void) => () => void;
  // PiP Global Hotkey Listeners
  onToggleRobotPip?: (callback: () => void) => () => void;
  onToggleCompanionPip?: (callback: () => void) => () => void;
  // FEAT-SH-CAM-01: Alt+H hotkey listener for the Smart Home Cameras PiP.
  onToggleSmartHomePip?: (callback: () => void) => () => void;
  // FEAT-COMP-LIVE-01: main -> renderer signal to open the big centered
  // Companion Live View window (voice command / tool open_companion_live_view).
  onOpenCompanionLiveView?: (callback: () => void) => () => void;
  getCompanionWsTunnel?: () => Promise<string | null>;
  getCompanionWsToken?: () => Promise<string | null>;
  getPhoneCamUrl?: () => Promise<string | null>;
  onCompanionWebRTCSignal?: (callback: (signal: any) => void) => () => void;
  sendCompanionWebRTCSignal?: (signal: any) => void;
  sendCompanionWebRTCFrame?: (base64: string) => void;
  sendCompanionWebRTCAudio?: (pcm: ArrayBuffer) => void;
  triggerRobotAction?: (args: {
    robot_id: string;
    action: string;
    params?: Record<string, unknown>;
  }) => Promise<{ status: string; message?: string; error?: string }>;
  openApp?: (target: string) => Promise<{ success: boolean; error?: string }>;
  getDesktopApps?: () => Promise<Array<{ name: string; target: string }>>;
};
interface Window {
  iris: IrisApi;
  // Read by @excalidraw/excalidraw to resolve its fonts locally instead of
  // its default CDN.
  EXCALIDRAW_ASSET_PATH?: string;
}
