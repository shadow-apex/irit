import React from "react";

export default function HudTopNotch() {
  return (
    <div className="hud-top-notch-container" aria-hidden="true">
      <style>{`
        .hud-top-notch-container {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 48px;
          pointer-events: none;
          z-index: 10;
          overflow: visible;
          user-select: none;
          background: linear-gradient(to bottom, rgba(0, 140, 255, 0.18) 0%, rgba(0, 80, 200, 0.05) 24px, transparent 48px);
          animation: hud-notch-fade-in 0.35s ease-out forwards;
        }

        @keyframes hud-notch-fade-in {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* Top horizontal glowing neon bar */
        .hud-notch-top-bar {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: #00d2ff;
          box-shadow: 0 0 10px #00d2ff, 0 0 22px rgba(0, 150, 255, 0.85);
        }

        /* Center Notch Bracket */
        .hud-notch-svg-wrap {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 520px;
          height: 30px;
          display: flex;
          justify-content: center;
        }
      `}</style>

      {/* Top glowing neon line across full screen */}
      <div className="hud-notch-top-bar" />

      {/* Center Sci-Fi Trapezoid Notch Bracket */}
      <div className="hud-notch-svg-wrap">
        <svg width="520" height="30" viewBox="0 0 520 30" fill="none">
          <defs>
            <filter id="sci-fi-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#00d2ff" floodOpacity="0.95" />
              <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor="#0066ff" floodOpacity="0.6" />
            </filter>
          </defs>

          {/* Top continuous neon segment aligning with top bar */}
          <line x1="0" y1="2" x2="520" y2="2" stroke="#00d2ff" strokeWidth="2" filter="url(#sci-fi-glow)" />

          {/* Center hanging trapezoid notch bracket matching the photo */}
          <path
            d="M 50 2 L 78 18 L 442 18 L 470 2"
            stroke="#00ffff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#sci-fi-glow)"
          />

          {/* Subtle inner accent line */}
          <line
            x1="100"
            y1="22"
            x2="420"
            y2="22"
            stroke="#00d2ff"
            strokeWidth="1.2"
            opacity="0.5"
          />
        </svg>
      </div>
    </div>
  );
}
