/**
 * electron/main/app-launcher.mjs
 *
 * S-03: logic an toàn cho IPC app:open / app:close.
 *
 * Trước đây renderer gửi chuỗi bất kỳ và main chạy `spawn(target, {shell:true})` /
 * `exec("taskkill /F /IM \"<target>\"")` => thực thi lệnh tuỳ ý, hoặc diệt tiến trình
 * hệ thống, nếu renderer bị chèn mã. Nay:
 *   * mở: chỉ URL http(s), hoặc file .lnk/.url/.exe NẰM TRONG thư mục Desktop
 *     (đúng tập mà IPC `desktop:apps` liệt kê), qua shell.openPath — KHÔNG spawn shell;
 *   * đóng: chỉ app thuộc danh sách Desktop, tên tiến trình khớp whitelist ký tự, không
 *     thuộc nhóm tiến trình hệ thống, gọi `taskkill` bằng execFile (không qua shell).
 *
 * Module thuần node: electron (shell) được truyền vào qua tham số.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

export const ALLOWED_APP_EXT = new Set([".lnk", ".url", ".exe"]);

const PROTECTED_PROCESSES = new Set([
  "system", "registry", "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe", "services.exe",
  "lsass.exe", "svchost.exe", "dwm.exe", "explorer.exe", "fontdrvhost.exe", "sihost.exe",
  "taskhostw.exe", "ctfmon.exe", "searchhost.exe", "startmenuexperiencehost.exe",
  "shellexperiencehost.exe", "runtimebroker.exe", "audiodg.exe", "spoolsv.exe", "msmpeng.exe",
  "securityhealthservice.exe", "taskmgr.exe", "cmd.exe", "powershell.exe", "pwsh.exe",
  "wt.exe", "conhost.exe", "mmc.exe", "regedit.exe",
]);

/** URL được phép mở: http, https, vscode (đúng đặc tả S-03); các scheme khác bị từ chối. */
export function isSafeExternalUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "vscode:";
  } catch {
    return false;
  }
}

function isInside(dir, file) {
  const rel = path.relative(dir, file);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Kiểm tra `target` là file .lnk/.url/.exe nằm trực tiếp/lồng trong Desktop.
 * @returns {{ok:true, path:string}|{ok:false, error:string}}
 */
export function resolveDesktopTarget(target, desktopDir) {
  if (typeof target !== "string" || !target.trim() || target.length > 1024 || target.includes("\0")) {
    return { ok: false, error: "Đường dẫn không hợp lệ" };
  }
  if (!desktopDir) return { ok: false, error: "Không xác định được thư mục Desktop" };
  const ext = path.extname(target).toLowerCase();
  if (!ALLOWED_APP_EXT.has(ext)) return { ok: false, error: "Loại file không được phép" };
  let resolved = path.resolve(target);
  let root = path.resolve(desktopDir);
  try {
    resolved = fs.realpathSync(resolved);
    root = fs.realpathSync(root);
  } catch {
    return { ok: false, error: "Ứng dụng không tồn tại trên Desktop" };
  }
  const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  if (!isInside(norm(root), norm(resolved))) {
    return { ok: false, error: "Chỉ được mở/đóng ứng dụng nằm trên Desktop" };
  }
  return { ok: true, path: resolved };
}

/** Tên tiến trình (.exe) suy ra từ file shortcut; null nếu không an toàn. */
export function processNameFor(targetPath) {
  const base = path.basename(String(targetPath || ""));
  const name = base.replace(/\.(lnk|url)$/i, ".exe");
  const final = /\.exe$/i.test(name) ? name : `${name}.exe`;
  if (!/^[\p{L}\p{N} ._()+-]{1,64}\.exe$/u.test(final)) return null;
  if (final.includes("..")) return null;
  return final;
}

export function isProtectedProcess(name) {
  return PROTECTED_PROCESSES.has(String(name || "").toLowerCase());
}

/** @param {{desktopDir:string, openExternal:(u:string)=>Promise<void>, openPath:(p:string)=>Promise<string>}} deps */
export async function openAppTarget(target, deps) {
  try {
    if (typeof target === "string" && /^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) {
      if (!isSafeExternalUrl(target)) return { success: false, error: "Chỉ cho phép URL http/https/vscode" };
      await deps.openExternal(target);
      return { success: true };
    }
    const r = resolveDesktopTarget(target, deps.desktopDir);
    if (!r.ok) return { success: false, error: r.error };
    const err = await deps.openPath(r.path);
    return err ? { success: false, error: err } : { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

/** @param {{desktopDir:string, run?:(file:string,args:string[])=>Promise<void>}} deps */
export async function closeAppTarget(target, deps) {
  try {
    if (process.platform !== "win32" && !deps.run) return { success: false, error: "Chỉ hỗ trợ Windows" };
    const r = resolveDesktopTarget(target, deps.desktopDir);
    if (!r.ok) return { success: false, error: r.error };
    const procName = processNameFor(r.path);
    if (!procName) return { success: false, error: "Tên tiến trình không hợp lệ" };
    if (isProtectedProcess(procName)) return { success: false, error: "Không được đóng tiến trình hệ thống" };
    const run =
      deps.run ||
      ((file, args) =>
        new Promise((resolve, reject) =>
          execFile(file, args, { windowsHide: true }, (err) => (err ? reject(err) : resolve())),
        ));
    await run("taskkill", ["/F", "/IM", procName]);
    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}
