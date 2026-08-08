// src/lib/companionStream.ts
//
// FIX BUG-COMP-WEBRTC-01 / BUG-COMP-WEBRTC-02:
// Singleton nhỏ (module-level, không phải React Context) để chia sẻ
// MediaStream + trạng thái AudioContext của luồng WebRTC (được quản lý
// trong CompanionWebRTC.tsx, luôn mount ngầm) sang bất kỳ UI nào cần hiển
// thị nó — cụ thể là cửa sổ PiP "Alt+C" (CompanionVideo.tsx).
//
// Trước đây CompanionVideo.tsx dùng window.iris.onCompanionFrame (đường
// Expo Go cũ, gửi từng frame JPEG rời rạc) trong khi luồng thật (WebRTC,
// có video+audio) chạy ẩn (display:none) trong CompanionWebRTC.tsx và
// không hề được kết nối với PiP. Dùng singleton này để cả hai component
// cùng nhìn vào MỘT nguồn sự thật, tránh phải tạo thêm 1 RTCPeerConnection
// thứ hai (sẽ đụng độ với luồng signalling hiện có).

export type AudioResumeState = "idle" | "running" | "suspended" | "closed";

type StreamListener = (stream: MediaStream | null) => void;
type AudioListener = (state: AudioResumeState) => void;
type MicListener = (enabled: boolean) => void;

let currentStream: MediaStream | null = null;
let currentAudioState: AudioResumeState = "idle";
let resumeFn: (() => Promise<void>) | null = null;
// FEAT-COMP-MIC-01: trạng thái mic ở ĐIỆN THOẠI (nguồn gửi), khác hoàn toàn
// với `currentAudioState` ở trên (đó là trạng thái AudioContext PHÍA PC dùng
// để phát lại audio nhận được). Mặc định true vì companion.html luôn bật cả
// video+audio ngay khi bấm "CONNECT TO IRIS" (getUserMedia({video, audio})).
let currentMicEnabled = true;

const streamListeners = new Set<StreamListener>();
const audioListeners = new Set<AudioListener>();
const micListeners = new Set<MicListener>();

export const companionStream = {
  setStream(stream: MediaStream | null) {
    currentStream = stream;
    streamListeners.forEach((l) => l(stream));
  },
  getStream(): MediaStream | null {
    return currentStream;
  },
  subscribeStream(listener: StreamListener): () => void {
    streamListeners.add(listener);
    // Gọi ngay với giá trị hiện có để component mount sau vẫn thấy stream
    // đã tồn tại từ trước (ví dụ mở PiP sau khi điện thoại đã kết nối).
    listener(currentStream);
    return () => streamListeners.delete(listener);
  },

  setAudioState(state: AudioResumeState) {
    currentAudioState = state;
    audioListeners.forEach((l) => l(state));
  },
  getAudioState(): AudioResumeState {
    return currentAudioState;
  },
  subscribeAudioState(listener: AudioListener): () => void {
    audioListeners.add(listener);
    listener(currentAudioState);
    return () => audioListeners.delete(listener);
  },

  // Cho phép UI (ví dụ nút bấm trong overlay) chủ động yêu cầu resume,
  // thay vì chỉ chờ global click listener trong CompanionWebRTC.tsx.
  registerResumeFn(fn: (() => Promise<void>) | null) {
    resumeFn = fn;
  },
  async requestResume() {
    if (resumeFn) {
      try {
        await resumeFn();
      } catch {
        // im lặng bỏ qua — global click listener sẽ tự thử lại
      }
    }
  },

  // ── FEAT-COMP-MIC-01: bật/tắt mic điện thoại từ PC ─────────────────────
  // Cập nhật local state (optimistic — UI phản hồi ngay lập tức) và gửi tín
  // hiệu 'mic-toggle' qua kênh signalling WebRTC hiện có
  // (window.iris.sendCompanionWebRTCSignal -> companion:webrtc-signal-to-phone
  // -> companion-server.mjs -> WebSocket -> companion.html), nơi điện thoại
  // set `audioTrack.enabled = enabled`. Dùng `.enabled` (không phải
  // `stop()`) nên có thể bật lại ngay lập tức mà không cần renegotiate hay
  // xin lại quyền truy cập mic.
  getMicEnabled(): boolean {
    return currentMicEnabled;
  },
  subscribeMicState(listener: MicListener): () => void {
    micListeners.add(listener);
    listener(currentMicEnabled);
    return () => micListeners.delete(listener);
  },
  // Chỉ cập nhật local state (dùng khi reset về mặc định lúc có kết nối mới,
  // KHÔNG gửi tín hiệu ra điện thoại — tránh gửi thừa khi điện thoại vốn dĩ
  // đã bắt đầu ở trạng thái mic bật sẵn).
  setMicEnabled(enabled: boolean) {
    currentMicEnabled = enabled;
    micListeners.forEach((l) => l(enabled));
  },
  // Người dùng chủ động bấm nút mic trên PC: cập nhật local state ngay
  // (optimistic) rồi gửi tín hiệu thật sự ra điện thoại.
  requestMicToggle(enabled: boolean) {
    currentMicEnabled = enabled;
    micListeners.forEach((l) => l(enabled));
    try {
      window.iris?.sendCompanionWebRTCSignal?.({ type: "mic-toggle", enabled });
    } catch {
      // im lặng bỏ qua — nếu kênh signalling lỗi, resync sẽ xảy ra ở lần
      // kết nối kế tiếp (setMicEnabled(true) reset về mặc định)
    }
  },
};
