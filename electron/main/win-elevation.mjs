/**
 * electron/main/win-elevation.mjs — Windows-only admin elevation.
 *
 * tools/system_actions.py (minimize_app / restore_app / close_app) drives
 * *other* processes' windows via user32 EnumWindows + ShowWindowAsync /
 * PostMessage / taskkill. Windows' UIPI (User Interface Privilege
 * Isolation) silently blocks those calls whenever the target window
 * belongs to a higher-integrity (elevated / "Run as administrator")
 * process — Iris just reports "no window found" instead of a real error.
 *
 * Fix: if Iris itself isn't running elevated, ask Windows for elevation via
 * the normal UAC consent dialog and relaunch. This is the standard OS
 * elevation prompt the user sees and approves every time — not a silent
 * bypass — mirrored by build.win.requestedExecutionLevel in package.json
 * for packaged builds (so the shield icon shows immediately on the .exe).
 */
import { execFileSync, spawn } from "node:child_process";
import electron from "electron";
const { app } = electron;

/** True on non-Windows (n/a) or when the current process is elevated. */
export function isWindowsElevated() {
  if (process.platform !== "win32") return true;
  try {
    // `net session` only succeeds for an elevated process (non-admin gets
    // "Access is denied", exit code 2). It's a pure permission probe — no
    // session is created or torn down either way.
    execFileSync("net", ["session"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * If not elevated, relaunches Iris via the native UAC prompt and quits this
 * instance. Returns true when a relaunch was kicked off (caller should stop
 * startup right away and let the elevated instance take over).
 */
export function relaunchElevatedIfNeeded() {
  if (process.platform !== "win32") return false;
  if (process.env.IRIS_SKIP_ELEVATE === "1") return false; // escape hatch for dev/CI
  if (isWindowsElevated()) return false;

  const exePath = process.execPath;
  // Packaged: argv = [exePath, ...appArgs]. Dev (electron .): argv =
  // [electronPath, projectPath, ...appArgs] — drop the extra entry.
  const appArgs = process.argv.slice(app.isPackaged ? 1 : 2);
  const quotedArgs = appArgs.map((a) => `'${String(a).replace(/'/g, "''")}'`);
  const psCommand = `Start-Process -FilePath '${exePath}'` +
    (quotedArgs.length ? ` -ArgumentList ${quotedArgs.join(",")}` : "") +
    " -Verb RunAs";

  try {
    spawn("powershell.exe", ["-NoProfile", "-Command", psCommand], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } catch (err) {
    console.error("[win-elevation] Failed to request elevation:", err);
    return false; // fall through and keep running un-elevated rather than getting stuck
  }

  app.quit();
  return true;
}
