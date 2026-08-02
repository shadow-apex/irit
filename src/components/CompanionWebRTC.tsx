import { useEffect, useRef, useState } from 'react';
import { companionStream } from '../lib/companionStream';

// BUGFIX-COMP-ICE-01: Chỉ dùng STUN là nguyên nhân phổ biến nhất khiến PiP
// hiện lên, nút bấm phản hồi (vì đó chỉ là local/optimistic state), SDP
// signaling hoàn tất (nên pc.ontrack VẪN fire, publish stream -> PiP hết
// "Đang chờ điện thoại..." và hiện <video>) NHƯNG video/audio KHÔNG BAO GIỜ
// thực sự chảy: nhiều router WiFi gia đình/công ty bật "AP/Client Isolation"
// (điện thoại + PC tuy cùng WiFi nhưng không thấy nhau ở lớp 2) hoặc không hỗ
// trợ NAT hairpin/loopback (khi 2 máy cùng NAT ra 1 IP public, candidate
// server-reflexive từ STUN trỏ về chính IP đó và nhiều router từ chối route
// nó quay lại LAN). Cả hai trường hợp: ICE gathering + SDP offer/answer vẫn
// xong xuôi, nhưng ICE connection state kẹt ở "checking" rồi "failed" —
// đúng triệu chứng "PiP hiện, nút mic phản hồi, nhưng màn hình đen + im
// lặng hoàn toàn". Thêm TURN (relay) server làm phương án dự phòng: khi mọi
// candidate trực tiếp (host/srflx) đều thất bại, ICE sẽ tự chuyển sang dùng
// relay qua TURN, media đi vòng qua server thay vì P2P.
// LƯU Ý: đây là TURN server công khai/miễn phí của openrelay.metered.ca,
// dùng để TEST — có giới hạn băng thông/độ ổn định. Cho môi trường dùng lâu
// dài, nên tự chạy coturn (https://github.com/coturn/coturn) hoặc dùng dịch
// vụ TURN trả phí (Twilio, Metered, Cloudflare Calls...) rồi thay iceServers
// bên dưới bằng thông tin của bạn.
const RTC_CFG = {
  iceServers: [
    { urls: 'stun:stun.relay.metered.ca:80' },
    {
      urls: [
        'turn:global.relay.metered.ca:80',
        'turn:global.relay.metered.ca:443',
        'turn:global.relay.metered.ca:80?transport=tcp',
        'turns:global.relay.metered.ca:443?transport=tcp',
      ],
      username: '38d8be553dc5cd91666b1d9a',
      credential: '1lVLwxHcUQGDIm0Z',
    },
  ],
  iceCandidatePoolSize: 4,
};
const MAX_BUFFERED_BYTES = 1_000_000;

// FIX BUG-AUDIO-AUTOPLAY-01: Chromium chặn AudioContext ở trạng thái
// "suspended" cho tới khi có một User Gesture (click/keydown/touch) THẬT SỰ
// xảy ra trên trang, bất kể gesture đó có nhắm vào phần tử audio hay không.
// Vì Iris chạy dạng "always-on HUD", người dùng có thể không click gì cả
// sau khi mở app, nên nếu điện thoại kết nối trước khi có bất kỳ click nào,
// track audio nhận về sẽ bị nuốt im lặng.
//
// Giải pháp: gắn listener global (capture, một lần) lên toàn bộ window để
// bắt gesture ĐẦU TIÊN xảy ra sau khi AudioContext được tạo, và gọi
// ctx.resume() ngay lúc đó — mượt hơn nhiều so với bắt người dùng phải bấm
// đúng vào một nút cụ thể. Nếu vì lý do gì đó vẫn còn "suspended" sau vài
// giây (ví dụ trình duyệt coi gesture đó không hợp lệ), ta tiếp tục lắng
// nghe cho tới khi thành công.
function attachAudioAutoResume(ctx: AudioContext, onStateChange: (s: 'running' | 'suspended' | 'closed') => void) {
  const events: Array<keyof WindowEventMap> = ['pointerdown', 'mousedown', 'keydown', 'touchstart'];
  let disposed = false;

  const tryResume = () => {
    if (disposed || ctx.state !== 'suspended') return;
    ctx.resume().catch(() => {
      /* sẽ thử lại ở gesture kế tiếp */
    });
  };

  const cleanupGestureListeners = () => {
    events.forEach((evt) => window.removeEventListener(evt, tryResume, true));
  };

  events.forEach((evt) => window.addEventListener(evt, tryResume, true));

  ctx.addEventListener('statechange', () => {
    onStateChange(ctx.state as 'running' | 'suspended' | 'closed');
    if (ctx.state === 'running' || ctx.state === 'closed') {
      cleanupGestureListeners();
    } else if (ctx.state === 'suspended') {
      // Trường hợp ctx bị suspend lại (ví dụ HUD mất focus rồi quay lại):
      // đăng ký lại listener để lần click kế tiếp tự resume tiếp.
      events.forEach((evt) => window.addEventListener(evt, tryResume, true));
    }
  });

  onStateChange(ctx.state as 'running' | 'suspended' | 'closed');
  // Thử ngay một lần phòng khi đã có gesture xảy ra trước đó trong phiên này
  // (một số trình duyệt cho phép resume() nếu đã từng có gesture, dù đã qua
  // thời điểm gesture đó).
  tryResume();

  return () => {
    disposed = true;
    cleanupGestureListeners();
  };
}

export default function CompanionWebRTC() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [showAudioBadge, setShowAudioBadge] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioCleanupRef = useRef<(() => void) | null>(null);
  const frameIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!window.iris?.onCompanionWebRTCSignal) return;

    const handleSignal = async (msg: any) => {
      try {
        if (msg.type === 'offer') {
          console.log('[WebRTC Receiver] Got offer, creating PC...');
          if (pcRef.current) pcRef.current.close();
          const pc = new RTCPeerConnection(RTC_CFG);
          pcRef.current = pc;
          // FEAT-COMP-MIC-01: mỗi kết nối mới bắt đầu với giả định mic điện
          // thoại đang bật (đúng với hành vi mặc định của companion.html:
          // getUserMedia({ video, audio }) ngay khi bấm "CONNECT TO IRIS").
          // Không gửi tín hiệu ra điện thoại ở đây — chỉ đồng bộ lại state
          // hiển thị trên PC để nút mic trong PiP không bị "kẹt" trạng thái
          // tắt từ phiên kết nối trước.
          companionStream.setMicEnabled(true);

          // DEBUG-COMP-ICE-02: tracking candidate type song song với phía
          // companion.html — khi failed, phân biệt rõ "chưa từng thấy relay
          // candidate" (TURN không trả credential hợp lệ) với "có relay mà
          // vẫn fail" (nghi vấn TURN server quá tải/không route được).
          const seenCandidateTypes = new Set<string>();

          pc.onicecandidate = (e) => {
            if (e.candidate) {
              // BUGFIX-COMP-ICE-01: log loại candidate (host/srflx/relay) để
              // chẩn đoán nhanh trong DevTools (Ctrl+Shift+I) khi video/audio
              // không lên: nếu chỉ thấy "host"/"srflx" và ICE state rơi vào
              // "failed", gần như chắc chắn là do client isolation / NAT
              // hairpin — cần "relay" (TURN) để media thực sự đi qua được.
              const type = e.candidate.type || (e.candidate.candidate || '').match(/typ (\w+)/)?.[1];
              if (type) seenCandidateTypes.add(type);
              console.log('[WebRTC Receiver] Local ICE candidate:', type, e.candidate.candidate);
              window.iris.sendCompanionWebRTCSignal?.({ type: 'ice', candidate: e.candidate });
            }
          };

          // BUGFIX-COMP-ICE-01: `connectionState` là trạng thái TỔNG HỢP
          // (ICE + DTLS) và trên một số bản Chromium/Electron có thể chuyển
          // chậm hơn hoặc bỏ lỡ so với `iceConnectionState` (trạng thái ICE
          // thuần). Trước đây startExtraction() CHỈ được gọi dựa vào
          // connectionState (trong onconnectionstatechange bên dưới, và
          // trong nhánh ontrack khi connectionState đã là 'connected') — nếu
          // vì lý do gì đó connectionState không bao giờ báo 'connected' dù
          // ICE thực sự đã thông (relay/hairpin xử lý xong), audio/video
          // extraction sẽ không bao giờ chạy dù stream đã hiện trên PiP.
          // Thêm nhánh nghe iceConnectionState làm lưới an toàn thứ hai.
          pc.oniceconnectionstatechange = () => {
            console.log('[WebRTC Receiver] ICE state:', pc.iceConnectionState, '| candidate types seen:', [...seenCandidateTypes]);
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
              startExtraction();
            } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
              stopExtraction();
              if (pc.iceConnectionState === 'failed') {
                // DEBUG-COMP-ICE-02: xem giải thích ở khai báo seenCandidateTypes
                // phía trên. Log này là thứ cần xem đầu tiên khi PiP đen màn hình.
                if (!seenCandidateTypes.has('relay')) {
                  console.error(
                    '[WebRTC Receiver] ICE FAILED — PC không gather được relay candidate nào. ' +
                    'Nhiều khả năng TURN server (openrelay.metered.ca) đang không khả dụng/credential ' +
                    'tĩnh "openrelayproject" đã ngừng hoạt động — cân nhắc tự host coturn hoặc dùng ' +
                    'tài khoản Metered.ca có API key riêng.'
                  );
                } else {
                  console.error(
                    '[WebRTC Receiver] ICE FAILED — PC CÓ relay candidate nhưng vẫn không kết nối được. ' +
                    'Kiểm tra xem điện thoại (log trên trang companion.html) có gather được relay candidate ' +
                    'tương ứng không — nếu chỉ 1 bên có relay, 2 máy vẫn không nói chuyện được với nhau.'
                  );
                }
                // Không cần tự renegotiate ở đây: PC chỉ đóng vai trò answerer,
                // companion.html (phone) là bên tự động gửi lại offer mới sau
                // khi phát hiện failed (xem DEBUG-COMP-ICE-02 trong companion.html).
              }
            }
          };

          pc.ontrack = (e) => {
            console.log('[WebRTC Receiver] Got track:', e.track.kind);
            if (videoRef.current && e.streams[0]) {
              if (videoRef.current.srcObject !== e.streams[0]) {
                videoRef.current.srcObject = e.streams[0];
              }
            }
            // FIX BUG-COMP-WEBRTC-02: publish stream để CompanionVideo (PiP
            // Alt+C) có thể hiển thị trực tiếp, thay vì dùng đường
            // onCompanionFrame (Expo Go) cũ đã lỗi thời.
            if (e.streams[0]) {
              companionStream.setStream(e.streams[0]);
              // FIX: Đảm bảo extraction được bắt đầu lại nếu có track mới (đặc biệt là audio track)
              // đến sau khi kết nối đã thực sự thông, tránh việc audio bị bỏ qua.
              // BUGFIX-COMP-ICE-01: kiểm tra cả iceConnectionState (không chỉ
              // connectionState) — xem comment ở oniceconnectionstatechange.
              const ice = pcRef.current?.iceConnectionState;
              if (pcRef.current?.connectionState === 'connected' || ice === 'connected' || ice === 'completed') {
                startExtraction();
              }
            }
          };

          pc.onconnectionstatechange = () => {
            console.log('[WebRTC Receiver] State:', pc.connectionState);
            if (pc.connectionState === 'connected') {
              startExtraction();
            } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
              stopExtraction();
            }
          };

          await pc.setRemoteDescription(msg.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          window.iris.sendCompanionWebRTCSignal?.({ type: 'answer', sdp: pc.localDescription });
          
        } else if (msg.type === 'ice' && msg.candidate && pcRef.current) {
          await pcRef.current.addIceCandidate(msg.candidate);
        } else if (msg.type === 'peer-ready') {
          // BUG-COMP-HANDSHAKE-01 FIX: Điện thoại (companion.html) chỉ gọi
          // makeOffer() khi nó NHẬN được tin 'peer-ready' từ phía bên kia —
          // nó không tự gọi makeOffer() ngay khi tự nó gửi 'peer-ready' đi.
          // Trước đây nhánh này không làm gì cả, nên desktop không bao giờ
          // echo lại 'peer-ready', khiến điện thoại đứng mãi ở trạng thái
          // "WebSocket connected. Notifying desktop..." và desktop đứng mãi
          // chờ offer — cả hai chờ nhau vô thời hạn dù WebSocket đã kết nối
          // thành công. Phản hồi lại 'peer-ready' ở đây để khởi động
          // handshake: điện thoại nhận được tin này sẽ gọi makeOffer() và
          // gửi SDP offer sang, desktop sẽ nhận ở nhánh msg.type === 'offer'
          // phía trên.
          window.iris.sendCompanionWebRTCSignal?.({ type: 'peer-ready' });
        } else if (msg.type === 'peer-left') {
          stopExtraction();
          if (pcRef.current) pcRef.current.close();
          companionStream.setStream(null);
          companionStream.setAudioState('idle');
          // FEAT-COMP-MIC-01: reset về mặc định "mic bật" cho lần kết nối kế tiếp.
          companionStream.setMicEnabled(true);
        }
      } catch (err) {
        console.error('[WebRTC Receiver] Error handling signal:', err);
      }
    };

    const cleanupSignal = window.iris.onCompanionWebRTCSignal(handleSignal);

    return () => {
      cleanupSignal();
      stopExtraction();
      if (pcRef.current) pcRef.current.close();
    };
  }, []);

  useEffect(() => {
    let timer: number | null = null;
    const unsubscribe = companionStream.subscribeAudioState((state) => {
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (state === 'suspended') {
        // Chỉ hiện badge nếu global click listener chưa kịp tự resume trong
        // vài giây — tránh nháy badge không cần thiết ở trường hợp bình
        // thường (đa số resume ngay lập tức khi có gesture đầu tiên).
        timer = window.setTimeout(() => setShowAudioBadge(true), 2500);
      } else {
        setShowAudioBadge(false);
      }
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  const startExtraction = async () => {
    stopExtraction(); // Ensure clean state
    
    // 1. Frame Extraction (Video)
    frameIntervalRef.current = window.setInterval(() => {
      if (!videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      // Only extract if video is actually playing
      if (video.readyState < 2 || video.videoWidth === 0) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.2);
      const base64 = dataUrl.split(',')[1];
      if (base64) {
        window.iris.sendCompanionWebRTCFrame?.(base64);
      }
    }, 1000); // 1 FPS

    // 2. Audio Extraction (PCM 16kHz)
    try {
      const stream = videoRef.current?.srcObject as MediaStream;
      if (!stream || stream.getAudioTracks().length === 0) return;

      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = ctx;

      // FIX BUG-AUDIO-AUTOPLAY-01: nếu ctx bị Chromium tạo ra ở trạng thái
      // suspended (do thiếu User Gesture), tự resume() ở cú click/keydown
      // đầu tiên trên toàn HUD, và báo trạng thái ra store để UI (PiP) có
      // thể hiện một badge nhỏ "Nhấn để bật âm thanh" nếu cần.
      companionStream.registerResumeFn(() => ctx.resume());
      const detachAutoResume = attachAudioAutoResume(ctx, (state) => {
        companionStream.setAudioState(state as any);
      });
      audioCleanupRef.current = detachAutoResume;

      const source = ctx.createMediaStreamSource(stream);
      
      const workletCode = `
        class PCMProcessor extends AudioWorkletProcessor {
          process(inputs, outputs, parameters) {
            const input = inputs[0];
            if (input && input.length > 0) {
              const channelData = input[0];
              if (channelData) {
                const pcmData = new Int16Array(channelData.length);
                for (let i = 0; i < channelData.length; i++) {
                  let s = Math.max(-1, Math.min(1, channelData[i]));
                  pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                this.port.postMessage(pcmData.buffer, [pcmData.buffer]);
              }
            }
            return true;
          }
        }
        registerProcessor('pcm-processor', PCMProcessor);
      `;
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      
      await ctx.audioWorklet.addModule(url);
      const audioWorkletNode = new AudioWorkletNode(ctx, 'pcm-processor');
      
      audioWorkletNode.port.onmessage = (e) => {
        // e.data is an ArrayBuffer containing Int16 PCM
        window.iris.sendCompanionWebRTCAudio?.(e.data);
      };
      
      source.connect(audioWorkletNode);
      audioWorkletNode.connect(ctx.destination);
    } catch (err) {
      console.error('[WebRTC Receiver] Audio extraction failed:', err);
    }
  };

  const stopExtraction = () => {
    if (frameIntervalRef.current) {
      window.clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (audioCleanupRef.current) {
      audioCleanupRef.current();
      audioCleanupRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    companionStream.registerResumeFn(null);
    companionStream.setAudioState('idle');
  };

  return (
    <>
      <div style={{ display: 'none' }}>
        <video ref={videoRef} autoPlay playsInline muted />
        <canvas ref={canvasRef} />
      </div>
      {showAudioBadge && (
        <div
          onClick={() => {
            companionStream.requestResume();
            setShowAudioBadge(false);
          }}
          style={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            zIndex: 99999,
            padding: '8px 14px',
            borderRadius: 999,
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            fontSize: 12,
            fontFamily: 'inherit',
            cursor: 'pointer',
            backdropFilter: 'blur(4px)',
            border: '1px solid rgba(255,255,255,0.15)',
            userSelect: 'none',
          }}
          title="Click vào đây (hoặc bất kỳ đâu trên màn hình) để kết nối Audio từ điện thoại"
        >
          🔇 Click để bật Audio Companion
        </div>
      )}
    </>
  );
}
