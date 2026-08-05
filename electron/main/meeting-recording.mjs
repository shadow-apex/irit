/**
 * electron/main/meeting-recording.mjs
 *
 * Meeting audio recording: writing the mixed system+mic audio to a wav file
 * via the Python sidecar, and the toggle handler wired to the HUD button.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSidecar, stopSidecar, resolvePythonCommand } from "./sidecar-process.mjs";
import { mainWindow, enterHud } from "./window-manager.mjs";
import { repoRoot } from "./paths.mjs";

export function getMeetingRecordingsDir() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const dir = path.join(repoRoot, "meeting_recordings", `${y}-${m}-${d}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Tên file theo giờ:phút:giây để không đè lên các cuộc họp khác trong cùng ngày */
export function buildMeetingWavPath() {
  const dir = getMeetingRecordingsDir();
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return path.join(dir, `meeting_${hh}-${mi}-${ss}.wav`);
}

export let meetingRecorder = null; // handle { proc, state, exitCode }
export let meetingWavPath = null;

export async function toggleMeetingRecording() {
  // Chặn double-hotkey trong lúc đang start hoặc đang stop
  if (meetingRecorder && (meetingRecorder.state === "starting" || meetingRecorder.state === "stopping")) {
    return { status: "error", error: "Đang xử lý, vui lòng đợi." };
  }

  if (!meetingRecorder || meetingRecorder.state === "dead") {
    // Check API key trước khi tốn công ghi âm cả cuộc họp
    if (!process.env.GEMINI_API_KEY) {
      return { status: "error", error: "Thiếu GEMINI_API_KEY, vui lòng cấu hình trước khi ghi âm." };
    }

    const pythonPath = resolvePythonCommand(); // BUGFIX-SIDECAR-PYCMD-01
    const scriptPath = path.join(repoRoot, "sidecar", "meeting_recorder.py");
    meetingWavPath = buildMeetingWavPath();

    meetingRecorder = spawnSidecar(pythonPath, [scriptPath, meetingWavPath], {
      cwd: repoRoot,
      onFatalError: (message) => {
        if (mainWindow) {
          mainWindow.webContents.send("hud:message", { title: "Lỗi ghi âm cuộc họp", content: message });
        }
      },
    });
    meetingRecorder.proc.stdout.on("data", (data) => console.log(`Meeting Recorder: ${data}`));
    meetingRecorder.proc.stderr.on("data", (data) => console.error(`Meeting Recorder Err: ${data}`));

    enterHud();
    if (mainWindow) {
      mainWindow.webContents.send("hud:message", { title: "Meeting Summarizer", content: "Đang ghi âm cuộc họp... (Bấm Alt+M hoặc ra lệnh để kết thúc)" });
    }
    return { status: "success", message: "Bắt đầu ghi âm cuộc họp." };
  }

  // --- Dừng ghi âm ---
  enterHud();
  if (mainWindow) {
    mainWindow.webContents.send("hud:message", { title: "Meeting Summarizer", content: "Đang phân tích âm thanh và tạo tóm tắt... Vui lòng chờ 1-2 phút." });
  }

  await stopSidecar(meetingRecorder, { timeoutMs: 5000 }); // luôn resolve, không treo vô hạn
  meetingRecorder = null;
  const wavPath = meetingWavPath;

  try {
    if (!wavPath || !fs.existsSync(wavPath)) throw new Error("Không tìm thấy file ghi âm.");
    if (!process.env.GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const uploadResult = await ai.files.upload({ file: wavPath, mimeType: "audio/wav" });

    // BUG-MEETING-01 FIX: "gemini-1.5-pro" is a dead model ID — Google has
    // fully shut down all Gemini 1.0/1.5 models, every call to them now
    // returns a 404 ("model not found"). Every summarization request was
    // silently failing and landing in the catch block below as
    // "Lỗi tóm tắt". Use the Google-maintained "gemini-flash-latest" alias
    // instead (currently resolves to gemini-3.5-flash) so this doesn't
    // rot again the next time Google retires a model.
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: [uploadResult, "Đây là file ghi âm cuộc họp. Hãy tóm tắt nội dung chính và trích xuất các Action Items (Công việc cần làm) bằng tiếng Việt. Trình bày bằng định dạng Markdown ngắn gọn và đẹp mắt."]
    });

    const summary = response.text;

    if (mainWindow) {
      mainWindow.webContents.send("hud:message", { title: "Tóm tắt cuộc họp", content: summary });
    }
    return { status: "success", message: `Đã tạo bản tóm tắt cuộc họp thành công. File ghi âm: ${wavPath}` };
  } catch (err) {
    if (mainWindow) {
      mainWindow.webContents.send("hud:message", { title: "Lỗi tóm tắt", content: err.message });
    }
    return { status: "error", error: err.message };
  }
}
