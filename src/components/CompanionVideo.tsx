import { useEffect, useState } from "react";
import DraggablePiP from "./DraggablePiP";
import { Smartphone } from "lucide-react";

export default function CompanionVideo({ onClose }: { onClose: () => void }) {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!window.iris?.onCompanionFrame) return;
    
    // Listen for frames coming from the backend companion server
    const cleanup = window.iris.onCompanionFrame((base64Jpeg) => {
      setFrameUrl(`data:image/jpeg;base64,${base64Jpeg}`);
    });
    
    return cleanup;
  }, []);

  return (
    <DraggablePiP
      title={
        <>
          <Smartphone size={16} style={{ color: "rgb(40, 205, 170)" }} />
          Companion Camera
        </>
      }
      onClose={onClose}
      defaultPosition={{ x: window.innerWidth - 340, y: 80 }} // Top right corner default
      defaultSize={{ width: 320, height: 240 }}
    >
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#000" }}>
        {frameUrl ? (
          <img 
            src={frameUrl} 
            alt="Companion Stream" 
            style={{ width: "100%", height: "100%", objectFit: "contain" }} 
          />
        ) : (
          <div style={{ color: "#666", fontSize: 13, textAlign: "center", padding: 20 }}>
            Waiting for Companion App to connect...<br />
            (Scan QR Code to start streaming)
          </div>
        )}
      </div>
    </DraggablePiP>
  );
}
