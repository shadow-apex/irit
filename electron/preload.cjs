const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("iris", {
  startSidecar: (options) => ipcRenderer.invoke("sidecar:start", options),
  stopSidecar: () => ipcRenderer.invoke("sidecar:stop"),
  getSidecarStatus: () => ipcRenderer.invoke("sidecar:status"),
  sendCommand: (command) => ipcRenderer.invoke("sidecar:command", command),
  getSessions: () => ipcRenderer.invoke("sessions:get"),
  getRobots: () => ipcRenderer.invoke("robots:get"),
  triggerRobotAction: (args) => ipcRenderer.invoke("robots:action", args),
  // FEAT-SH-CAM-01: Smart Home Camera Vision — đọc smarthome_cameras.json,
  // song song với getRobots()/robots.json nhưng tách domain riêng.
  getSmartHomeCamerasConfig: () => ipcRenderer.invoke("smarthome-cameras:get-config"),
  openApp: (target) => ipcRenderer.invoke("app:open", target),
  getDesktopApps: () => ipcRenderer.invoke("desktop:apps"),
  getLocalIp: () => ipcRenderer.invoke("network:get-ip"),
  startCompanionExpo: () => ipcRenderer.invoke("companion:start-expo"),
  getCompanionTunnel: () => ipcRenderer.invoke("companion:get-tunnel"),
  getCompanionWsTunnel: () => ipcRenderer.invoke("companion:get-ws-tunnel"),
  getCompanionWsToken: () => ipcRenderer.invoke("companion:get-ws-token"),
  getPhoneCamUrl: () => ipcRenderer.invoke("companion:get-phone-cam-url"),
  selectSession: (id) => ipcRenderer.invoke("sessions:select", id),
  newSession: (label) => ipcRenderer.invoke("sessions:new", label),
  chooseProjectFolder: (id) => ipcRenderer.invoke("sessions:choose-cwd", id),
  listAgents: (workstreamId) => ipcRenderer.invoke("agents:list", workstreamId),
  selectAgent: (workstreamId, agent) => ipcRenderer.invoke("agents:select", { workstreamId, agent }),
  installAgents: () => ipcRenderer.invoke("agents:install"),
  setAgentModel: (workstreamId, role, model) =>
    ipcRenderer.invoke("agents:set-model", { workstreamId, role, model }),
  answerPoQuestion: (answers) => ipcRenderer.invoke("po:answer-question", answers),
  sendContextSupplement: (text) => ipcRenderer.invoke("context-supplement:send", text),
  sendPhoneCommand: (text) => ipcRenderer.invoke("phone-command:send", text),
  toggleHud: () => ipcRenderer.invoke("hud:toggle"),
  setHudInteractive: (on) => ipcRenderer.send("hud:interactive", Boolean(on)),
  windowControl: (action) => ipcRenderer.send("win:control", action),
  onHudMode: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("hud:mode", handler);
    return () => ipcRenderer.removeListener("hud:mode", handler);
  },
  onHudStats: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("hud:stats", handler);
    return () => ipcRenderer.removeListener("hud:stats", handler);
  },
  onHudMessage: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("hud:message", handler);
    return () => ipcRenderer.removeListener("hud:message", handler);
  },
  // Live Teleprompter (Alt+T) — "Dịch" (dịch hội thoại sang ngôn ngữ chọn
  // trước) và "Nhắc bài" (gợi ý trả lời khi người đối diện hỏi, hiển thị
  // MINH BẠCH trên HUD dưới dạng danh sách câu hỏi/gợi ý cuộn được — không
  // có cơ chế tự tắt mic).
  getTeleprompterState: () => ipcRenderer.invoke("teleprompter:get-state"),
  toggleTranslate: (targetLang) => ipcRenderer.invoke("teleprompter:toggle-translate", targetLang),
  toggleInterviewCopilot: () => ipcRenderer.invoke("teleprompter:toggle-copilot"),
  askTeleprompter: (question) => ipcRenderer.invoke("teleprompter:ask", question),
  sendDeskVisionFrame: (base64) => ipcRenderer.send("vision:desk-frame", base64),
  onSnapDeskVision: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("vision:snap-desk", handler);
    return () => ipcRenderer.removeListener("vision:snap-desk", handler);
  },
  onToggleDeskContinuous: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("vision:toggle-desk-continuous", handler);
    return () => ipcRenderer.removeListener("vision:toggle-desk-continuous", handler);
  },
  // FEAT-VIS-DIRECT-01: Direct Stream Vision — Renderer tự vẽ frame từ
  // MediaStream (Companion WebRTC / robot) lên <canvas> và đẩy JPEG/base64
  // lên đây; Main chỉ chuyển tiếp thẳng vào Gemini, không dùng desktopCapturer.
  sendCameraStreamFrame: (base64) => ipcRenderer.send("vision:camera-stream-frame", base64),
  onToggleCameraStreamVision: (callback) => {
    const handler = (_event, enabled) => callback(enabled);
    ipcRenderer.on("vision:toggle-camera-stream", handler);
    return () => ipcRenderer.removeListener("vision:toggle-camera-stream", handler);
  },
  onWakeRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("iris:wake", handler);
    return () => ipcRenderer.removeListener("iris:wake", handler);
  },
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (updates) => ipcRenderer.invoke("config:save", updates),
  testGemini: (key) => ipcRenderer.invoke("config:test-gemini", { key }),
  testClaude: () => ipcRenderer.invoke("config:test-claude"),
  previewVoice: (payload) => ipcRenderer.invoke("config:preview-voice", payload),
  // --- Ported from myiris ---
  getPromptStatus: () => ipcRenderer.invoke("prompt:status"),
  resolvePromptReview: (payload) => ipcRenderer.invoke("prompt:resolve-review", payload),
  setPromptReviewMode: (enabled) => ipcRenderer.invoke("prompt:set-review-mode", { enabled }),
  activateDrawingCanvas: () => ipcRenderer.send("canvas:activate"),
  saveCanvasScene: (scene) => ipcRenderer.send("canvas:scene", scene),
  getCanvasScene: () => ipcRenderer.invoke("canvas:get-scene"),
  onCanvasApply: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("canvas:apply", handler);
    return () => ipcRenderer.removeListener("canvas:apply", handler);
  },
  onCanvasImageRequest: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("canvas:request-image", handler);
    return () => ipcRenderer.removeListener("canvas:request-image", handler);
  },
  replyCanvasImage: (id, image) => ipcRenderer.send("canvas:image-result", { id, image }),
  nativeOpenCanvasFile: () => ipcRenderer.invoke("canvas:native-open-file"),
  nativeSaveCanvasFile: (content, suggestedName) =>
    ipcRenderer.invoke("canvas:native-save-file", { content, suggestedName }),
  nativeExportCanvasImage: (data, format, suggestedName) =>
    ipcRenderer.invoke("canvas:native-export-image", { data, format, suggestedName }),
  getSecondBrainAvailability: () => ipcRenderer.invoke("secondbrain:availability"),
  getSecondBrainGraph: () => ipcRenderer.invoke("secondbrain:get-graph"),
  readSecondBrainNote: (id) => ipcRenderer.invoke("secondbrain:read-note", id),
  activateSecondBrain: () => ipcRenderer.send("secondbrain:activate"),
  deactivateSecondBrain: () => ipcRenderer.send("secondbrain:deactivate"),
  onSecondBrainGraphUpdated: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("secondbrain:graph-updated", handler);
    return () => ipcRenderer.removeListener("secondbrain:graph-updated", handler);
  },
  installNotesSkills: () => ipcRenderer.invoke("notes-skills:install"),
  getNotesSkillsStatus: () => ipcRenderer.invoke("notes-skills:status"),
  sendUiContext: (context) => ipcRenderer.send("iris:ui-context", context),
  notifyBootDone: () => ipcRenderer.send("iris:boot-done"),
  onUiAction: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("iris:ui-action", handler);
    return () => ipcRenderer.removeListener("iris:ui-action", handler);
  },
  onSleepRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("iris:sleep", handler);
    return () => ipcRenderer.removeListener("iris:sleep", handler);
  },
  sendAudioChunk: (chunk) => ipcRenderer.send("live:audio", chunk),
  onAudioChunk: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("live:audio", handler);
    return () => ipcRenderer.removeListener("live:audio", handler);
  },
  onAudioInterrupt: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("live:interrupt", handler);
    return () => ipcRenderer.removeListener("live:interrupt", handler);
  },
  onSilentModeChange: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("iris:silent-mode", handler);
    return () => ipcRenderer.removeListener("iris:silent-mode", handler);
  },
  onActionLanesChange: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("iris:action-lanes-change", listener);
    return () => ipcRenderer.removeListener("iris:action-lanes-change", listener);
  },
  onSidecarEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("sidecar:event", handler);
    return () => ipcRenderer.removeListener("sidecar:event", handler);
  },
  sendHandGesture: (gesture) => ipcRenderer.send("iris:hand-gesture", gesture),
  // BUG-COMP-02 FIX: Expose companion frame listener so renderer can
  // display or forward phone camera frames to Gemini Live.
  onCompanionFrame: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("companion:frame", handler);
    return () => ipcRenderer.removeListener("companion:frame", handler);
  },
  onCompanionStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("companion:status", handler);
    return () => ipcRenderer.removeListener("companion:status", handler);
  },
  onToggleRobotPip: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("ui:toggle-robot-pip", handler);
    return () => ipcRenderer.removeListener("ui:toggle-robot-pip", handler);
  },
  onToggleCompanionPip: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("ui:toggle-companion-pip", handler);
    return () => ipcRenderer.removeListener("ui:toggle-companion-pip", handler);
  },
  // FEAT-SH-CAM-01: hotkey Alt+H — bật/tắt PiP camera nhà thông minh.
  onToggleSmartHomePip: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("ui:toggle-smarthome-pip", handler);
    return () => ipcRenderer.removeListener("ui:toggle-smarthome-pip", handler);
  },
  // FEAT-COMP-LIVE-01: lệnh thoại/tool "open_companion_live_view" -> mở cửa
  // sổ video lớn ở giữa màn hình (CompanionLiveView.tsx), khác panel Alt+C.
  onOpenCompanionLiveView: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("companion:open-live-view", handler);
    return () => ipcRenderer.removeListener("companion:open-live-view", handler);
  },
  onCompanionWebRTCSignal: (callback) => {
    const handler = (_event, signal) => callback(signal);
    ipcRenderer.on("companion:webrtc-signal", handler);
    return () => ipcRenderer.removeListener("companion:webrtc-signal", handler);
  },
  sendCompanionWebRTCSignal: (signal) => ipcRenderer.send("companion:webrtc-signal-to-phone", signal),
  sendCompanionWebRTCFrame: (base64) => ipcRenderer.send("companion:webrtc-frame", base64),
  sendCompanionWebRTCAudio: (pcm) => ipcRenderer.send("companion:webrtc-audio", pcm),
  openApp: (target) => ipcRenderer.invoke("app:open", target),
});
