/**
 * electron/main/device-config.mjs
 *
 * Cached readers for robots.json / smart-home-cameras.json config files.
 * Used by the vision loops, the robot/smart-home action tools, and the
 * Claude tool dispatcher.
 */
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";

export let _robotsCache = null;
export let _robotsCacheTime = 0;

export function getRobotsConfig() {
  // Serve from cache if still fresh
  if (_robotsCache && Date.now() - _robotsCacheTime < 5000) return _robotsCache;

  const robotsPath = path.join(repoRoot, "robots.json");
  // BUG-CAM-03 FIX: If robots.json doesn't exist, return empty object instead
  // of silently creating a demo file with a fake IP that always fails to load.
  if (!fs.existsSync(robotsPath)) {
    _robotsCache = {};
    _robotsCacheTime = Date.now();
    return _robotsCache;
  }
  try {
    const data = fs.readFileSync(robotsPath, "utf8");
    const parsed = JSON.parse(data);
    _robotsCache = parsed.robots || {};
    _robotsCacheTime = Date.now();
    return _robotsCache;
  } catch (err) {
    console.error("Failed to parse robots.json:", err);
    _robotsCache = {};
    _robotsCacheTime = Date.now();
    return _robotsCache;
  }
}

export let _smartHomeCamerasCache = null;
export let _smartHomeCamerasCacheTime = 0;

export function getSmartHomeCamerasConfig() {
  if (_smartHomeCamerasCache && Date.now() - _smartHomeCamerasCacheTime < 5000) {
    return _smartHomeCamerasCache;
  }
  const configPath = path.join(repoRoot, "smarthome_cameras.json");
  if (!fs.existsSync(configPath)) {
    _smartHomeCamerasCache = {};
    _smartHomeCamerasCacheTime = Date.now();
    return _smartHomeCamerasCache;
  }
  try {
    const data = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(data);
    _smartHomeCamerasCache = parsed.cameras || {};
    _smartHomeCamerasCacheTime = Date.now();
    return _smartHomeCamerasCache;
  } catch (err) {
    console.error("Failed to parse smarthome_cameras.json:", err);
    _smartHomeCamerasCache = {};
    _smartHomeCamerasCacheTime = Date.now();
    return _smartHomeCamerasCache;
  }
}
