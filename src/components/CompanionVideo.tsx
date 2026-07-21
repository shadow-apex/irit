import { useEffect, useState } from "react";
import DraggablePiP from "./DraggablePiP";
import { Smartphone } from "lucide-react";

export default function CompanionVideo({ onClose }: { onClose: () => void }) {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!window.iris?.onCompanionFrame) return;
    
    // Listen for frames coming from the backend companion server
    const cleanup = window.iris.onCompanionFrame((base64Jpeg) => {
      setFrameUrl(`data:image/jpeg;base64,${base64Jpeg}`);
    });
    
    return cleanup;
  }, []);

  useEffect(() => {
    let intervalId: number;
    if (!tunnelUrl && !frameUrl) {
      intervalId = window.setInterval(async () => {
        try {
          if (window.iris?.getCompanionTunnel) {
            const url = await window.iris.getCompanionTunnel();
            if (url) {
              setTunnelUrl(url);
              window.clearInterval(intervalId);
            }
          }
        } catch (e) {}
      }, 2000);
    }
    return () => window.clearInterval(intervalId);
  }, [tunnelUrl, frameUrl]);

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
        ) : tunnelUrl ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 10 }}>
            <img 
              src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(tunnelUrl)}`} 
              alt="QR Code" 
              style={{ width: 150, height: 150, backgroundColor: "white", padding: 5, borderRadius: 5 }} 
            />
            <div style={{ color: "#666", fontSize: 13, textAlign: "center", marginTop: 10 }}>
              Scan with Expo Go to connect<br />
              <span style={{ fontSize: 10, color: "#444" }}>{tunnelUrl}</span>
            </div>
          </div>
        ) : (
          <div style={{ color: "#666", fontSize: 13, textAlign: "center", padding: 20 }}>
            Waiting for ngrok tunnel...<br />
            (Ensure Iris Companion is starting)
          </div>
        )}
      </div>
    </DraggablePiP>
  );
}
