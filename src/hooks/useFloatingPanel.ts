import { useCallback, useRef, useState } from "react";

// Makes a HUD panel (drawing canvas, second-brain galaxy) freely draggable by
// its header and resizable from its bottom-right corner, like a floating
// window. Position/size are plain React state (not persisted across HUD
// toggles or restarts) — reopening a panel resets it to `initial`, which
// mirrors the previous fixed-layout behavior as the starting point.

export interface FloatingPanelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 220;
// Keep at least this many px of the panel on-screen so a panel dragged
// off-screen (e.g. toward a second monitor that isn't there) never becomes
// unreachable — there's no "reset position" control, so this is the only
// guard against losing the panel entirely.
const EDGE_MARGIN = 24;

function clampRect(rect: FloatingPanelRect): FloatingPanelRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(rect.width, MIN_WIDTH), vw - EDGE_MARGIN);
  const height = Math.min(Math.max(rect.height, MIN_HEIGHT), vh - EDGE_MARGIN);
  const left = Math.min(Math.max(rect.left, EDGE_MARGIN - width), vw - EDGE_MARGIN);
  const top = Math.min(Math.max(rect.top, EDGE_MARGIN - height), vh - EDGE_MARGIN);
  return { left, top, width, height };
}

export function useFloatingPanel(initial: FloatingPanelRect) {
  const [rect, setRect] = useState<FloatingPanelRect>(() => clampRect(initial));
  // Drag/resize read the live rect via a ref (not `rect` from closure) so a
  // fast pointermove burst never applies against a stale value between
  // renders.
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const startDrag = useCallback((event: React.PointerEvent) => {
    // Ignore clicks on interactive controls inside the header (e.g. the
    // close button) — only the bare header background starts a drag.
    if ((event.target as HTMLElement).closest("[data-panel-no-drag]")) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = rectRef.current;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(pointerId);

    function onMove(moveEvent: PointerEvent) {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setRect(clampRect({ ...startRect, left: startRect.left + dx, top: startRect.top + dy }));
    }
    function onUp() {
      target.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const startResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = rectRef.current;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(pointerId);

    function onMove(moveEvent: PointerEvent) {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setRect(clampRect({ ...startRect, width: startRect.width + dx, height: startRect.height + dy }));
    }
    function onUp() {
      target.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  return { rect, startDrag, startResize };
}
