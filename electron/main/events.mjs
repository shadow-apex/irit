/**
 * electron/main/events.mjs
 *
 * Tiny shared utility for pushing events to the renderer. Split out of the
 * former monolithic electron/main.mjs (see CLAUDE.md). Imports `mainWindow`
 * from window-manager.mjs, which itself imports emitToRenderer from here —
 * a deliberate circular import that's safe because neither side touches the
 * other's binding at module-evaluation time, only inside function bodies.
 */
import { mainWindow } from "./window-manager.mjs";

export function emitToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

export function emitEvent(event) {
  // DIAGNOSTIC: surface all events to the dev terminal (the renderer's log
  // list is not rendered, so fatal/connection errors were otherwise invisible).
  if (event?.type === "fatal") {
    console.error("[IRIS][fatal]", event.message || "", event.error || "");
  } else if (event?.type === "gemini_status" || event?.type === "sidecar_status") {
    console.log(`[IRIS][${event.type}]`, JSON.stringify(event.status ?? event));
  }
  emitToRenderer("sidecar:event", { timestamp: Date.now() / 1000, ...event });
}
