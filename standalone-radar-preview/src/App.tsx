import { useState } from "react"
import SciFiScanReveal from "./SciFiScanReveal"
import trangChuImg from "./trang_chu.png"
import "./index.css"

function App() {
  const [phase, setPhase] = useState<"idle" | "reveal" | "done">("idle");

  return (
    <div style={{ width: "100vw", height: "100vh", backgroundColor: "#000", margin: 0, padding: 0, position: "relative", overflow: "hidden" }}>
      
      {phase === "idle" && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", width: "100%", height: "100%" }}>
          <button 
            onClick={() => setPhase("reveal")} 
            style={{ 
              padding: "16px 36px", 
              fontSize: "1.4rem", 
              cursor: "pointer", 
              background: "rgba(0, 255, 255, 0.08)", 
              color: "#3EE8FF", 
              border: "2px solid #3EE8FF", 
              borderRadius: "8px",
              fontFamily: "monospace",
              textTransform: "uppercase",
              letterSpacing: "2px",
              boxShadow: "0 0 20px rgba(62, 232, 255, 0.4)",
              transition: "all 0.3s ease"
            }}>
            Click để Khởi động Hệ thống (Có Âm thanh & Cánh Cửa)
          </button>
        </div>
      )}

      {phase === "reveal" && (
        <div style={{ position: "fixed", inset: 0 }}>
          <SciFiScanReveal 
            autoStart={true} 
            speed={1} 
            onComplete={() => setPhase("done")} 
          />
        </div>
      )}

      {phase === "done" && (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          <img 
            src={trangChuImg} 
            alt="Trang Chu I.R.I.S" 
            style={{ width: "100%", height: "100%", objectFit: "cover" }} 
          />
          <button 
            onClick={() => setPhase("idle")} 
            style={{ 
              position: "absolute", 
              bottom: "30px", 
              left: "50%", 
              transform: "translateX(-50%)", 
              padding: "10px 24px", 
              fontSize: "0.95rem", 
              cursor: "pointer", 
              background: "rgba(10, 20, 30, 0.85)", 
              color: "#3EE8FF", 
              border: "1px solid #3EE8FF", 
              borderRadius: "6px",
              fontFamily: "monospace",
              boxShadow: "0 0 15px rgba(62, 232, 255, 0.3)"
            }}>
            Xem Lại Khởi Động
          </button>
        </div>
      )}
      
      <style>
        {`
          body, html { margin: 0; padding: 0; overflow: hidden; background: #000; }
        `}
      </style>
    </div>
  )
}

export default App
