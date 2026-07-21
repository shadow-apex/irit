import { useEffect, useRef } from 'react';

const RTC_CFG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const MAX_BUFFERED_BYTES = 1_000_000;

export default function CompanionWebRTC() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
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

          pc.onicecandidate = (e) => {
            if (e.candidate) {
              window.iris.sendCompanionWebRTCSignal({ type: 'ice', candidate: e.candidate });
            }
          };

          pc.ontrack = (e) => {
            console.log('[WebRTC Receiver] Got track:', e.track.kind);
            if (videoRef.current && e.streams[0]) {
              videoRef.current.srcObject = e.streams[0];
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
          window.iris.sendCompanionWebRTCSignal({ type: 'answer', sdp: pc.localDescription });
          
        } else if (msg.type === 'ice' && msg.candidate && pcRef.current) {
          await pcRef.current.addIceCandidate(msg.candidate);
        } else if (msg.type === 'peer-ready') {
          // Phone is ready, but phone sends the offer.
        } else if (msg.type === 'peer-left') {
          stopExtraction();
          if (pcRef.current) pcRef.current.close();
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
        window.iris.sendCompanionWebRTCFrame(base64);
      }
    }, 1000); // 1 FPS

    // 2. Audio Extraction (PCM 16kHz)
    try {
      const stream = videoRef.current?.srcObject as MediaStream;
      if (!stream || stream.getAudioTracks().length === 0) return;

      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = ctx;

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
        window.iris.sendCompanionWebRTCAudio(e.data);
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
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  };

  return (
    <div style={{ display: 'none' }}>
      <video ref={videoRef} autoPlay playsInline muted />
      <canvas ref={canvasRef} />
    </div>
  );
}
