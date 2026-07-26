import React, { useState, useRef, useEffect } from "react";
import { X, Maximize2, Minimize2 } from "lucide-react";

interface DraggablePiPProps {
  title: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  defaultPosition?: { x: number; y: number };
  defaultSize?: { width: number; height: number };
}

let globalZIndex = 500;

export default function DraggablePiP({
  title,
  children,
  onClose,
  defaultPosition = { x: 20, y: 20 },
  defaultSize = { width: 320, height: 240 },
}: DraggablePiPProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [position, setPosition] = useState(defaultPosition);
  const [savedPosition, setSavedPosition] = useState(defaultPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [localZIndex, setLocalZIndex] = useState(() => ++globalZIndex);
  
  const dragStartRef = useRef({ x: 0, y: 0, initialX: 0, initialY: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    // Bring to front khi click vào bất cứ đâu trên cửa sổ (kể cả viền)
    setLocalZIndex(++globalZIndex);

    // Nếu bấm vào nút thì không drag
    if ((e.target as HTMLElement).closest("button")) return;

    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      initialX: position.x,
      initialY: position.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPosition({
        x: dragStartRef.current.initialX + dx,
        y: dragStartRef.current.initialY + dy,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const style: React.CSSProperties = isExpanded
    ? {
        position: "fixed",
        top: position.y,
        left: position.x,
        width: "80vw",
        height: "80vh",
        maxWidth: 1000,
        maxHeight: 800,
        // Theater mode: z-index cao để hiện lên trên tất cả khi phóng to
        zIndex: 9999,
      }
    : {
        position: "fixed",
        top: position.y,
        left: position.x,
        width: defaultSize.width,
        height: defaultSize.height,
        // PiP mode: sử dụng localZIndex để cửa sổ được click sẽ nổi lên trên
        zIndex: localZIndex,
      };

  return (
    <div
      className="hud-hit pip-slide-in"
      style={{
        ...style,
        backgroundColor: "#111",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: "1px solid #333",
        boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
        transition: isDragging ? "none" : "all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)",
        pointerEvents: "auto",
      }}
    >
      {/* Header bar */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #222",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: "#181818",
          cursor: isExpanded ? "default" : (isDragging ? "grabbing" : "grab"),
          userSelect: "none",
        }}
      >
        <div style={{ margin: 0, fontSize: 14, display: "flex", alignItems: "center", gap: 8, color: "#eee", fontWeight: 600 }}>
          {title}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="t-btn small"
            onClick={(e) => {
              e.stopPropagation();
              if (!isExpanded) {
                setSavedPosition(position);
                const targetW = Math.min(window.innerWidth * 0.8, 1000);
                const targetH = Math.min(window.innerHeight * 0.8, 800);
                setPosition({
                  x: (window.innerWidth - targetW) / 2,
                  y: (window.innerHeight - targetH) / 2,
                });
              } else {
                setPosition(savedPosition);
              }
              setIsExpanded(!isExpanded);
            }}
            title={isExpanded ? "Thu nhỏ (Mini Player)" : "Phóng to (Theater Mode)"}
            style={{ padding: 4, background: "transparent", border: "none", color: "#aaa", cursor: "pointer" }}
          >
            {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            className="t-btn small"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="Đóng (X)"
            style={{ padding: 4, background: "transparent", border: "none", color: "#aaa", cursor: "pointer" }}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      
      {/* Content body */}
      <div style={{ flex: 1, position: "relative", backgroundColor: "#000", overflow: "auto" }}>
        {children}
      </div>
    </div>
  );
}
