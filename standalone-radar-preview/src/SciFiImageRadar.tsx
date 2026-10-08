import { useEffect, useState, useRef } from 'react';

import part1 from './part1_outer.png';
import part2 from './part2_middle_outer.png';
import part3 from './part3_middle_inner.png';
import part4 from './part4_center.png';

interface SciFiImageRadarProps {
  onComplete?: () => void;
  autoStart?: boolean;
}

export default function SciFiImageRadar({ onComplete, autoStart = false }: SciFiImageRadarProps) {
  const [started, setStarted] = useState(autoStart);
  const [fadeComplete, setFadeComplete] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
        if (!started) {
          setStarted(true);
        } else {
          setFadeComplete(true);
          setTimeout(() => onComplete?.(), 500);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [started, onComplete]);

  useEffect(() => {
    if (started) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }
      const timer = setTimeout(() => {
        setFadeComplete(true);
        setTimeout(() => onComplete?.(), 1000);
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [started, onComplete]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      backgroundColor: '#000', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      opacity: fadeComplete ? 0 : 1, transition: 'opacity 1s ease-in-out',
      overflow: 'hidden', fontFamily: 'monospace'
    }}>
      
      <audio ref={audioRef} src="/audio.mp3" preload="auto" />

      {!started && (
        <div style={{ color: '#0ff', fontSize: '24px', letterSpacing: '4px', zIndex: 10, animation: 'pulse 1.5s infinite' }}>
          PRESS ENTER TO INITIATE RADAR SCAN
        </div>
      )}

      {started && (
        <div style={{ position: 'relative', width: '800px', height: '800px', borderRadius: '50%' }}>
          
          <img src={part1} alt="Outer Ring" style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            mixBlendMode: 'screen', animation: 'spinOuter 60s linear infinite'
          }} />

          <img src={part2} alt="Middle Outer Ring" style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            mixBlendMode: 'screen', animation: 'spinInner 25s linear infinite'
          }} />

          <img src={part3} alt="Middle Inner Ring" style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            mixBlendMode: 'screen', animation: 'spinOuter 35s linear infinite'
          }} />

          <img src={part4} alt="Center Compass" style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            mixBlendMode: 'screen', animation: 'spinInner 15s linear infinite'
          }} />

          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            color: '#0ff', textAlign: 'center', textShadow: '0 0 10px #0ff', zIndex: 10
          }}>
            <div style={{ fontSize: '18px', fontWeight: 'bold' }}>SCANNING SECTOR</div>
            <div style={{ fontSize: '12px', marginTop: '10px', opacity: 0.8 }}>SYSTEM LINK ACTIVE</div>
          </div>
        </div>
      )}

      <style>
        {`
          @keyframes spinOuter { 100% { transform: rotate(360deg); } }
          @keyframes spinInner { 100% { transform: rotate(-360deg); } }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        `}
      </style>
    </div>
  );
}

