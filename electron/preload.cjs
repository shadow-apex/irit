const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("iris", {
  startSidecar: (options) => ipcRenderer.invoke("sidecar:start", options),
  stopSidecar: () => ipcRenderer.invoke("sidecar:stop"),
  getSidecarStatus: () => ipcRenderer.invoke("sidecar:status"),
  sendCommand: (command) => ipcRenderer.invoke("sidecar:command", command),
  getSessions: () => ipcRenderer.invoke("sessions:get"),
  getRobots: () => ipcRenderer.invoke("robots:get"),
  triggerRobotAction: (args) => ipcRenderer.invoke("robots:action", args),
  getLocalIp: () => ipcRenderer.invoke("network:get-ip"),
  startCompanionExpo: () => ipcRenderer.invoke("companion:start-expo"),
  getCompanionTunnel: () => ipcRenderer.invoke("companion:get-tunnel"),
  getCompanionWsTunnel: () => ipcRenderer.invoke("companion:get-ws-tunnel"),
  getCompanionWsToken: () => ipcRenderer.invoke("companion:get-ws-token"),
  getCompanionHttpsReady: () => ipcRenderer.invoke("companion:get-https-ready"),
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
  onCompanionWebRTCSignal: (callback) => {
    const handler = (_event, signal) => callback(signal);
    ipcRenderer.on("companion:webrtc-signal", handler);
    return () => ipcRenderer.removeListener("companion:webrtc-signal", handler);
  },
  sendCompanionWebRTCSignal: (signal) => ipcRenderer.send("companion:webrtc-signal-to-phone", signal),
  sendCompanionWebRTCFrame: (base64) => ipcRenderer.send("companion:webrtc-frame", base64),
  sendCompanionWebRTCAudio: (pcm) => ipcRenderer.send("companion:webrtc-audio", pcm),
});
