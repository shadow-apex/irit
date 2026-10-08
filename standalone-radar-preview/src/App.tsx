import { useState } from "react"
import SciFiImageRadar from "./SciFiImageRadar"
import "./index.css"

function App() {
  const [phase, setPhase] = useState<"idle" | "reveal" | "done">("idle");

  return (
    <div style={{ width: "100vw", height: "100vh", backgroundColor: "#000", margin: 0, padding: 0, display: "flex", justifyContent: "center", alignItems: "center" }}>
      
      {phase === "idle" && (
        <button 
          onClick={() => setPhase("reveal")} 
          style={{ 
            padding: "15px 30px", 
            fontSize: "1.5rem", 
            cursor: "pointer", 
            background: "transparent", 
            color: "#0ff", 
            border: "2px solid #0ff", 
            borderRadius: "8px",
            fontFamily: "monospace",
            textTransform: "uppercase",
            letterSpacing: "2px",
            animation: "pulse 1.5s infinite"
          }}>
          Click de Khoi dong He thong (Va bat am thanh)
        </button>
      )}

      {phase === "reveal" && (
        <div style={{ position: "fixed", inset: 0 }}>
          <SciFiImageRadar onComplete={() => setPhase("done")} autoStart={true} />
        </div>
      )}

      {phase === "done" && (
        <div style={{ color: "#0ff", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "100%", fontSize: "2rem", fontFamily: "monospace" }}>
          <div>HE THONG DA KICH HOAT</div>
          <br /><br />
          <button onClick={() => setPhase("idle")} style={{ padding: "10px 20px", fontSize: "1rem", cursor: "pointer", background: "#0ff", color: "#000", border: "none", borderRadius: "4px" }}>
            Xem Lai
          </button>
        </div>
      )}
      
      <style>
        {`
          @keyframes pulse { 0%, 100% { opacity: 1; box-shadow: 0 0 10px #0ff; } 50% { opacity: 0.5; box-shadow: none; } }
          body, html { margin: 0; padding: 0; overflow: hidden; background: #000; }
        `}
      </style>
    </div>
  )
}

export default App
