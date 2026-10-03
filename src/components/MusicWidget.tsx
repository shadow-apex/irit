import React, { useEffect, useState } from 'react';

interface MusicData {
  title: string;
  artist: string;
  status: 'playing' | 'paused' | 'stopped' | 'closed' | 'opened' | 'changing';
  source: string;
}

// Fixed fake audio visualizer shaped like a waveform
const AudioVisualizer = ({ isPlaying }: { isPlaying: boolean }) => {
  // A static waveform shape to match the image, with random tiny variations when playing
  const baseHeights = [
    2, 3, 2, 4, 3, 5, 4, 7, 5, 8, 
    12, 16, 12, 8, 14, 18, 14, 10, 6, 4,
    5, 3, 4, 2, 3, 2
  ];

  return (
    <div className="flex items-center gap-[2px] h-6 mx-4">
      {baseHeights.map((h, i) => (
        <div
          key={i}
          className={`w-[2px] bg-cyan-400 rounded-full transition-all duration-75`}
          style={{
            height: isPlaying ? `${h * 1.5 + Math.random() * 4}px` : `${h}px`,
            opacity: isPlaying ? 0.8 + Math.random() * 0.2 : 0.5,
          }}
        />
      ))}
    </div>
  );
};

export const MusicWidget: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [musicData, setMusicData] = useState<MusicData | null>(null);

  useEffect(() => {
    if (!window.iris) return;

    const removeUpdateListener = window.iris.onMusicUpdate((data: MusicData | null) => {
      setMusicData(data);
    });

    const removeToggleListener = window.iris.onMusicToggle(() => {
      setVisible(v => !v);
    });

    return () => {
      if (removeUpdateListener) removeUpdateListener();
      if (removeToggleListener) removeToggleListener();
    };
  }, []);

  const handleControl = (action: 'play-pause' | 'next' | 'prev') => {
    if (window.iris?.sendMusicControl) {
      window.iris.sendMusicControl(action);
    }
  };

  if (!visible) return null;

  const isPlaying = musicData?.status === 'playing';
  const trackName = (musicData?.title || 'NO MEDIA').toUpperCase();
  const artistName = (musicData?.artist || musicData?.source || 'UNKNOWN').toUpperCase();

  return (
    <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[9999] pointer-events-auto">
      {/* Outer container with Pill shape */}
      <div className="relative flex items-center px-4 py-1.5 rounded-full backdrop-blur-sm border border-cyan-400 shadow-[0_0_15px_rgba(34,190,205,0.4),inset_0_0_10px_rgba(34,190,205,0.1)] transition-all duration-300 w-[550px] bg-black/10">
        
        {/* Play/Pause Button */}
        <button 
          onClick={() => handleControl('play-pause')}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-cyan-400 hover:text-cyan-100 transition-colors mr-3 cursor-pointer outline-none drop-shadow-[0_0_5px_#22d3ee]"
        >
          {isPlaying ? (
            <div className="flex gap-1">
              <div className="w-1 h-3 bg-cyan-400 shadow-[0_0_5px_#22d3ee]"></div>
              <div className="w-1 h-3 bg-cyan-400 shadow-[0_0_5px_#22d3ee]"></div>
            </div>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 3l14 9-14 9V3z" />
            </svg>
          )}
        </button>

        {/* Track Text */}
        <div className="flex-shrink-0 text-[10px] font-mono text-cyan-100 tracking-widest truncate">
          TRACK: {trackName} // ARTIST: {artistName}
        </div>

        {/* Visualizer (Middle) */}
        <div className="flex-grow flex justify-center">
          <AudioVisualizer isPlaying={isPlaying} />
        </div>

        {/* Stats (Right) */}
        <div className="flex-shrink-0 text-[10px] font-mono text-cyan-100 tracking-widest text-right">
          65% &nbsp; 02:45 / 04:12
        </div>

        {/* Progress Bar overlapping the bottom border */}
        <div className="absolute -bottom-[1px] left-8 right-16 h-[2px] bg-transparent">
          <div className="h-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] w-[65%]" />
        </div>

      </div>
    </div>
  );
};
