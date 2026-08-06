import { useState, useRef, useEffect } from "react";
import { LayoutGrid, Code, Globe, Terminal, Box, Search, Play, Monitor, FileCode, AppWindow } from "lucide-react";
import appsData from "../config/apps.json";

// Lấy icon từ string name
function getIcon(name: string) {
  switch (name) {
    case "Globe": return <Globe size={16} />;
    case "Code": return <Code size={16} />;
    case "Terminal": return <Terminal size={16} />;
    case "Search": return <Search size={16} />;
    case "Play": return <Play size={16} />;
    case "Monitor": return <Monitor size={16} />;
    case "FileCode": return <FileCode size={16} />;
    case "AppWindow": return <AppWindow size={16} />;
    case "Youtube": return <Play size={16} />; // Fallback to Play since Youtube icon is missing
    default: return <Box size={16} />;
  }
}

export default function AppLauncher() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [apps, setApps] = useState<{name: string, target: string}[]>([]);

  useEffect(() => {
    async function loadApps() {
      if (window.iris?.getDesktopApps) {
        const desktopApps = await window.iris.getDesktopApps();
        setApps(desktopApps);
      } else {
        // Fallback for when running without Electron or not restarted yet
        setApps(appsData.map(a => ({ name: a.name, target: a.target })));
      }
    }
    loadApps();
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleLaunch = async (target: string) => {
    if (typeof window.iris?.openApp !== "function") {
      alert("Lỗi: Nút chưa được kết nối với hệ thống. Bạn nhớ ra Terminal bấm Ctrl+C để tắt hẳn app, sau đó gõ lại 'npm run dev' nhé!");
      setOpen(false);
      return;
    }
    const res = await window.iris.openApp(target);
    if (!res.success) {
      alert("Không mở được: " + res.error);
    }
    setOpen(false);
  };

  return (
    <div className="app-launcher" ref={menuRef} style={{ position: "relative" }}>
      <button
        className={`theme-toggle ${open ? "active" : ""}`}
        onClick={() => setOpen(!open)}
        title="App Launcher"
      >
        <LayoutGrid size={16} />
      </button>

      {open && (
        <div className="launcher-menu">
          {apps.map((app) => (
            <button key={app.target} className="launcher-item" onClick={() => handleLaunch(app.target)}>
              <AppWindow size={16} />
              <span>{app.name}</span>
            </button>
          ))}
          {apps.length === 0 && (
            <div style={{ padding: "8px", fontSize: "12px", color: "var(--muted)" }}>
              Trống (không có app nào)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
