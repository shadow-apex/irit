import { useState, useRef, useEffect } from "react";
import { LayoutGrid, Code, Globe, Terminal, Box, Search, Play, Monitor, FileCode, AppWindow, X } from "lucide-react";
import appsData from "../config/apps.json";

interface AppItem {
  name: string;
  target: string;
  icon?: string | null;
}

function getFallbackIcon(name: string) {
  const n = (name || "").toLowerCase();
  if (n.includes("globe") || n.includes("facebook") || n.includes("chrome") || n.includes("edge") || n.includes("web")) return <Globe size={18} />;
  if (n.includes("code") || n.includes("vscode")) return <Code size={18} />;
  if (n.includes("terminal") || n.includes("cmd") || n.includes("powershell")) return <Terminal size={18} />;
  if (n.includes("play") || n.includes("youtube")) return <Play size={18} />;
  if (n.includes("search")) return <Search size={18} />;
  if (n.includes("monitor")) return <Monitor size={18} />;
  if (n.includes("file")) return <FileCode size={18} />;
  return <AppWindow size={18} />;
}

export default function AppLauncher() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [hoveredApp, setHoveredApp] = useState<AppItem | null>(null);

  useEffect(() => {
    async function loadApps() {
      if (window.iris?.getDesktopApps) {
        const desktopApps = await window.iris.getDesktopApps();
        setApps(desktopApps);
      } else {
        // Fallback for previewing without Electron
        setApps(appsData.map((a) => ({ name: a.name, target: a.target })));
      }
    }
    loadApps();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setHoveredApp(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleLaunch = async (target: string) => {
    if (typeof window.iris?.openApp !== "function") {
      if (/^https?:\/\//i.test(target)) {
        window.open(target, "_blank");
        setOpen(false);
        return;
      }
      alert("Để mở các ứng dụng trên máy tính (Chrome, AutoCAD, Discord...), bạn vui lòng khởi động lại app Irit trên Electron nhé!");
      setOpen(false);
      return;
    }
    const res = await window.iris.openApp(target);
    if (!res.success) {
      alert("Không mở được: " + res.error);
    }
    setOpen(false);
  };

  const handleClose = async (target: string) => {
    if (window.iris?.closeApp) {
      const res = await window.iris.closeApp(target);
      if (!res.success) alert("Không tắt được: " + res.error);
    } else {
      alert("Chưa có khả năng tắt app từ UI");
    }
  };

  return (
    <div className="app-launcher" ref={menuRef} style={{ position: "relative" }}>
      <button
        className={`theme-toggle ${open ? "active" : ""}`}
        onClick={() => {
          setOpen(!open);
          if (open) setHoveredApp(null);
        }}
        title="App Launcher"
      >
        <LayoutGrid size={16} />
      </button>

      {open && (
        <div className="launcher-menu">
          <div className="launcher-header">
            <span>Ứng dụng ({apps.length})</span>
          </div>

          <div className="launcher-grid">
            {apps.map((app) => (
              <div
                key={app.target}
                className="launcher-grid-item"
                onClick={() => handleLaunch(app.target)}
                onMouseEnter={() => setHoveredApp(app)}
                onMouseLeave={() => setHoveredApp((curr) => (curr?.target === app.target ? null : curr))}
                title={app.name}
              >
                {/* Tooltip nổi lên trên icon khi rê chuột */}
                <div className="launcher-tooltip">{app.name}</div>

                {/* Icon ứng dụng thật từ Windows */}
                {app.icon ? (
                  <img src={app.icon} alt={app.name} className="launcher-app-icon" />
                ) : (
                  <div className="launcher-fallback-icon">
                    {getFallbackIcon(app.name)}
                  </div>
                )}

                {/* Nút tắt app (x) hiện ở góc khi rê chuột */}
                <button
                  type="button"
                  className="launcher-item-close"
                  title={`Đóng ${app.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClose(app.target);
                  }}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>

          {apps.length === 0 && (
            <div style={{ padding: "16px 8px", fontSize: "12px", color: "var(--muted)", textAlign: "center" }}>
              Không tìm thấy ứng dụng trên Desktop
            </div>
          )}

          {/* Dòng tên ứng dụng phía dưới khi rê chuột vào */}
          <div className={`launcher-footer ${hoveredApp ? "active" : ""}`}>
            {hoveredApp ? hoveredApp.name : "Rê chuột vào icon để xem tên"}
          </div>
        </div>
      )}
    </div>
  );
}
