import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mic,
  Play,
  Wand2,
  X,
} from "lucide-react";

type Mode = "onboarding" | "settings";
type TestState = { status: "idle" | "testing" | "ok" | "error"; message?: string };
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
    geminiTitle: "Gemini API Keys",
    geminiHint: "Powers Iris's realtime voice. Get one free at Google AI Studio.",
    apiKey: "Gemini API Key",
    apiKeySaved: "•••• Stored (enter new to change)",
    apiKeyPlaceholder: "AI… paste your key",
    apiKeyNote: "Get a free key from Google AI Studio. Stored locally only.",
    visionKey: "Vision API Key (Optional)",
    visionKeySaved: "•••• Stored (enter new to change)",
    visionKeyPlaceholder: "For vision/image analysis (avoids live quota)",
    visionKeyNote: "Separate key for image processing. Uses Live key if empty.",
    testGemini: "Test Gemini",
    keyWorks: "Key works",
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
    geminiTitle: "Khoá Gemini API",
    geminiHint: "Cung cấp giọng nói thời gian thực. Lấy miễn phí tại Google AI Studio.",
    apiKey: "Khoá Gemini API",
    apiKeySaved: "•••• Đã lưu (nhập khoá mới để thay)",
    apiKeyPlaceholder: "AI… dán khoá của bạn",
    apiKeyNote: "Lấy khoá miễn phí tại Google AI Studio. Chỉ lưu trữ trên máy.",
    visionKey: "Khoá Vision API (Tuỳ chọn)",
    visionKeySaved: "•••• Đã lưu (nhập khoá mới để thay)",
    visionKeyPlaceholder: "Dùng xử lý ảnh (tránh đụng quota)",
    visionKeyNote: "Tách riêng quota xử lý ảnh. Nếu bỏ trống sẽ dùng chung khoá trên.",
    testGemini: "Kiểm tra Gemini",
    keyWorks: "Kết nối tốt",
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
    GEMINI_API_KEY: "",
    GEMINI_VISION_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    GEMINI_LIVE_MODEL: config.geminiModel,
    GEMINI_LIVE_VOICE: config.geminiVoice,
    IRIS_USER_NAME: config.userName,
    IRIS_LOAD_TEST_DATA: config.loadTestData ? "true" : "false",
    IRIS_WAKE_WORD: config.wakeWord ? "true" : "false",
    IRIS_PROMPT_REVIEW_MODE: config.promptReviewMode ? "true" : "false",
    IRIS_CLAUDE_ENABLED: config.claudeEnabled ? "true" : "false",
  });
  const [step, setStep] = useState(0);
  const [gemini, setGemini] = useState<TestState>({ status: "idle" });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function testGemini() {
    setGemini({ status: "testing" });
    const result = await window.iris.testGemini(draft.GEMINI_API_KEY.trim());
    setGemini(result.ok ? { status: "ok", message: t.keyWorks } : { status: "error", message: result.error });
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
  const geminiSection = (
    <Section title={t.geminiTitle} hint={t.geminiHint} compact>
      <div className="setup-grid-2">
        <label className="setup-field compact">
          <span>{t.apiKey}</span>
          <input
            type="password"
            value={draft.GEMINI_API_KEY}
            placeholder={config.geminiApiKeySet ? `•••• ${config.geminiApiKeyHint} — ${t.apiKeySaved}` : t.apiKeyPlaceholder}
            onChange={(event) => {
              set("GEMINI_API_KEY", event.target.value);
              setGemini({ status: "idle" });
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <small className="setup-note">
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              Google AI Studio
            </a>
            . {t.apiKeyNote}
          </small>
        </label>
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
      <div className="setup-actions compact">
        <button className="setup-btn" onClick={testGemini} disabled={!keyReady || gemini.status === "testing"}>
          {gemini.status === "testing" ? <Loader2 size={13} className="spin" /> : null}
          {t.testGemini}
        </button>
        <TestBadge state={gemini} okLabel={t.keyWorks} />
      </div>
    </Section>
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
                {claudeSection}
              </>
            )}
            {activeTab === "voice" && youSection}
            {activeTab === "system" && (
              <>
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
    body = geminiSection;
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
