/**
 * electron/main/capabilities.mjs
 *
 * Singleton instances of the "ported capability" MCP-style tools (canvas,
 * second brain). Constructed once at startup with their Electron/state
 * dependencies injected, then shared by claude-runner.mjs (DEV runs) and
 * gemini-live.mjs (Live session tool config).
 */
import path from "node:path";
import os from "node:os";
import electron from "electron";
const { dialog } = electron;
import { createCanvasCapability } from "../capabilities/canvas.mjs";
import { createSecondBrainCapability } from "../capabilities/second-brain.mjs";
import { getMainWindow } from "./window-manager.mjs";
import { getPipelineAvailable } from "./claude-cli.mjs";
import { userDisplayName } from "./session-store.mjs";
import { emitEvent, emitToRenderer } from "./events.mjs";
import { skillsSourceDir } from "./agents-install.mjs";

export const CANVAS_STORE_FILE = path.join(os.homedir(), ".iris", "canvas.json");
export const canvasCapability = createCanvasCapability({
  canvasStoreFile: CANVAS_STORE_FILE,
  emitToRenderer,
  emitEvent,
  getMainWindow,
  getPipelineAvailable,
  userDisplayName,
  dialog,
});
export const secondBrainCapability = createSecondBrainCapability({
  emitEvent,
  emitToRenderer,
  skillsSourceDir,
  userDisplayName,
  getPipelineAvailable,
});
