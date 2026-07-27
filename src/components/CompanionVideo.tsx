import { useEffect, useState } from "react";
import DraggablePiP from "./DraggablePiP";
import { Smartphone } from "lucide-react";

const OBS_SOURCE_URL = "http://localhost:8080/source.html";

function obsSourceUrlWithToken(token: string | null): string {
  if (!token) return OBS_SOURCE_URL;
  return `${OBS_SOURCE_URL}?t=${encodeURIComponent(token)}`;
}

function extractToken(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("t");
  } catch {
    return null;
  }
}

export default function CompanionVideo({ onClose }: { onClose: () => void }) {
  const [phoneUrl, setPhoneUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let hasUrlOnce = false;

    const poll = async () => {
      if (cancelled || !window.iris?.getPhoneCamUrl) return;
      try {
        const url = await window.iris.getPhoneCamUrl();
        if (!cancelled && url) {
          setPhoneUrl(url);
          hasUrlOnce = true;
        }
      } catch (e) {
      }
      if (!cancelled) timer = window.setTimeout(poll, hasUrlOnce ? 5000 : 2000);
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
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
      defaultPosition={{ x: window.innerWidth - 360, y: 80 }}
      defaultSize={{ width: 340, height: 240 }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: "#000",
        }}
      >
        <iframe
          src={obsSourceUrlWithToken(extractToken(phoneUrl))}
          title="OBS Source Preview"
          style={{ width: "100%", height: "100%", border: "none" }}
          allow="autoplay"
        />
      </div>
    </DraggablePiP>
  );
}
