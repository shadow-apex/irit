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

let currentStream: MediaStream | null = null;
let currentAudioState: AudioResumeState = "idle";
let resumeFn: (() => Promise<void>) | null = null;

const streamListeners = new Set<StreamListener>();
const audioListeners = new Set<AudioListener>();

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
};
