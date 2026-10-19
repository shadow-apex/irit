import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Loader2,
  Mic,
  Play,
  ScanEye,
  Square,
  Wand2,
  X,
} from "lucide-react";

type Mode = "onboarding" | "settings";
type TestState = { status: "idle" | "testing" | "ok" | "error"; message?: string };
// Trạng thái OmniParser lưu dạng dữ liệu thô (không lưu chuỗi đã dịch) để badge luôn đúng ngôn ngữ đang chọn.
type OmniPhase = "stopped" | "starting" | "stopping" | "running" | "error";
type OmniUi = { phase: OmniPhase; port: number; url: string; mode: string | null; error?: string };
type PermState = "idle" | "granted" | "denied";
type Lang = "en" | "vi";

type Draft = {
  GEMINI_API_KEY: string;
  GEMINI_VISION_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  GEMINI_LIVE_MODEL: string;
  GEMINI_LIVE_VOICE: string;
  IRIS_USER_NAME: string;
  IRIS_LOAD_TEST_DATA: string;
  IRIS_WAKE_WORD: string;
  IRIS_PROMPT_REVIEW_MODE: string;
  IRIS_CLAUDE_ENABLED: string;
  IRIS_UNIVERSAL_APPS: string;
  IRIS_TERMINAL_EXEC: string;
  IRIS_FILESYSTEM_OPS: string;
  IRIS_WINDOW_MANAGER: string;
  IRIS_SYSTEM_OPS: string;
  OMNIPARSER_ENABLED: string;
};

const WIZARD_STEPS = ["welcome", "gemini", "claude", "you", "permissions", "finish"] as const;
const SYSTEM_DEFAULT_CAMERA = "default";

const I18N = {
  en: {
    settings: "Settings",
    tabAi: "AI & Keys",
    tabVoice: "Voice & Persona",
    tabSystem: "System & Controls",
    language: "Language / Ngôn ngữ",
    langEn: "English (Default)",
    langVi: "Tiếng Việt",
    geminiTitle: "Gemini API Key Pool (3 Primary + 7 Standby)",
    geminiHint: "3 dedicated keys (Live, Meeting, Vision) + 7 shared standby keys to auto-bypass 429.",
    apiKey: "Gemini API Key Pool (One key per line)",
    apiKeySaved: "•••• Stored (enter new to change)",
    apiKeyPlaceholder: "Paste list of Gemini API keys (one per line)...",
    apiKeyNote: "Get free keys from Google AI Studio. Invalid keys are filtered automatically.",
    visionKey: "Dedicated Vision API Key (Optional)",
    visionKeySaved: "•••• Stored (enter new to change)",
    visionKeyPlaceholder: "Key 3 in pool is already for Vision. Set only for separate key.",
    visionKeyNote: "Key 3 in Key Pool is already dedicated to Vision. Leave empty to use Key 3.",
    testGemini: "Test & Clean Keys",
    formatClean: "Format 1 key/line",
    keyWorks: "All keys ready",
    omniStart: "Start Omni",
    omniStop: "Stop Omni",
    omniRunning: "Running (Port {port})",
    omniStopped: "Stopped",
    omniStarting: "Starting…",
    omniStopping: "Stopping…",
    omniError: "Failed to start",
    omniTitle: "OmniParser Vision (Local AI)",
    omniDesc: "Local screen UI parser for precise icon and text clicking. When stopped, Iris falls back to Gemini Vision automatically.",
    omniEndpoint: "Local Endpoint",
    omniMode: "Mode",
    claudeTitle: "Claude Brain",
    claudeHint: "Worker brain — PO/DEV pipeline runs on Claude Code CLI.",
    claudeBrain: "Claude Brain",
    claudeBrainNote: "When off, Gemini handles tasks locally without Claude.",
    anthropicKey: "Anthropic API Key (Optional)",
    anthropicKeySaved: "•••• Stored (enter new to change)",
    anthropicKeyPlaceholder: "Used for Computer Use & OmniParser",
    anthropicKeyNote: "Grants Claude permission for desktop control.",
    checkClaude: "Check Claude",
    ready: "Ready",
    on: "On",
    off: "Off",
    youTitle: "Voice & Persona",
    youHint: "Personalize how Iris speaks and addresses you.",
    displayName: "Display Name",
    displayNamePlaceholder: "Your name",
    displayNameNote: "What Iris calls you out loud.",
    voice: "Voice",
    voiceNote: "Iris's speaking voice. Tap Preview to hear a sample.",
    preview: "Preview",
    previewDisabledTitle: "Add your Gemini key first",
    model: "Model",
    modelNote: "Gemini Live model that powers realtime voice.",
    sounds: "Interface Sounds",
    soundsNote: "Subtle audio cues for wake, sleep, and tasks.",
    permsTitle: "Permissions & Devices",
    permsHint: "Required for voice conversation and optional camera gestures.",
    mic: "Microphone",
    camera: "Camera (Gestures)",
    gestureCam: "Gesture Camera Device",
    grantCamFirst: "Grant Camera permission above to choose a device.",
    sysDefault: "System Default",
    wakeWord: "Wake Word — “Hey Iris”",
    wakeWordNote: "Listens locally on-device for “Hey Iris” (same as pressing W).",
    reviewGate: "Review Gate (Prompt Approval)",
    reviewGateNote: "Review and approve Claude prompts before sending.",
    notesSkills: "Personal Notes / Second Brain",
    notesInstalling: "Installing…",
    notesInstalled: "Installed",
    notesInstallMissing: "Install missing",
    notesMissing: "Missing: ",
    notesSkillsNote: "Installs wiki-* skills for note retrieval in ~/iris-second-brain.",
    superPowersTitle: "Super Assistant Powers (Computer Authority)",
    superPowersHint: "Toggle Iris's deep computer control capabilities. Destructive actions always require 2-step voice confirmation.",
    universalApps: "Universal App Launcher",
    universalAppsNote: "Find & launch any app on Windows (Start Menu, Registry, Store).",
    terminalExec: "Direct Terminal / PowerShell / Python",
    terminalExecNote: "Execute system commands & scripts directly.",
    filesystemOps: "Full Filesystem & Zip Control",
    filesystemOpsNote: "Read, write, copy, move, delete (with confirmation), and zip/unzip files.",
    windowManager: "Advanced Window Manager",
    windowManagerNote: "List open windows, snap layouts, focus, maximize, and pin Always-On-Top.",
    systemOps: "System, Network, Services & Winget",
    systemOpsNote: "Check ports/IP, manage services, install apps via winget, and clean temp/recycle bin.",
    advancedTitle: "Advanced & Testing",
    advancedHint: "Demo data lets you explore Iris without real Claude work.",
    hudTopNotch: "HUD Top Notch / Sci-Fi Border",
    hudTopNotchNote: "Show futuristic neon border and center notch at the top of HUD (Alt+Space).",
    demoData: "Load Demo / Test Data",
    demoDataNote: "Fills Work Stream with sample task cards.",
    savedTo: "Saved to",
    runWizard: "Run setup wizard",
    cancel: "Cancel",
    save: "Save",
    saveError: "Could not save configuration: ",
    close: "Close",
    granted: "Granted",
    required: "required",
    optional: "optional",
    allow: "Allow",
    retry: "Retry",
  },
  vi: {
    settings: "Cài Đặt",
    tabAi: "AI & Khoá API",
    tabVoice: "Giọng Nói & Ngôn Ngữ",
    tabSystem: "Hệ Thống & Điều Khiển",
    language: "Ngôn Ngữ Giao Diện",
    langEn: "Tiếng Anh (Mặc định)",
    langVi: "Tiếng Việt",
    geminiTitle: "Khoá Gemini API Pool (3 Key Độc Lập + 7 Key Dự Phòng)",
    geminiHint: "3 key độc lập (Live, Meeting, Vision) + 7 key dự phòng dùng chung tự động né lỗi 429.",
    apiKey: "Danh Sách Gemini API Keys (Mỗi key 1 dòng)",
    apiKeySaved: "•••• Đã lưu (nhập khoá mới để thay)",
    apiKeyPlaceholder: "Dán danh sách các key (mỗi key 1 dòng)...",
    apiKeyNote: "Lấy khoá miễn phí tại Google AI Studio. Key lỗi/hết hạn sẽ tự động bị loại bỏ.",
    visionKey: "Khoá Vision API Riêng (Tuỳ chọn)",
    visionKeySaved: "•••• Đã lưu (nhập khoá mới để thay)",
    visionKeyPlaceholder: "Key 3 trong Pool đã dành cho Vision. Chỉ điền nếu dùng key ngoài.",
    visionKeyNote: "Key 3 trong Pool đã dành riêng cho Vision. Nếu để trống sẽ tự dùng Key 3.",
    testGemini: "Kiểm tra & Lọc Key",
    formatClean: "Định dạng 1 key/dòng",
    keyWorks: "Kết nối tốt",
    omniStart: "Bật Omni",
    omniStop: "Tắt Omni",
    omniRunning: "Đang chạy (Cổng {port})",
    omniStopped: "Đang tắt",
    omniStarting: "Đang khởi động…",
    omniStopping: "Đang dừng…",
    omniError: "Khởi động thất bại",
    omniTitle: "OmniParser Vision (AI Cục Bộ)",
    omniDesc: "Bộ nhận diện giao diện màn hình cục bộ để click chính xác icon và văn bản. Khi tắt, Iris tự chuyển sang Gemini Vision.",
    omniEndpoint: "Liên kết cục bộ",
    omniMode: "Chế độ",
    claudeTitle: "Bộ Não Claude",
    claudeHint: "Não xử lý tác vụ — luồng PO/DEV chạy qua Claude Code CLI.",
    claudeBrain: "Chế Độ Claude Brain",
    claudeBrainNote: "Khi tắt, Gemini sẽ xử lý cục bộ không cần Claude.",
    anthropicKey: "Khoá Anthropic API (Tuỳ chọn)",
    anthropicKeySaved: "•••• Đã lưu (nhập khoá mới để thay)",
    anthropicKeyPlaceholder: "Dùng cho Computer Use & OmniParser",
    anthropicKeyNote: "Dùng để cấp quyền cho Claude điều khiển máy tính.",
    checkClaude: "Kiểm tra Claude",
    ready: "Sẵn sàng",
    on: "Bật",
    off: "Tắt",
    youTitle: "Giọng Nói & Cá Nhân Hóa",
    youHint: "Tuỳ chỉnh cách Iris xưng hô và giọng đọc trả lời.",
    displayName: "Tên hiển thị",
    displayNamePlaceholder: "Tên của bạn (vd: Hùng, Alex)",
    displayNameNote: "Tên Iris sẽ gọi bạn khi trò chuyện.",
    voice: "Giọng nói",
    voiceNote: "Chọn giọng đọc của Iris. Bấm Nghe thử để kiểm tra.",
    preview: "Nghe thử",
    previewDisabledTitle: "Cần lưu khoá Gemini trước",
    model: "Mô hình Live",
    modelNote: "Mô hình Gemini Live xử lý giọng nói thời gian thực.",
    sounds: "Âm thanh giao diện",
    soundsNote: "Âm thanh báo thức, ngủ và hoàn thành tác vụ.",
    permsTitle: "Quyền Truy Cập & Thiết Bị",
    permsHint: "Cần Micro để nói chuyện. Camera là tuỳ chọn cho cử chỉ tay.",
    mic: "Microphone",
    camera: "Camera (Cử chỉ tay)",
    gestureCam: "Thiết Bị Camera Cử Chỉ",
    grantCamFirst: "Cần cấp quyền Camera ở trên để chọn thiết bị.",
    sysDefault: "Mặc định hệ thống",
    wakeWord: "Đánh thức bằng giọng nói — “Hey Iris”",
    wakeWordNote: "Nhận diện “Hey Iris” trên máy (tương đương nhấn phím W).",
    reviewGate: "Duyệt lệnh trước khi gửi (Review Gate)",
    reviewGateNote: "Xem và duyệt lệnh trước khi gửi cho Claude để tiết kiệm token.",
    notesSkills: "Ghi chú cá nhân / Second Brain",
    notesInstalling: "Đang cài…",
    notesInstalled: "Đã cài đặt",
    notesInstallMissing: "Cài đặt còn thiếu",
    notesMissing: "Thiếu: ",
    notesSkillsNote: "Cài kỹ năng wiki-* để lưu và tra cứu ghi chú (~/iris-second-brain).",
    superPowersTitle: "Siêu Quyền Năng Máy Tính (Super Assistant Powers)",
    superPowersHint: "Bật/tắt từng quyền điều khiển máy tính sâu của Iris. Các lệnh nguy hiểm (xoá file, tắt nguồn, dọn thùng rác) luôn có xác nhận giọng nói 2 bước.",
    universalApps: "Mở Mọi Ứng Dụng (Universal App Launcher)",
    universalAppsNote: "Tự động tìm và mở mọi phần mềm qua Start Menu, Registry, PATH & Store.",
    terminalExec: "Thực Thi Lệnh Terminal / PowerShell / Python",
    terminalExecNote: "Cho phép Iris chạy lệnh hệ thống và script trực tiếp.",
    filesystemOps: "Quản Lý File, Thư Mục & Nén Zip Toàn Diện",
    filesystemOpsNote: "Đọc, ghi, tạo, sao chép, di chuyển, đổi tên, nén/giải nén và xoá (có xác nhận).",
    windowManager: "Điều Khiển & Sắp Xếp Cửa Sổ Nâng Cao",
    windowManagerNote: "Liệt kê cửa sổ, chia màn hình (snap), chuyển cửa sổ, ghim nổi trên cùng.",
    systemOps: "Quản Trị Hệ Thống, Mạng, Dịch Vụ & Winget",
    systemOpsNote: "Kiểm tra IP/port, quản lý Services, cài phần mềm qua winget, dọn file tạm & thùng rác.",
    advancedTitle: "Dữ Liệu Thử Nghiệm",
    advancedHint: "Dữ liệu mẫu giúp khám phá Iris mà không tốn token thật.",
    hudTopNotch: "Viền Trên Màn Hình HUD (Top Notch)",
    hudTopNotchNote: "Hiển thị khung viền neon công nghệ ở cạnh trên màn hình HUD (Alt+Space).",
    demoData: "Nạp dữ liệu mẫu (Demo Data)",
    demoDataNote: "Tạo các thẻ công việc mẫu để thử nghiệm giao diện.",
    savedTo: "Lưu vào",
    runWizard: "Chạy hướng dẫn cài đặt",
    cancel: "Huỷ bỏ",
    save: "Lưu cài đặt",
    saveError: "Không lưu được cấu hình: ",
    close: "Đóng",
    granted: "Đã cấp quyền",
    required: "bắt buộc",
    optional: "tuỳ chọn",
    allow: "Cho phép",
    retry: "Thử lại",
  },
};

function NotesSkillsField({ t }: { t: typeof I18N.en }) {
  const [status, setStatus] = useState<{ ok: boolean; missing: string[] } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window.iris === "undefined") return;
    window.iris
      .getNotesSkillsStatus()
      .then((res) => setStatus({ ok: res.ok, missing: res.missing }))
      .catch(() => setStatus(null));
  }, []);

  async function install() {
    if (typeof window.iris === "undefined") return;
    setInstalling(true);
    setResult(null);
    try {
      const res = await window.iris.installNotesSkills();
      setResult(
        res.status === "error"
          ? res.errors[0] ?? "Could not install."
          : `Installed: ${res.installed.length}, already present: ${res.skipped.length}.`,
      );
      const refreshed = await window.iris.getNotesSkillsStatus();
      setStatus({ ok: refreshed.ok, missing: refreshed.missing });
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Could not install.");
    } finally {
      setInstalling(false);
    }
  }

  return (
    <label className="setup-field compact">
      <span>{t.notesSkills}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" className="setup-btn" onClick={install} disabled={installing || Boolean(status?.ok)}>
          {installing ? t.notesInstalling : status?.ok ? t.notesInstalled : t.notesInstallMissing}
        </button>
        {status && !status.ok ? <small className="setup-note">{t.notesMissing}{status.missing.join(", ")}</small> : null}
      </div>
      <small className="setup-note">{t.notesSkillsNote}</small>
      {result ? <small className="setup-note">{result}</small> : null}
    </label>
  );
}

export default function SetupPanel({
  mode,
  config,
  soundsEnabled,
  onToggleSounds,
  cameraDeviceId,
  onChangeCameraDevice,
  hudTopNotchEnabled,
  onToggleHudTopNotch,
  onClose,
  onSaved,
  onStart,
  onRunWizard,
}: {
  mode: Mode;
  config: IrisConfig;
  soundsEnabled: boolean;
  onToggleSounds: () => void;
  cameraDeviceId: string;
  onChangeCameraDevice: (deviceId: string) => void;
  hudTopNotchEnabled?: boolean;
  onToggleHudTopNotch?: (enabled: boolean) => void;
  onClose: () => void;
  onSaved: (config: IrisConfig) => void;
  onStart?: () => void;
  onRunWizard?: () => void;
}) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return (window.localStorage.getItem("iris.language") as Lang) || "en";
    } catch {
      return "en";
    }
  });
  const [activeTab, setActiveTab] = useState<"ai" | "voice" | "system">("ai");

  const handleSetLang = (newLang: Lang) => {
    setLang(newLang);
    try {
      window.localStorage.setItem("iris.language", newLang);
    } catch {}
  };

  const t = I18N[lang];

  const [draft, setDraft] = useState<Draft>({
    GEMINI_API_KEY: config.geminiKeysRaw || "",
    GEMINI_VISION_API_KEY: config.geminiVisionKeysRaw || "",
    ANTHROPIC_API_KEY: "",
    GEMINI_LIVE_MODEL: config.geminiModel,
    GEMINI_LIVE_VOICE: config.geminiVoice,
    IRIS_USER_NAME: config.userName,
    IRIS_LOAD_TEST_DATA: config.loadTestData ? "true" : "false",
    IRIS_WAKE_WORD: config.wakeWord ? "true" : "false",
    IRIS_PROMPT_REVIEW_MODE: config.promptReviewMode ? "true" : "false",
    IRIS_CLAUDE_ENABLED: config.claudeEnabled ? "true" : "false",
    IRIS_UNIVERSAL_APPS: config.universalApps !== false ? "true" : "false",
    IRIS_TERMINAL_EXEC: config.terminalExec !== false ? "true" : "false",
    IRIS_FILESYSTEM_OPS: config.filesystemOps !== false ? "true" : "false",
    IRIS_WINDOW_MANAGER: config.windowManager !== false ? "true" : "false",
    IRIS_SYSTEM_OPS: config.systemOps !== false ? "true" : "false",
    OMNIPARSER_ENABLED: config.omniParserEnabled !== false ? "true" : "false",
  });
  const [step, setStep] = useState(0);
  const [gemini, setGemini] = useState<TestState>({ status: "idle" });
  const [omni, setOmni] = useState<OmniUi>({ phase: "stopped", port: 8000, url: "http://127.0.0.1:8000", mode: null });
  // true khi đang chờ toggleOmni() — vòng poll trạng thái không được ghi đè phase starting/stopping.
  const omniBusyRef = useRef(false);
  const [claude, setClaude] = useState<TestState & { billing?: string }>({ status: "idle" });
  const [preview, setPreview] = useState<TestState>({ status: "idle" });
  const [mic, setMic] = useState<PermState>("idle");
  const [cam, setCam] = useState<PermState>("idle");
  const [camDevices, setCamDevices] = useState<MediaDeviceInfo[]>([]);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof Draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let cancelled = false;
    const toState = (state: PermissionState): PermState =>
      state === "granted" ? "granted" : state === "denied" ? "denied" : "idle";

    const watch = async (name: "microphone" | "camera", setter: (value: PermState) => void) => {
      try {
        const status = await navigator.permissions.query({ name: name as PermissionName });
        if (cancelled) return;
        setter(toState(status.state));
        status.onchange = () => setter(toState(status.state));
      } catch {}
    };

    watch("microphone", setMic);
    watch("camera", setCam);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (cam !== "granted") {
      setCamDevices([]);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setCamDevices(devices.filter((device) => device.kind === "videoinput"));
      } catch {}
    };
    refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, [cam]);

  useEffect(() => {
    checkClaude();
    refreshOmniStatus();
    // Poll nhẹ (IPC nội bộ) để badge phản ánh đúng thực tế: server tự thoát, được bật từ Computer Use, v.v.
    const poll = window.setInterval(refreshOmniStatus, 3000);
    return () => window.clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshOmniStatus() {
    if (typeof window.iris?.getOmniStatus !== "function") return;
    if (omniBusyRef.current) return; // đang toggle: để handleToggleOmni tự quyết định phase
    try {
      const s = await window.iris.getOmniStatus();
      if (omniBusyRef.current) return;
      const base = { port: s.port || 8000, url: s.url || `http://127.0.0.1:${s.port || 8000}`, mode: s.mode ?? null };
      setOmni((prev) => {
        if (s.running) return { ...base, phase: "running" };
        if (s.starting) return { ...base, phase: "starting" };
        // Giữ thông báo lỗi lần bật trước cho tới khi người dùng thao tác lại.
        if (prev.phase === "error") return { ...prev, ...base, mode: null };
        return { ...base, phase: "stopped" };
      });
    } catch {}
  }

  async function handleToggleOmni() {
    if (typeof window.iris?.toggleOmni !== "function") return;
    if (omniBusyRef.current || omni.phase === "starting" || omni.phase === "stopping") return;
    const wantStart = omni.phase !== "running";
    omniBusyRef.current = true;
    setOmni((prev) => ({ ...prev, phase: wantStart ? "starting" : "stopping", error: undefined }));
    try {
      if (draft.GEMINI_VISION_API_KEY.trim() || draft.GEMINI_API_KEY.trim()) {
        const updated = await window.iris.saveConfig({ ...draft, OMNIPARSER_ENABLED: wantStart ? "true" : "false" });
        onSaved(updated);
      }
      const res = await window.iris.toggleOmni(wantStart);
      set("OMNIPARSER_ENABLED", res.enabled ? "true" : "false");
      const base = { port: res.port || omni.port, url: res.url || omni.url, mode: res.mode ?? null };
      if (res.running) {
        setOmni({ ...base, phase: "running" });
      } else if (!wantStart) {
        setOmni({ ...base, phase: "stopped" });
      } else {
        setOmni({ ...base, phase: "error", error: res.error || t.omniError });
      }
    } catch (e: any) {
      setOmni((prev) => ({ ...prev, phase: "error", error: e?.message || String(e) }));
    } finally {
      omniBusyRef.current = false;
    }
  }

  async function testGemini() {
    setGemini({ status: "testing" });
    const rawInput = draft.GEMINI_API_KEY.trim();
    const result = await window.iris.testGemini(rawInput);
    if (result.ok) {
      if (Array.isArray(result.validKeys) && result.validKeys.length > 0) {
        // Tự động giữ nguyên các key đủ điều kiện (mỗi key 1 dòng)
        // và loại bỏ các key lỗi / không đủ điều kiện khỏi danh sách
        set("GEMINI_API_KEY", result.validKeys.join("\n"));
      }
      setGemini({
        status: "ok",
        message: result.message || t.keyWorks,
      });
    } else {
      setGemini({
        status: "error",
        message: result.error || (lang === "vi" ? "Kiểm tra thất bại" : "Test failed"),
      });
    }
  }

  async function checkClaude() {
    setClaude({ status: "testing" });
    const health = await window.iris.testClaude();
    const billing = health.billingOk
      ? "Subscription token found — PO bills against your Claude subscription."
      : health.billingError || "No CLAUDE_CODE_OAUTH_TOKEN set — PO turns will fail until you run `claude setup-token`.";
    if (health.reachable) {
      setClaude({ status: "ok", message: health.version ? `${t.ready} · ${health.version}` : t.ready, billing });
    } else {
      setClaude({ status: "error", message: health.error || "Claude CLI not found.", billing });
    }
  }

  async function doPreview() {
    setPreview({ status: "testing" });
    const result = await window.iris.previewVoice({
      voice: draft.GEMINI_LIVE_VOICE,
      key: draft.GEMINI_API_KEY.trim(),
    });
    setPreview(result.ok ? { status: "idle" } : { status: "error", message: result.error });
  }

  async function requestMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMic("granted");
    } catch {
      setMic("denied");
    }
  }

  async function requestCam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
      setCam("granted");
    } catch {
      setCam("denied");
    }
  }

  async function save() {
    setSaving(true);
    const updated = await window.iris.saveConfig({ ...draft });
    setSaving(false);
    if (updated.saveError) window.alert(`${t.saveError}${updated.saveError}`);
    onSaved(updated);
    return updated;
  }

  async function finishWizard() {
    await save();
    onClose();
    onStart?.();
  }

  const keyReady = draft.GEMINI_API_KEY.trim().length > 0 || config.geminiApiKeySet;

  // ---- Section renderers ----
  // ---- OmniParser: nhãn/trạng thái dẫn xuất từ dữ liệu thô (đổi ngôn ngữ vẫn đúng) ----
  const omniBusy = omni.phase === "starting" || omni.phase === "stopping";
  const omniRunning = omni.phase === "running";
  const omniBadgeLabel =
    omni.phase === "running"
      ? t.omniRunning.replace("{port}", String(omni.port))
      : omni.phase === "starting"
        ? t.omniStarting
        : omni.phase === "stopping"
          ? t.omniStopping
          : omni.phase === "error"
            ? t.omniError
            : t.omniStopped;
  const omniEndpointUrl = `${omni.url.replace(/\/+$/, "")}/parse`;

  const parsedGeminiKeys = useMemo(() => {
    const raw = draft.GEMINI_API_KEY.trim();
    if (!raw) return [];
    const items = raw.split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const keys = items
      .map((item) => {
        const match = item.match(/AIza[0-9A-Za-z-_]{30,}/);
        return match ? match[0] : item.split(/\s+/)[0];
      })
      .filter(Boolean);
    return Array.from(new Set(keys));
  }, [draft.GEMINI_API_KEY]);

  const activeKeyCount = parsedGeminiKeys.length > 0 ? parsedGeminiKeys.length : (config.geminiKeyCount || 0);

  const cleanAndFormatOnePerLine = () => {
    if (parsedGeminiKeys.length > 0) {
      set("GEMINI_API_KEY", parsedGeminiKeys.join("\n"));
    }
  };

  const poolStatusBadge = (() => {
    if (activeKeyCount >= 10) {
      return <span className="pool-status-tag tag-full">10/10 Keys · Tối ưu nhất</span>;
    }
    if (activeKeyCount >= 3) {
      return (
        <span className="pool-status-tag tag-ready">
          {activeKeyCount}/10 Keys · {lang === "vi" ? `3 Độc Lập + ${activeKeyCount - 3} Dự Phòng` : `3 Primary + ${activeKeyCount - 3} Standby`}
        </span>
      );
    }
    if (activeKeyCount >= 1) {
      return <span className="pool-status-tag tag-warn">{activeKeyCount}/10 Keys · {lang === "vi" ? "Tối thiểu" : "Basic"}</span>;
    }
    return <span className="pool-status-tag tag-empty">0/10 Keys</span>;
  })();

  const roleLiveActive = activeKeyCount >= 1;
  const roleMeetingActive = activeKeyCount >= 2;
  const roleVisionActive = activeKeyCount >= 3;
  const standbyCount = Math.max(0, activeKeyCount - 3);

  const geminiSection = (
    <SetupBlock
      icon={<KeyRound size={15} />}
      title={t.geminiTitle}
      hint={t.geminiHint}
      aside={poolStatusBadge}
    >
      <div className="pool-container">
        {/* Hàng 4 thẻ vai trò: Key 1 (Live), Key 2 (Meeting), Key 3 (Vision), Keys 4-10 (Dự phòng né lỗi 429) */}
        <div className="pool-roles-grid">
          <div className={`pool-role-card${roleLiveActive ? " active" : ""}`}>
            <div className="pool-role-head">
              <span>KEY 1 · DÒNG 1</span>
              <span className="pool-role-indicator" />
            </div>
            <div className="pool-role-title">🎙️ Live Voice</div>
            <div className="pool-role-desc">
              {lang === "vi" ? "Đàm thoại giọng nói độc lập" : "Dedicated live voice"}
            </div>
          </div>

          <div className={`pool-role-card${roleMeetingActive ? " active" : ""}`}>
            <div className="pool-role-head">
              <span>KEY 2 · DÒNG 2</span>
              <span className="pool-role-indicator" />
            </div>
            <div className="pool-role-title">📝 Alt+M / Alt+T</div>
            <div className="pool-role-desc">
              {lang === "vi" ? "Ghi âm & Live Prompter" : "Meeting & teleprompter"}
            </div>
          </div>

          <div className={`pool-role-card${roleVisionActive ? " active" : ""}`}>
            <div className="pool-role-head">
              <span>KEY 3 · DÒNG 3</span>
              <span className="pool-role-indicator" />
            </div>
            <div className="pool-role-title">👁️ Vision</div>
            <div className="pool-role-desc">
              {lang === "vi" ? "Chụp màn hình & Webcam" : "Screen & camera vision"}
            </div>
          </div>

          <div className={`pool-role-card standby${standbyCount > 0 ? " active" : ""}`}>
            <div className="pool-role-head">
              <span>KEYS 4–10 · DỰ PHÒNG</span>
              <span className="pool-role-indicator" />
            </div>
            <div className="pool-role-title">🛡️ Standby ({standbyCount}/7)</div>
            <div className="pool-role-desc">
              {lang === "vi" ? "Dùng chung né lỗi 429" : "Auto-bypass 429 quota"}
            </div>
          </div>
        </div>

        {/* Khung nhập danh sách 10 API Key: mỗi key 1 dòng */}
        <div className="pool-textarea-box">
          <div className="pool-textarea-top">
            <span className="pool-textarea-title">
              {lang === "vi" ? "DANH SÁCH KEY (MỖI KEY 1 DÒNG — TỐI ĐA 10 KEYS)" : "KEY LIST (ONE KEY PER LINE — UP TO 10 KEYS)"}
            </span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {config.geminiKeysRaw && draft.GEMINI_API_KEY.trim() !== config.geminiKeysRaw.trim() && (
                <button
                  type="button"
                  className="pool-clean-btn"
                  onClick={() => set("GEMINI_API_KEY", config.geminiKeysRaw || "")}
                  title={lang === "vi" ? "Khôi phục lại danh sách các key đã lưu trong hệ thống" : "Restore saved keys"}
                >
                  🔄 {lang === "vi" ? "Nạp lại key đã lưu" : "Restore saved"}
                </button>
              )}
              {config.geminiKeysRaw &&
                parsedGeminiKeys.length > 0 &&
                parsedGeminiKeys.some((k) => !(config.geminiKeysRaw || "").includes(k)) && (
                  <button
                    type="button"
                    className="pool-clean-btn"
                    onClick={() => {
                      const saved = (config.geminiKeysRaw || "").split("\n").map((s) => s.trim()).filter(Boolean);
                      const merged = Array.from(new Set([...saved, ...parsedGeminiKeys]));
                      set("GEMINI_API_KEY", merged.join("\n"));
                    }}
                    title={lang === "vi" ? "Ghép key mới vào danh sách key đang hoạt động" : "Merge new key with saved keys"}
                  >
                    ➕ {lang === "vi" ? "Ghép với key đã lưu" : "Merge with saved"}
                  </button>
                )}
              {parsedGeminiKeys.length > 0 && (
                <button
                  type="button"
                  className="pool-clean-btn"
                  onClick={cleanAndFormatOnePerLine}
                  title={lang === "vi" ? "Định dạng lại danh sách thành mỗi key một dòng sạch sẽ" : "Format cleanly as 1 key per line"}
                >
                  ✨ {lang === "vi" ? "Chuẩn hoá 1 key/dòng" : "Format 1 key/line"}
                </button>
              )}
            </div>
          </div>
          <textarea
            className="pool-textarea"
            rows={7}
            value={draft.GEMINI_API_KEY}
            placeholder={
              config.geminiApiKeySet && !draft.GEMINI_API_KEY
                ? (lang === "vi"
                    ? `•••• ${config.geminiKeyCount || 1} keys đã lưu an toàn trong hệ thống ••••\n\nBấm "Kiểm tra & Lọc Key" bên dưới để quét kiểm tra và nạp danh sách vào đây,\nhoặc dán danh sách key mới (mỗi key 1 dòng, tối đa 10 keys).`
                    : `•••• ${config.geminiKeyCount || 1} keys stored in system ••••\n\nClick "Test & Clean Keys" below to test and load keys,\nor paste new keys (one per line, up to 10 keys).`)
                : `AIzaSy... (Dòng 1: Key Live đàm thoại giọng nói)\nAIzaSy... (Dòng 2: Key Cuộc họp Alt+M & Teleprompter Alt+T)\nAIzaSy... (Dòng 3: Key Vision chụp ảnh màn hình & camera)\nAIzaSy... (Dòng 4: Key Dự phòng 1 tự động né lỗi 429)\nAIzaSy... (Dòng 5: Key Dự phòng 2)\n... (Mỗi key một dòng, tối đa 10 keys)`
            }
            onChange={(event) => {
              set("GEMINI_API_KEY", event.target.value);
              setGemini({ status: "idle" });
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="pool-textarea-sub">
            <span>
              {lang === "vi"
                ? "💡 Khi bấm \"Kiểm tra & Lọc Key\", key lỗi/hỏng sẽ tự động bị xoá khỏi danh sách, key hợp lệ được giữ nguyên."
                : "💡 Clicking \"Test & Clean Keys\" automatically deletes invalid keys and keeps qualifying keys intact."}
            </span>
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="pool-link">
              Google AI Studio ↗
            </a>
          </div>
        </div>

        {/* Nút kiểm tra & huy hiệu trạng thái */}
        <div className="setup-actions compact setup-block-actions pool-action-bar">
          <button
            type="button"
            className={`setup-btn${gemini.status === "ok" ? " is-ok" : ""}`}
            onClick={testGemini}
            disabled={!keyReady || gemini.status === "testing"}
          >
            {gemini.status === "testing" ? <Loader2 size={13} className="spin" /> : null}
            🔍 {t.testGemini}
          </button>
          <TestBadge state={gemini} okLabel={t.keyWorks} />
        </div>

        {/* Tuỳ chọn Vision Key riêng biệt (gọn gàng, không phá vỡ bố cục) */}
        <div className="pool-vision-extra">
          <details className="pool-vision-details" open={Boolean(draft.GEMINI_VISION_API_KEY)}>
            <summary>
              ⚙️ {lang === "vi" ? "Tuỳ chọn nâng cao: Dùng khoá Vision API riêng ngoài Pool (Không bắt buộc)" : "Advanced: Use separate Vision API Key outside Pool (Optional)"}
            </summary>
            <div className="pool-vision-body">
              <label className="setup-field compact">
                <span>{t.visionKey}</span>
                <input
                  type="password"
                  value={draft.GEMINI_VISION_API_KEY}
                  placeholder={config.geminiVisionApiKeySet ? `•••• ${config.geminiVisionApiKeyHint} — ${t.visionKeySaved}` : t.visionKeyPlaceholder}
                  onChange={(event) => set("GEMINI_VISION_API_KEY", event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <small className="setup-note">{t.visionKeyNote}</small>
              </label>
            </div>
          </details>
        </div>
      </div>
    </SetupBlock>
  );

  const omniSection = (
    <SetupBlock
      icon={<ScanEye size={15} />}
      title={t.omniTitle}
      hint={t.omniDesc}
      accent="mint"
      aside={<OmniStatusBadge phase={omni.phase} label={omniBadgeLabel} />}
    >
      <div className="omni-row">
        <div className="omni-endpoint">
          <span className="omni-endpoint-label">{t.omniEndpoint}</span>
          <code className={`omni-tag ${omni.phase}`} title={omniEndpointUrl}>
            {omniEndpointUrl}
          </code>
          {omniRunning && omni.mode ? (
            <code className="omni-tag mode" title={t.omniMode}>
              {omni.mode}
            </code>
          ) : null}
        </div>
        <button
          type="button"
          className={`setup-btn omni-toggle ${omniRunning ? "on" : "off"}`}
          onClick={handleToggleOmni}
          disabled={omniBusy}
          aria-pressed={omniRunning}
        >
          {omniBusy ? <Loader2 size={13} className="spin" /> : omniRunning ? <Square size={12} /> : <Play size={13} />}
          {omni.phase === "starting" ? t.omniStarting : omni.phase === "stopping" ? t.omniStopping : omniRunning ? t.omniStop : t.omniStart}
        </button>
      </div>
      {omni.phase === "error" && omni.error ? (
        <p className="setup-error omni-error" role="alert">
          {omni.error}
        </p>
      ) : null}
    </SetupBlock>
  );

  const claudeSection = (
    <Section title={t.claudeTitle} hint={t.claudeHint} compact>
      <div className="setup-grid-2">
        <label className="setup-field compact">
          <span>{t.claudeBrain}</span>
          <ThemedSelect
            ariaLabel={t.claudeBrain}
            value={draft.IRIS_CLAUDE_ENABLED}
            options={[
              { value: "true", label: t.on },
              { value: "false", label: t.off },
            ]}
            onChange={(value) => set("IRIS_CLAUDE_ENABLED", value)}
          />
          <small className="setup-note">{t.claudeBrainNote}</small>
        </label>
        <label className="setup-field compact">
          <span>{t.anthropicKey}</span>
          <input
            type="password"
            value={draft.ANTHROPIC_API_KEY}
            placeholder={config.anthropicApiKeySet ? `•••• ${config.anthropicApiKeyHint} — ${t.anthropicKeySaved}` : t.anthropicKeyPlaceholder}
            onChange={(event) => set("ANTHROPIC_API_KEY", event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <small className="setup-note">{t.anthropicKeyNote}</small>
        </label>
      </div>
      <div className="setup-actions compact">
        <button className="setup-btn" onClick={checkClaude} disabled={claude.status === "testing"}>
          {claude.status === "testing" ? <Loader2 size={13} className="spin" /> : null}
          {t.checkClaude}
        </button>
        <TestBadge state={claude} okLabel={t.ready} />
      </div>
      {claude.billing ? <p className="setup-note" style={{ margin: "2px 0 6px" }}>{claude.billing}</p> : null}
    </Section>
  );

  const youSection = (
    <Section title={t.youTitle} hint={t.youHint} compact>
      <div className="setup-grid-2">
        <label className="setup-field compact">
          <span>{t.displayName}</span>
          <input
            value={draft.IRIS_USER_NAME}
            placeholder={t.displayNamePlaceholder}
            onChange={(event) => set("IRIS_USER_NAME", event.target.value)}
            spellCheck={false}
          />
          <small className="setup-note">{t.displayNameNote}</small>
        </label>
        <label className="setup-field compact">
          <span>{t.sounds}</span>
          <ThemedSelect
            ariaLabel={t.sounds}
            value={soundsEnabled ? "true" : "false"}
            options={[
              { value: "true", label: t.on },
              { value: "false", label: t.off },
            ]}
            onChange={(value) => {
              if ((value === "true") !== soundsEnabled) onToggleSounds();
            }}
          />
          <small className="setup-note">{t.soundsNote}</small>
        </label>
      </div>
      <div className="setup-grid-2">
        <label className="setup-field compact">
          <span>{t.voice}</span>
          <div className="setup-inline">
            <ThemedSelect
              ariaLabel={t.voice}
              value={draft.GEMINI_LIVE_VOICE}
              options={config.voices.map((voice) => ({ value: voice, label: voice }))}
              onChange={(value) => {
                set("GEMINI_LIVE_VOICE", value);
                setPreview({ status: "idle" });
              }}
            />
            <button
              className="setup-btn ghost"
              onClick={doPreview}
              disabled={!keyReady || preview.status === "testing"}
              title={keyReady ? t.preview : t.previewDisabledTitle}
            >
              {preview.status === "testing" ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
              {t.preview}
            </button>
          </div>
          <small className="setup-note">{t.voiceNote}</small>
        </label>
        <label className="setup-field compact">
          <span>{t.model}</span>
          <ThemedSelect
            ariaLabel={t.model}
            value={draft.GEMINI_LIVE_MODEL}
            options={config.models.map((model) => ({ value: model, label: model.replace(/^models\//, "") }))}
            onChange={(value) => set("GEMINI_LIVE_MODEL", value)}
          />
          <small className="setup-note">{t.modelNote}</small>
        </label>
      </div>
      {preview.status === "error" ? <p className="setup-error">{preview.message}</p> : null}
      <div className="setup-grid-2" style={{ marginTop: 4 }}>
        <label className="setup-field compact">
          <span>{t.language}</span>
          <ThemedSelect
            ariaLabel={t.language}
            value={lang}
            options={[
              { value: "en", label: "English (Default)" },
              { value: "vi", label: "Tiếng Việt" },
            ]}
            onChange={(value) => handleSetLang(value as Lang)}
          />
        </label>
      </div>
    </Section>
  );

  const cameraOptions: Option[] = [{ value: SYSTEM_DEFAULT_CAMERA, label: t.sysDefault }].concat(
    camDevices.map((device, index) => ({
      value: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
    })),
  );
  const cameraSelectionMissing =
    cameraDeviceId !== SYSTEM_DEFAULT_CAMERA && !camDevices.some((device) => device.deviceId === cameraDeviceId);
  if (cameraSelectionMissing) {
    cameraOptions.push({ value: cameraDeviceId, label: "Unavailable Camera" });
  }

  const permissionsSection = (
    <Section title={t.permsTitle} hint={t.permsHint} compact>
      <div className="setup-perms">
        <PermRow icon={<Mic size={15} />} label={t.mic} required state={mic} onRequest={requestMic} t={t} />
        <PermRow icon={<Camera size={15} />} label={t.camera} state={cam} onRequest={requestCam} t={t} />
      </div>
      <label className="setup-field compact" style={{ marginTop: 8 }}>
        <span>{t.gestureCam}</span>
        {cam === "granted" ? (
          <ThemedSelect
            ariaLabel={t.gestureCam}
            value={cameraDeviceId}
            options={cameraOptions}
            onChange={onChangeCameraDevice}
          />
        ) : (
          <p className="setup-note">{t.grantCamFirst}</p>
        )}
      </label>
    </Section>
  );

  const superPowersSection = (
    <Section title={t.superPowersTitle} hint={t.superPowersHint} compact>
      <div className="setup-grid-2">
        <label className="setup-field compact">
          <span>{t.universalApps}</span>
          <ThemedSelect
            ariaLabel={t.universalApps}
            value={draft.IRIS_UNIVERSAL_APPS}
            options={[
              { value: "true", label: t.on },
              { value: "false", label: t.off },
            ]}
            onChange={(value) => set("IRIS_UNIVERSAL_APPS", value)}
          />
          <small className="setup-note">{t.universalAppsNote}</small>
        </label>
        <label className="setup-field compact">
          <span>{t.terminalExec}</span>
          <ThemedSelect
            ariaLabel={t.terminalExec}
            value={draft.IRIS_TERMINAL_EXEC}
            options={[
              { value: "true", label: t.on },
              { value: "false", label: t.off },
            ]}
            onChange={(value) => set("IRIS_TERMINAL_EXEC", value)}
          />
          <small className="setup-note">{t.terminalExecNote}</small>
        </label>
      </div>
      <div className="setup-grid-2" style={{ marginTop: 4 }}>
        <label className="setup-field compact">
          <span>{t.filesystemOps}</span>
          <ThemedSelect
            ariaLabel={t.filesystemOps}
            value={draft.IRIS_FILESYSTEM_OPS}
            options={[
              { value: "true", label: t.on },
              { value: "false", label: t.off },
            ]}
            onChange={(value) => set("IRIS_FILESYSTEM_OPS", value)}
          />
          <small className="setup-note">{t.filesystemOpsNote}</small>
        </label>
        <label className="setup-field compact">
          <span>{t.windowManager}</span>
          <ThemedSelect
            ariaLabel={t.windowManager}
            value={draft.IRIS_WINDOW_MANAGER}
            options={[
              { value: "true", label: t.on },
              { value: "false", label: t.off },
            ]}
            onChange={(value) => set("IRIS_WINDOW_MANAGER", value)}
          />
          <small className="setup-note">{t.windowManagerNote}</small>
        </label>
      </div>
      <div className="setup-grid-2" style={{ marginTop: 4 }}>
        <label className="setup-field compact">
          <span>{t.systemOps}</span>
          <ThemedSelect
            ariaLabel={t.systemOps}
            value={draft.IRIS_SYSTEM_OPS}
            options={[
              { value: "true", label: t.on },
              { value: "false", label: t.off },
            ]}
            onChange={(value) => set("IRIS_SYSTEM_OPS", value)}
          />
          <small className="setup-note">{t.systemOpsNote}</small>
        </label>
      </div>
    </Section>
  );

  const advancedSection = (
    <Section title={t.advancedTitle} hint={t.advancedHint} compact>
      <div className="setup-grid-2">
        <label className="setup-field compact">
          <span>{t.wakeWord}</span>
          <ThemedSelect
            ariaLabel={t.wakeWord}
            value={draft.IRIS_WAKE_WORD}
            options={[
              { value: "false", label: t.off },
              { value: "true", label: t.on },
            ]}
            onChange={(value) => set("IRIS_WAKE_WORD", value)}
          />
          <small className="setup-note">{t.wakeWordNote}</small>
        </label>
        <label className="setup-field compact">
          <span>{t.reviewGate}</span>
          <ThemedSelect
            ariaLabel={t.reviewGate}
            value={draft.IRIS_PROMPT_REVIEW_MODE}
            options={[
              { value: "false", label: t.off },
              { value: "true", label: t.on },
            ]}
            onChange={(value) => set("IRIS_PROMPT_REVIEW_MODE", value)}
          />
          <small className="setup-note">{t.reviewGateNote}</small>
        </label>
      </div>
      <div className="setup-grid-2" style={{ marginTop: 4 }}>
        <NotesSkillsField t={t} />
        <label className="setup-field compact">
          <span>{t.hudTopNotch}</span>
          <ThemedSelect
            ariaLabel={t.hudTopNotch}
            value={hudTopNotchEnabled !== false ? "true" : "false"}
            options={[
              { value: "true", label: t.on },
              { value: "false", label: t.off },
            ]}
            onChange={(value) => onToggleHudTopNotch?.(value === "true")}
          />
          <small className="setup-note">{t.hudTopNotchNote}</small>
        </label>
      </div>
      <div className="setup-grid-2" style={{ marginTop: 4 }}>
        <label className="setup-field compact">
          <span>{t.demoData}</span>
          <ThemedSelect
            ariaLabel={t.demoData}
            value={draft.IRIS_LOAD_TEST_DATA}
            options={[
              { value: "false", label: t.off },
              { value: "true", label: t.on },
            ]}
            onChange={(value) => set("IRIS_LOAD_TEST_DATA", value)}
          />
          <small className="setup-note">{t.demoDataNote}</small>
        </label>
      </div>
    </Section>
  );

  // ---- Settings mode: organized in tabs with compact grid ----
  if (mode === "settings") {
    return (
      <div className="setup-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
        <div className="setup-card settings">
          <header className="setup-head">
            <div className="setup-head-left">
              <span>{t.settings}</span>
              <div className="setup-lang-switch">
                <button
                  type="button"
                  className={`lang-btn ${lang === "en" ? "active" : ""}`}
                  onClick={() => handleSetLang("en")}
                  title="English (Default)"
                >
                  EN
                </button>
                <button
                  type="button"
                  className={`lang-btn ${lang === "vi" ? "active" : ""}`}
                  onClick={() => handleSetLang("vi")}
                  title="Tiếng Việt"
                >
                  VI
                </button>
              </div>
            </div>
            <button className="reader-close" onClick={onClose} title={t.close}>
              <X size={16} />
            </button>
          </header>

          <nav className="setup-tabs">
            <button
              type="button"
              className={`setup-tab-btn ${activeTab === "ai" ? "active" : ""}`}
              onClick={() => setActiveTab("ai")}
            >
              {t.tabAi}
            </button>
            <button
              type="button"
              className={`setup-tab-btn ${activeTab === "voice" ? "active" : ""}`}
              onClick={() => setActiveTab("voice")}
            >
              {t.tabVoice}
            </button>
            <button
              type="button"
              className={`setup-tab-btn ${activeTab === "system" ? "active" : ""}`}
              onClick={() => setActiveTab("system")}
            >
              {t.tabSystem}
            </button>
          </nav>

          <div className="setup-scroll">
            {activeTab === "ai" && (
              <>
                {geminiSection}
                {omniSection}
                {claudeSection}
              </>
            )}
            {activeTab === "voice" && youSection}
            {activeTab === "system" && (
              <>
                {superPowersSection}
                {permissionsSection}
                {advancedSection}
              </>
            )}
            <p className="setup-path">{t.savedTo} {config.configPath}</p>
          </div>

          <footer className="setup-foot">
            <button className="setup-btn ghost" onClick={() => onRunWizard?.()}>
              <Wand2 size={14} />
              {t.runWizard}
            </button>
            <div className="setup-foot-right">
              <button className="setup-btn ghost" onClick={onClose}>
                {t.cancel}
              </button>
              <button
                className="setup-btn primary"
                onClick={async () => {
                  await save();
                  onClose();
                }}
                disabled={saving}
              >
                {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                {t.save}
              </button>
            </div>
          </footer>
        </div>
      </div>
    );
  }

  // ---- Onboarding mode: step-by-step wizard ----
  const current = WIZARD_STEPS[step];
  let body: ReactNode = null;
  if (current === "welcome") {
    body = (
      <div className="setup-welcome">
        <h2>{lang === "vi" ? "Chào mừng đến với Iris" : "Welcome to Iris"}</h2>
        <p>
          {lang === "vi"
            ? "Iris là trợ lý điều khiển bằng giọng nói rảnh tay. Gemini Live xử lý hội thoại và điều phối tác vụ thực tế cho Claude. Hãy thiết lập trong vòng chưa đầy 1 phút."
            : "Iris is a hands-free voice command layer. Gemini Live handles the conversation and delegates real work to Claude's PO/DEV pipeline. Let's get you set up in under a minute."}
        </p>
      </div>
    );
  } else if (current === "gemini") {
    body = (
      <>
        {geminiSection}
        {omniSection}
      </>
    );
  } else if (current === "claude") {
    body = claudeSection;
  } else if (current === "you") {
    body = youSection;
  } else if (current === "permissions") {
    body = permissionsSection;
  } else {
    body = (
      <div className="setup-welcome">
        <h2>{lang === "vi" ? "Đã sẵn sàng" : "You're all set"}</h2>
        <p>
          {lang === "vi"
            ? "Iris sẽ lưu cài đặt và khởi động. Nhấn phím W bất cứ lúc nào để đánh thức, phím S để ngủ."
            : "Iris will save your settings and wake up. Press W any time to wake, S to sleep."}
        </p>
        <ul className="setup-summary">
          <li>
            Gemini key {gemini.status === "ok" ? <Check size={13} className="ok" /> : keyReady ? "added" : "missing"}
          </li>
          <li>Voice · {draft.GEMINI_LIVE_VOICE}</li>
          <li>Name · {draft.IRIS_USER_NAME || "(not set)"}</li>
          <li>Mic · {mic === "granted" ? "granted" : "ask on start"}</li>
        </ul>
      </div>
    );
  }

  const isFirst = step === 0;
  const isLast = step === WIZARD_STEPS.length - 1;
  const canNext = current === "gemini" ? keyReady : true;

  return (
    <div className="setup-backdrop">
      <div className="setup-card wizard">
        <header className="setup-head">
          <span>Setup · {step + 1}/{WIZARD_STEPS.length}</span>
          <div className="setup-progress">
            {WIZARD_STEPS.map((name, index) => (
              <i key={name} className={index <= step ? "on" : ""} />
            ))}
          </div>
          <button className="reader-close" onClick={onClose} title={t.close}>
            <X size={16} />
          </button>
        </header>
        <div className="setup-scroll">{body}</div>
        <footer className="setup-foot">
          <button className="setup-btn ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={isFirst}>
            <ChevronLeft size={14} />
            {lang === "vi" ? "Quay lại" : "Back"}
          </button>
          {isLast ? (
            <button className="setup-btn primary" onClick={finishWizard} disabled={saving || !keyReady}>
              {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              {lang === "vi" ? "Lưu & Khởi Động Iris" : "Save & Start Iris"}
            </button>
          ) : (
            <button
              className="setup-btn primary"
              onClick={() => setStep((s) => Math.min(WIZARD_STEPS.length - 1, s + 1))}
              disabled={!canNext}
            >
              {isFirst ? (lang === "vi" ? "Bắt đầu" : "Get started") : (lang === "vi" ? "Tiếp theo" : "Next")}
              <ChevronRight size={14} />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

type Option = { value: string; label: string };

function ThemedSelect({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDoc = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (btnRef.current?.contains(target) || target.closest(".ts-menu")) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onScroll = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target && typeof target.closest === "function" && target.closest(".ts-menu")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuMax = 260;
    const dropUp = rect.bottom + menuMax > window.innerHeight && rect.top > window.innerHeight - rect.bottom;
    setPos({
      left: rect.left,
      width: rect.width,
      ...(dropUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
    });
    setOpen(true);
  }

  return (
    <div className="ts">
      <button
        ref={btnRef}
        type="button"
        className={`ts-trigger ${open ? "open" : ""}`}
        onClick={toggle}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <span className="ts-value">{current?.label ?? value}</span>
        <ChevronDown size={14} className="ts-chev" />
      </button>
      {open && pos ? (
        <div
          className="ts-menu"
          style={{
            position: "fixed",
            left: pos.left,
            width: pos.width,
            top: pos.top,
            bottom: pos.bottom,
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`ts-option ${option.value === value ? "sel" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
  compact,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={`setup-section ${compact ? "compact" : ""}`}>
      <h3>{title}</h3>
      {hint ? <p className="setup-hint">{hint}</p> : null}
      {children}
    </section>
  );
}

/**
 * Card độc lập (viền vi tế + nền kính mờ). Chỉ dùng cho các khối KHÔNG chứa ThemedSelect:
 * backdrop-filter biến phần tử thành containing block của `position: fixed`, sẽ làm lệch .ts-menu.
 */
function SetupBlock({
  icon,
  title,
  hint,
  aside,
  accent = "cyan",
  children,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  aside?: ReactNode;
  accent?: "cyan" | "mint";
  children: ReactNode;
}) {
  return (
    <section className={`setup-block accent-${accent}`}>
      <header className="setup-block-head">
        <span className="setup-block-icon" aria-hidden="true">
          {icon}
        </span>
        <div className="setup-block-titles">
          <h3>{title}</h3>
          {hint ? <p className="setup-hint">{hint}</p> : null}
        </div>
        {aside ? <div className="setup-block-aside">{aside}</div> : null}
      </header>
      <div className="setup-block-body">{children}</div>
    </section>
  );
}

/** Badge trạng thái OmniParser: xanh = đang chạy, xám = đang tắt, vàng = đang khởi động/dừng, đỏ = lỗi. */
function OmniStatusBadge({ phase, label }: { phase: OmniPhase; label: string }) {
  return (
    <span className={`omni-badge ${phase}`} role="status" aria-live="polite">
      {phase === "starting" || phase === "stopping" ? (
        <Loader2 size={12} className="spin" />
      ) : phase === "running" ? (
        <Check size={12} />
      ) : phase === "error" ? (
        <X size={12} />
      ) : (
        <span className="omni-dot" />
      )}
      <span>{label}</span>
    </span>
  );
}

function TestBadge({ state, okLabel }: { state: TestState; okLabel: string }) {
  if (state.status === "ok") {
    return (
      <span className="setup-result ok">
        <Check size={13} />
        {state.message || okLabel}
      </span>
    );
  }
  if (state.status === "error") {
    return (
      <span className="setup-result err" title={state.message}>
        <X size={13} />
        {state.message || "Failed"}
      </span>
    );
  }
  return null;
}

function PermRow({
  icon,
  label,
  required,
  state,
  onRequest,
  t,
}: {
  icon: ReactNode;
  label: string;
  required?: boolean;
  state: PermState;
  onRequest: () => void;
  t?: typeof I18N.en;
}) {
  return (
    <div className={`setup-perm ${state}`}>
      <span className="perm-icon">{icon}</span>
      <span className="perm-label">
        {label}
        {required ? <em>{t ? t.required : "required"}</em> : <em>{t ? t.optional : "optional"}</em>}
      </span>
      {state === "granted" ? (
        <span className="setup-result ok">
          <Check size={13} />
          {t ? t.granted : "Granted"}
        </span>
      ) : (
        <button className="setup-btn ghost" onClick={onRequest}>
          {state === "denied" ? (t ? t.retry : "Retry") : (t ? t.allow : "Allow")}
        </button>
      )}
    </div>
  );
}
