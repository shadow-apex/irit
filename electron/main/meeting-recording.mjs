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
import { userDataDir, unpackedRepoRoot } from "./paths.mjs";
import { emitEvent } from "./events.mjs";
import { getAllGeminiKeys, getGenAiClient, withGeminiFailover, isRateLimitError } from "./gemini-keys.mjs";
import { quickReminderTool } from "./local-tools.mjs";

// Đọc env LÚC GỌI (không ở cấp module — P-03): .env/Settings có thể nạp/đổi model sau khi module được import.
const getMeetingCandidateModels = () => Array.from(
  new Set(
    [
      String(process.env.GEMINI_SUMMARY_MODEL || "").trim(),
      String(process.env.GEMINI_TRANSCRIBE_MODEL || "").trim(),
      "gemini-2.0-flash",
      "gemini-flash-latest",
      "gemini-flash-lite-latest",
      "gemini-2.5-flash",
    ].filter(Boolean)
  )
);

async function generateMeetingContent(client, payload) {
  let lastErr = null;
  for (const m of getMeetingCandidateModels()) {
    try {
      return await client.models.generateContent({
        ...payload,
        model: m,
      });
    } catch (err) {
      lastErr = err;
      if (isRateLimitError(err)) {
        // Thử model tiếp theo trong danh sách candidate trước khi chuyển sang key khác
        continue;
      }
      const errMsg = String(err?.message || "");
      const errStatus = err?.status ?? err?.code ?? err?.httpStatus;
      if (
        errStatus === 404 ||
        errStatus === 400 ||
        /no longer available|not found|404|NOT_FOUND|deprecated|is not supported|invalid argument/i.test(errMsg)
      ) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("Không thể gọi model Gemini cho cuộc họp.");
}

// Thời lượng tối đa mỗi phân đoạn WAV gửi lên Gemini (25 phút ~ 48,000 audio tokens,
// dưới xa trần 250k TPM của Gemini Free Tier và vừa khít giới hạn 8192 output tokens/lần gọi).
const MAX_AUDIO_CHUNK_SECONDS = 25 * 60;
const WAV_HEADER_BYTES = 44;
// Ngưỡng độ dài transcript (ký tự) trước khi kích hoạt tóm tắt phân tầng (Map-Reduce)
const MAX_DIRECT_TRANSCRIPT_CHARS = 120_000;

export function getMeetingRecordingsDir() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const dir = path.join(userDataDir(), "meeting_recordings", `${y}-${m}-${d}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Mỗi phiên làm việc (cuộc họp) được tạo một thư mục riêng biệt:
 * meeting_recordings/YYYY-MM-DD/meeting_HH-MM-SS/
 * File âm thanh, transcript và summary của phiên này sẽ nằm gọn bên trong thư mục này.
 */
export function buildMeetingWavPath() {
  const dayDir = getMeetingRecordingsDir();
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const sessionDir = path.join(dayDir, `meeting_${hh}-${mi}-${ss}`);
  fs.mkdirSync(sessionDir, { recursive: true });
  return path.join(sessionDir, `meeting_${hh}-${mi}-${ss}.wav`);
}

export let meetingRecorder = null; // handle { proc, state, exitCode }
export let meetingWavPath = null;
export let isSummarizing = false;
export let isToggling = false;
export let meetingStatusText = "";
export let meetingRecordingStartTime = null;

function sendHudStatus(title, content) {
  meetingStatusText = content;
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents?.isDestroyed?.()) {
    mainWindow.webContents.send("hud:message", { title, content });
  }
}

export function getMeetingState() {
  const isRecording = Boolean(meetingRecorder && meetingRecorder.state !== "dead");
  const startTime = isRecording ? meetingRecordingStartTime : null;
  const elapsedSeconds = isRecording && startTime ? Math.max(0, Math.floor((Date.now() - startTime) / 1000)) : 0;
  return {
    isRecording,
    isSummarizing,
    statusText: meetingStatusText,
    startTime,
    elapsedSeconds,
  };
}

/**
 * Tự động kiểm tra và vá lại 44-byte WAV header nếu sidecar từng bị force-kill
 * (SIGKILL) trước khi kịp gọi wav_writer.close().
 */
export function repairWavHeaderIfNeeded(wavPath) {
  const stat = fs.statSync(wavPath);
  if (stat.size <= WAV_HEADER_BYTES) return;
  const fd = fs.openSync(wavPath, "r+");
  try {
    const header = Buffer.alloc(WAV_HEADER_BYTES);
    fs.readSync(fd, header, 0, WAV_HEADER_BYTES, 0);
    const isRiff = header.toString("ascii", 0, 4) === "RIFF";
    const isWave = header.toString("ascii", 8, 12) === "WAVE";
    if (!isRiff || !isWave) return;

    const expectedRiffSize = Math.min(0xffffffff, stat.size - 8);
    const expectedDataSize = Math.min(0xffffffff, stat.size - WAV_HEADER_BYTES);
    const recordedRiffSize = header.readUInt32LE(4);
    const recordedDataSize = header.readUInt32LE(40);

    if (recordedRiffSize !== expectedRiffSize || recordedDataSize !== expectedDataSize) {
      header.writeUInt32LE(expectedRiffSize, 4);
      header.writeUInt32LE(expectedDataSize, 40);
      fs.writeSync(fd, header, 0, WAV_HEADER_BYTES, 0);
      console.warn(`[MeetingRecorder] Đã tự động phục hồi WAV header cho ${wavPath} (dataSize=${expectedDataSize})`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function formatMMSS(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Chia file WAV lớn (2-3 tiếng, 400MB-700MB) thành các file WAV nhỏ theo stream
 * (không nạp toàn bộ vào RAM) nếu thời lượng vượt quá maxChunkSeconds.
 */
async function splitWavIntoChunks(wavPath, maxChunkSeconds = MAX_AUDIO_CHUNK_SECONDS) {
  const stat = fs.statSync(wavPath);
  const fd = fs.openSync(wavPath, "r");
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  try {
    fs.readSync(fd, header, 0, WAV_HEADER_BYTES, 0);
  } finally {
    fs.closeSync(fd);
  }

  const channels = header.readUInt16LE(22) || 2;
  const sampleRate = header.readUInt32LE(24) || 16000;
  const bitsPerSample = header.readUInt16LE(34) || 16;
  const blockAlign = Math.max(1, channels * (bitsPerSample >> 3));
  const byteRate = sampleRate * blockAlign;
  const totalDataBytes = Math.max(0, stat.size - WAV_HEADER_BYTES);
  const totalSeconds = totalDataBytes / byteRate;

  if (totalSeconds <= maxChunkSeconds + 30) {
    return [{ path: wavPath, isTemp: false, startSec: 0, endSec: Math.round(totalSeconds) }];
  }

  const rawChunkBytes = maxChunkSeconds * byteRate;
  const alignedChunkBytes = Math.floor(rawChunkBytes / blockAlign) * blockAlign;
  const chunks = [];
  let offset = 0;
  let index = 0;

  while (offset < totalDataBytes) {
    const sliceBytes = Math.min(alignedChunkBytes, totalDataBytes - offset);
    const startSec = Math.round(offset / byteRate);
    const endSec = Math.round((offset + sliceBytes) / byteRate);
    const chunkPath = wavPath.replace(/\.wav$/i, `_part${String(index + 1).padStart(2, "0")}.wav`);

    const chunkHeader = Buffer.from(header);
    chunkHeader.writeUInt32LE(sliceBytes + 36, 4);
    chunkHeader.writeUInt32LE(sliceBytes, 40);
    fs.writeFileSync(chunkPath, chunkHeader);

    await new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(wavPath, {
        start: WAV_HEADER_BYTES + offset,
        end: WAV_HEADER_BYTES + offset + sliceBytes - 1,
      });
      const writeStream = fs.createWriteStream(chunkPath, { flags: "a" });
      readStream.on("error", reject);
      writeStream.on("error", reject);
      writeStream.on("finish", resolve);
      readStream.pipe(writeStream);
    });

    chunks.push({ path: chunkPath, isTemp: true, startSec, endSec });
    offset += sliceBytes;
    index += 1;
  }

  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(err, attempt) {
  const msg = String(err?.message || err || "");
  const matchSec = msg.match(/retry in\s+([0-9.]+)\s*s/i) || msg.match(/retryDelay["':\s]+([0-9.]+)s/i);
  if (matchSec) {
    return Math.ceil(Number(matchSec[1]) * 1000) + 2000;
  }
  const isRateLimit = err?.status === 429 || /429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg);
  if (isRateLimit) {
    // Gemini Free Tier reset cửa sổ TPM theo từng phút -> chờ 35s - 65s
    return Math.min(70_000, 35_000 + attempt * 15_000);
  }
  return Math.min(25_000, 4000 * Math.pow(2, attempt));
}

async function withRetry(fn, { maxAttempts = 4, onRetry } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err || "");
      const isAuthErr = err?.status === 401 || err?.status === 403 || /API_KEY_INVALID|invalid api key/i.test(msg);
      if (isAuthErr || attempt === maxAttempts - 1) throw err;
      const waitMs = parseRetryDelayMs(err, attempt);
      if (typeof onRetry === "function") {
        onRetry({ attempt: attempt + 1, maxAttempts, waitMs, error: err });
      }
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

async function waitForFileActive(ai, fileName, timeoutMs = 90_000) {
  if (!fileName || typeof ai.files?.get !== "function") return;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const info = await ai.files.get({ name: fileName });
      const state = String(info?.state || "ACTIVE").toUpperCase();
      if (state === "ACTIVE") return;
      if (state === "FAILED") {
        throw new Error(`Google Files API xử lý file âm thanh thất bại (${fileName}).`);
      }
    } catch (err) {
      if (/FAILED/.test(String(err?.message || ""))) throw err;
      // Nếu SDK/network lỗi thoáng qua khi poll thì đợi vòng tiếp
    }
    await sleep(2000);
  }
}

async function transcribeSingleWavChunk(fallbackAi, chunk, chunkIdx, totalChunks) {
  const rangeLabel = `${formatMMSS(chunk.startSec)} - ${formatMMSS(chunk.endSec)}`;
  const partLabel = totalChunks > 1 ? `phần ${chunkIdx + 1}/${totalChunks} (${rangeLabel})` : `(${rangeLabel})`;

  try {
    return await withRetry(
      () =>
        withGeminiFailover(
          async (apiKey) => {
            const ai = getGenAiClient(apiKey) || fallbackAi;
            let uploadResult = null;
            try {
              sendHudStatus(
                "Meeting Summarizer",
                `Đang tải âm thanh ${partLabel} lên Gemini Cloud...`
              );

              uploadResult = await ai.files.upload({ file: chunk.path, config: { mimeType: "audio/wav" } });
              await waitForFileActive(ai, uploadResult?.name);

              sendHudStatus(
                "Meeting Summarizer",
                `Đang gỡ băng lời thoại ${partLabel} bằng Gemini...`
              );

              const timeOffsetHint =
                chunk.startSec > 0
                  ? `\n- LƯU Ý: Đoạn âm thanh này bắt đầu từ mốc thời gian [${formatMMSS(chunk.startSec)}] của cuộc họp.`
                  : "";

              let diarizationHint = "\n- TÁCH BIỆT NGƯỜI NÓI (Speaker Diarization): File âm thanh được thu Stereo 2 kênh: Kênh Trái (Left) ưu tiên giọng Mic của người dùng [Người nói 1 (Bạn)], Kênh Phải (Right) ưu tiên âm thanh hệ thống của đối tác [Người nói 2, Người nói 3...]. Hãy lắng nghe âm sắc và vị trí kênh để gán nhãn chính xác (ví dụ: [00:05] Người nói 1 (Bạn): ... / [00:12] Người nói 2: ...).";
              if (chunk.diarizationText) {
                diarizationHint += `\n- Gợi ý mốc thời gian người nói từ cảm biến kênh âm thanh:\n${chunk.diarizationText}`;
              }

              const transResponse = await generateMeetingContent(ai, {
                contents: [
                  { fileData: { fileUri: uploadResult.uri, mimeType: uploadResult.mimeType || "audio/wav" } },
                  `Bạn là chuyên gia gỡ băng ghi âm cuộc họp đa phương thức (Speaker Diarization). Hãy nghe thật kỹ file âm thanh này và xuất ra toàn bộ bản ghi lời thoại (transcript) chi tiết bằng tiếng Việt (giữ nguyên thuật ngữ chuyên ngành tiếng Anh nếu có).\n- Giữ nguyên toàn bộ nội dung thảo luận, không tóm tắt hay cắt xén lời thoại ở bước này.\n- Phân đoạn rõ ràng theo mốc thời gian và tách biệt từng người nói (Speaker Diarization: Người nói 1, Người nói 2...).\n- Ghi lại trung thực các ý kiến, tranh luận, số liệu, việc cần làm (To-Do) và hạn chót (Deadline) được nêu trong cuộc họp.${timeOffsetHint}${diarizationHint}`,
                ],
              });

              return (transResponse.text || "").trim();
            } finally {
              if (uploadResult?.name) {
                try {
                  await ai.files.delete({ name: uploadResult.name });
                } catch {
                  // Bỏ qua nếu xoá không thành công
                }
              }
            }
          },
          {
            maxRetries: Math.max(3, getAllGeminiKeys({ purpose: "meeting" }).length),
            purpose: "meeting",
            onFailover: ({ failedKey, attempt, maxRetries }) => {
              const masked = failedKey.length > 8 ? `...${failedKey.slice(-4)}` : failedKey;
              sendHudStatus(
                "Meeting Summarizer",
                `Key (${masked}) chạm hạn mức (429). Đang chuyển sang key dự phòng ${attempt + 1}/${maxRetries}...`
              );
            },
          }
        ),
      {
        maxAttempts: 4,
        onRetry: ({ attempt, waitMs, error }) =>
          sendHudStatus(
            "Meeting Summarizer",
            `Gemini chạm giới hạn TPM/mạng ở ${partLabel} (${error?.message || "429"}). Đang đợi ${Math.round(waitMs / 1000)}s để tiếp tục (lần thử ${attempt})...`
          ),
      }
    );
  } finally {
    if (chunk.isTemp && fs.existsSync(chunk.path)) {
      try {
        fs.unlinkSync(chunk.path);
      } catch {
        // Bỏ qua nếu không xoá được file tạm
      }
    }
  }
}

export async function toggleMeetingRecording() {
  // Chặn tuyệt đối double-hotkey / click đúp trong lúc đang chuyển trạng thái hoặc đang tóm tắt
  if (isToggling || (meetingRecorder && (meetingRecorder.state === "starting" || meetingRecorder.state === "stopping"))) {
    return { status: "error", error: "Đang xử lý chuyển trạng thái ghi âm, vui lòng đợi." };
  }
  if (isSummarizing) {
    return { status: "error", error: "Đang phân tích âm thanh và tạo tóm tắt cuộc họp trước đó, vui lòng đợi hoàn tất." };
  }

  // --- BẮT ĐẦU GHI ÂM ---
  if (!meetingRecorder || meetingRecorder.state === "dead") {
    if (getAllGeminiKeys({ purpose: "meeting" }).length === 0) {
      enterHud();
      sendHudStatus(
        "Thiếu API Key",
        "Chưa cấu hình GEMINI_API_KEY. Vui lòng mở Cài đặt (Setup) và thêm ít nhất 1 API key để kích hoạt tính năng ghi âm & tóm tắt cuộc họp."
      );
      return { status: "error", error: "Thiếu GEMINI_API_KEY, vui lòng cấu hình trước khi ghi âm." };
    }

    isToggling = true;
    try {
      const pythonPath = resolvePythonCommand();
      const scriptPath = path.join(unpackedRepoRoot(), "assets", "sidecar", "meeting_recorder.py");
      meetingWavPath = buildMeetingWavPath();

      let stderrTail = "";
      const recorderHandle = spawnSidecar(pythonPath, [scriptPath, meetingWavPath], {
        cwd: unpackedRepoRoot(),
        onFatalError: (message) => {
          sendHudStatus("Lỗi ghi âm cuộc họp", message);
        },
      });
      meetingRecorder = recorderHandle;

      recorderHandle.proc.stderr.on("data", (data) => {
        const text = String(data);
        stderrTail = `${stderrTail}${text}`.slice(-1000);
        console.error(`Meeting Recorder Err: ${text}`);
      });

      // Chờ tín hiệu READY từ Python (hoặc thoát sớm nếu thiếu thư viện soundcard/numpy hay lỗi mic)
      const startupResult = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: recorderHandle.state !== "dead" }), 3500);
        const onData = (data) => {
          const text = String(data);
          console.log(`Meeting Recorder: ${text}`);
          if (text.includes("READY")) {
            clearTimeout(timer);
            recorderHandle.proc.stdout.off("data", onData);
            resolve({ ok: true });
          }
        };
        recorderHandle.proc.stdout.on("data", onData);
        recorderHandle.proc.once("exit", (code) => {
          clearTimeout(timer);
          recorderHandle.proc.stdout.off("data", onData);
          resolve({ ok: false, code });
        });
      });

      if (!startupResult.ok || recorderHandle.state === "dead") {
        meetingRecorder = null;
        const reason = stderrTail.trim() || `Sidecar thoát sớm (mã ${startupResult.code ?? "?"}). Kiểm tra thư viện python soundcard/numpy và quyền Microphone.`;
        sendHudStatus("Lỗi khởi động ghi âm", reason);
        return { status: "error", error: reason };
      }

      // Theo dõi nếu sidecar bị crash bất ngờ giữa cuộc họp
      recorderHandle.proc.once("exit", (code) => {
        if (meetingRecorder === recorderHandle && recorderHandle.state !== "stopping" && !isSummarizing && code !== 0) {
          sendHudStatus(
            "Cảnh báo ghi âm cuộc họp",
            `Tiến trình ghi âm bị dừng đột ngột (code=${code}). File tạm đã lưu tại: ${meetingWavPath}`
          );
        }
      });

      meetingRecordingStartTime = Date.now();
      enterHud();
      sendHudStatus("Meeting Summarizer", "🔴 Đang ghi âm cuộc họp... (Bấm Alt+M hoặc nút trên thanh công cụ để kết thúc)");
      return { status: "success", message: "Bắt đầu ghi âm cuộc họp." };
    } finally {
      isToggling = false;
    }
  }

  // --- DỪNG GHI ÂM & TÓM TẮT ---
  isToggling = true;
  meetingRecordingStartTime = null;
  enterHud();
  sendHudStatus("Meeting Summarizer", "⏳ Đang dừng ghi âm và đóng gói dữ liệu âm thanh...");

  const activeHandle = meetingRecorder;
  meetingRecorder = null;
  const wavPath = meetingWavPath;

  // Cho phép tối đa 8000ms (lớn hơn tổng join timeout 4.0s của Python) để đóng WAV header an toàn
  await stopSidecar(activeHandle, { timeoutMs: 8000 });
  isToggling = false;

  return processMeetingSummarization(wavPath);
}

/**
 * Tóm tắt một phiên họp bất kỳ đã lưu trong lịch sử theo yêu cầu (on-demand):
 * Hỗ trợ nhận vào đường dẫn file .wav hoặc thư mục của phiên họp.
 */
export async function summarizeMeetingAudio(targetPath) {
  if (!targetPath) return { status: "error", error: "Đường dẫn phiên họp không hợp lệ." };
  let wavPath = targetPath;
  if (fs.existsSync(targetPath)) {
    try {
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        const files = fs.readdirSync(targetPath);
        const wav = files.find((f) => f.endsWith(".wav") && !f.includes("_part"));
        if (!wav) {
          return { status: "error", error: "Không tìm thấy file âm thanh (.wav) trong thư mục cuộc họp này." };
        }
        wavPath = path.join(targetPath, wav);
      }
    } catch (e) {
      return { status: "error", error: `Không thể đọc thư mục cuộc họp: ${e.message}` };
    }
  }
  return processMeetingSummarization(wavPath);
}

/**
 * Luồng phân tích âm thanh, gỡ băng và tạo tóm tắt cuộc họp:
 * Tái sử dụng đồng nhất cho cả luồng tự động sau khi dừng ghi âm và luồng bấm tóm tắt thủ công.
 */
export async function processMeetingSummarization(wavPath) {
  if (isSummarizing) {
    return { status: "error", error: "Đang có một tiến trình tóm tắt khác đang chạy, vui lòng đợi hoàn tất." };
  }
  if (!wavPath || !fs.existsSync(wavPath)) {
    return { status: "error", error: "Không tìm thấy file ghi âm cuộc họp." };
  }

  isSummarizing = true;
  meetingStatusText = "⏳ Đang kiểm tra dữ liệu âm thanh cuộc họp...";
  sendHudStatus("Meeting Summarizer", meetingStatusText);

  try {
    const stat = fs.statSync(wavPath);
    if (stat.size <= WAV_HEADER_BYTES) {
      throw new Error("File ghi âm quá ngắn hoặc không có dữ liệu âm thanh (kích thước ≤ 44 bytes).");
    }
    if (getAllGeminiKeys({ purpose: "meeting" }).length === 0) {
      throw new Error("Thiếu GEMINI_API_KEY. Vui lòng cấu hình API key trước khi tóm tắt.");
    }

    // Tự động kiểm tra & vá WAV header nếu tiến trình bị tắt cưỡng bức
    repairWavHeaderIfNeeded(wavPath);

    const ai = getGenAiClient({ purpose: "meeting" });

    // --- BƯỚC 1: Lấy bản gỡ băng (nếu file _transcript.txt đã có sẵn thì dùng lại) ---
    const transcriptPath = wavPath.replace(/\.wav$/i, "_transcript.txt");
    let transcript = "";

    if (fs.existsSync(transcriptPath)) {
      try {
        const raw = fs.readFileSync(transcriptPath, "utf8");
        const sepIdx = raw.indexOf("\n\n");
        transcript = (sepIdx !== -1 ? raw.slice(sepIdx + 2) : raw).trim();
      } catch {}
    }

    if (!transcript) {
      sendHudStatus("Meeting Summarizer", "🎙️ Đang gỡ băng âm thanh cuộc họp (Speaker Diarization) qua Gemini...");
      const wavChunks = await splitWavIntoChunks(wavPath, MAX_AUDIO_CHUNK_SECONDS);

      // Đọc metadata Speaker Diarization từ sidecar (nếu có) để gán gợi ý người nói cho từng phân đoạn
      let diarSegments = [];
      const diarPath = wavPath.replace(/\.wav$/i, "_diarization.json");
      if (fs.existsSync(diarPath)) {
        try {
          const parsedDiar = JSON.parse(fs.readFileSync(diarPath, "utf8"));
          if (Array.isArray(parsedDiar?.segments)) diarSegments = parsedDiar.segments;
        } catch {}
      }
      for (const ch of wavChunks) {
        const matchingSegs = diarSegments
          .filter((s) => s.end_sec >= ch.startSec && s.start_sec <= ch.endSec)
          .slice(0, 40)
          .map((s) => `[${formatMMSS(s.start_sec)}-${formatMMSS(s.end_sec)}] ${s.speaker}`);
        if (matchingSegs.length > 0) {
          ch.diarizationText = matchingSegs.join(", ");
        }
      }

      const transcriptParts = [];

      for (let i = 0; i < wavChunks.length; i++) {
        sendHudStatus(
          "Meeting Summarizer",
          `🎙️ Đang gỡ băng âm thanh (phần ${i + 1}/${wavChunks.length})...`
        );
        const partText = await transcribeSingleWavChunk(ai, wavChunks[i], i, wavChunks.length);
        if (partText) {
          if (wavChunks.length > 1) {
            transcriptParts.push(
              `### [Phần ${i + 1}/${wavChunks.length} — ${formatMMSS(wavChunks[i].startSec)} đến ${formatMMSS(wavChunks[i].endSec)}]\n${partText}`
            );
          } else {
            transcriptParts.push(partText);
          }
        }
        // Nghỉ ngắn giữa các chunk để hạ nhiệt TPM trên Gemini Free Tier
        if (i < wavChunks.length - 1) {
          await sleep(2500);
        }
      }

      transcript = transcriptParts.join("\n\n").trim();
      if (!transcript) {
        throw new Error("Không nhận diện được lời thoại nào từ file ghi âm này (có thể đoạn thu chỉ có tiếng ồn hoặc im lặng).");
      }

      // Lưu bản ghi lời thoại (Transcript) ra file .txt ngay cạnh file WAV
      try {
        fs.writeFileSync(
          transcriptPath,
          `# BẢN GHI LỜI THOẠI CUỘC HỌP (TRANSCRIPT)\nThời gian: ${new Date().toLocaleString("vi-VN")}\nFile âm thanh: ${wavPath}\nSố phân đoạn xử lý: ${wavChunks.length}\n\n${transcript}`,
          "utf8"
        );
      } catch (saveErr) {
        console.warn("[MeetingRecorder] Không thể lưu file transcript:", saveErr);
      }
    }

    // --- BƯỚC 2: Tóm tắt cuộc họp (Ưu tiên Claude, Fallback về Gemini) ---
    const anthropicKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
    let summary = "";
    let engineUsed = "";

    if (anthropicKey) {
      sendHudStatus(
        "Meeting Summarizer",
        "✨ Đã có transcript. Đang gửi sang Claude để phân tích và lập Action Items..."
      );

      try {
        const claudeResult = await summarizeWithClaude(transcript, anthropicKey);
        summary = claudeResult.summary;
        engineUsed = `Claude (${claudeResult.model})`;
      } catch (claudeErr) {
        console.warn("[MeetingSummarizer] Claude API gặp lỗi, tự động chuyển sang Gemini:", claudeErr.message);
        sendHudStatus(
          "Meeting Summarizer",
          `Claude API không khả dụng (${claudeErr.message}). Đang tự động chuyển sang Gemini để tóm tắt...`
        );
        summary = await summarizeWithGemini(transcript, ai);
        engineUsed = "Gemini Flash (Fallback do Claude lỗi)";
      }
    } else {
      sendHudStatus(
        "Meeting Summarizer",
        "📝 Đã có transcript. Đang dùng Gemini để phân tích và tóm tắt cuộc họp..."
      );
      summary = await summarizeWithGemini(transcript, ai);
      engineUsed = "Gemini Flash";
    }

    // --- BƯỚC 3: Trích xuất Action Items, đồng bộ vào Quick Reminder và xuất biên bản Markdown + HTML/PDF ---
    const actionItems = extractActionItemsFromSummary(summary);
    const syncedReminders = await syncActionItemsToReminders(actionItems);

    const summaryPath = wavPath.replace(/\.wav$/i, "_summary.md");
    const htmlPdfPath = wavPath.replace(/\.wav$/i, "_minutes.html");
    const nowStr = new Date().toLocaleString("vi-VN");
    const reminderNote = syncedReminders.length > 0
      ? `\n- Đồng bộ Nhắc việc (Iris Quick Reminder): Đã tự động tạo ${syncedReminders.length} nhắc nhở công việc.`
      : "";
    const summaryContent = `# Tóm Tắt Cuộc Họp\n\n- Thời gian: ${nowStr}\n- Động cơ tóm tắt: ${engineUsed}\n- File ghi âm: ${wavPath}\n- Bản ghi lời thoại (Transcript): ${transcriptPath}${reminderNote}\n\n${summary}`;

    try {
      fs.writeFileSync(summaryPath, summaryContent, "utf8");
    } catch (saveErr) {
      console.warn("[MeetingRecorder] Không thể lưu file tóm tắt:", saveErr);
    }

    try {
      const htmlContent = buildPrintableMinutesHtml({
        dateStr: nowStr,
        engineUsed,
        wavPath,
        transcriptPath,
        summaryMarkdown: summary,
        actionItems,
        syncedReminders,
      });
      fs.writeFileSync(htmlPdfPath, htmlContent, "utf8");
    } catch (htmlErr) {
      console.warn("[MeetingRecorder] Không thể xuất file biên bản HTML/PDF:", htmlErr);
    }

    const hudSummary = syncedReminders.length > 0
      ? `${summary}\n\n---\n⏰ **Đã tự động đồng bộ ${syncedReminders.length} đầu việc (Action Items) vào hệ thống Nhắc việc của Iris!**`
      : summary;
    sendHudStatus(`Tóm tắt cuộc họp (${engineUsed})`, hudSummary);

    emitEvent({
      type: "log",
      level: "info",
      message: `Đã hoàn thành tóm tắt cuộc họp (${engineUsed}) -> ${summaryPath} (${actionItems.length} Action Items, ${syncedReminders.length} reminders synced)`,
    });

    return {
      status: "success",
      message: `Đã tạo bản tóm tắt cuộc họp thành công bằng ${engineUsed} (${actionItems.length} đầu việc, đã đồng bộ ${syncedReminders.length} nhắc nhở).`,
      wav_path: wavPath,
      transcript_path: transcriptPath,
      summary_path: summaryPath,
      html_pdf_path: htmlPdfPath,
      action_items: actionItems,
      synced_reminders: syncedReminders,
      summary,
      engine: engineUsed,
    };
  } catch (err) {
    sendHudStatus("Lỗi tóm tắt", err.message);
    return { status: "error", error: err.message };
  } finally {
    isSummarizing = false;
    meetingStatusText = "";
  }
}

const SUMMARY_PROMPT_TEMPLATE = (transcript) => `Dưới đây là toàn bộ bản ghi lời thoại (transcript) của cuộc họp:

---
${transcript}
---

Hãy đọc kỹ và tạo bản tóm tắt cuộc họp cực kỳ chuyên nghiệp, súc tích và chi tiết bằng tiếng Việt theo định dạng Markdown chuẩn.

YÊU CẦU LỌC THÔNG TIN & LOẠI BỎ TẠP ÂM:
- BỎ QUA HOÀN TOÀN các đoạn chào hỏi xã giao ban đầu, kiểm tra kỹ thuật ("alo nghe rõ không", "bật camera/share màn hình"), chuyện phiếm/đùa vui ngoài lề, từ đệm ngập ngừng ("ờ, à, ừ") và các tranh cãi lan man không đi đến đâu.
- CHỈ TẬP TRUNG vào bản chất công việc: bối cảnh cốt lõi, các giải pháp thực tế, số liệu/dữ liệu cụ thể, các quyết định đã được chốt và trách nhiệm công việc.

# 📌 TÓM TẮT CUỘC HỌP

## 1. 🎯 Mục tiêu & Tổng quan cuộc họp
- Mục đích chính của cuộc họp là gì?
- Các thành viên / bên tham gia chính (nếu có trong bản ghi).

## 2. 📋 Nội dung thảo luận chi tiết theo chủ đề
- Tóm tắt chi tiết từng vấn đề, các phương án, số liệu, ý kiến đóng góp và phản biện thực chất.

## 3. 💡 Các quyết định đã được thống nhất
- Những kết luận và quyết định quan trọng đã được chốt.

## 4. ✅ Danh sách Action Items (Kế hoạch hành động)
| STT | Công việc cần làm | Người phụ trách (nếu rõ) | Hạn chót (Deadline) |
| --- | --- | --- | --- |

## 5. ❓ Vấn đề còn tồn đọng / Cần làm rõ thêm
- Những nội dung chưa chốt hoặc cần theo dõi tiếp.`;

function splitTextByParagraphs(text, maxChars = 80_000) {
  if (text.length <= maxChars) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const parts = [];
  let current = "";
  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length > maxChars && current.length > 0) {
      parts.push(current.trim());
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

async function summarizeWithClaude(transcript, apiKey) {
  const { Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 2 });

  const systemPrompt =
    "Bạn là trợ lý AI cao cấp chuyên phân tích và tóm tắt cuộc họp doanh nghiệp. Đảm bảo cấu trúc rõ ràng, chuẩn xác, giữ đầy đủ bảng Action Items ở cuối.";

  // Nếu transcript quá dài (>120,000 ký tự), chia nhỏ để tóm tắt trung gian (Map-Reduce)
  let effectiveTranscript = transcript;
  const candidateModels = [
    process.env.ANTHROPIC_MEETING_MODEL,
    "claude-sonnet-4-20250514",
    "claude-3-7-sonnet-20250219",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
  ].filter(Boolean);

  let lastErr = null;
  for (const model of candidateModels) {
    try {
      const maxTokens = model.includes("haiku") ? 4096 : 8192;

      if (transcript.length > MAX_DIRECT_TRANSCRIPT_CHARS) {
        const segments = splitTextByParagraphs(transcript, 80_000);
        const partialNotes = [];
        for (let i = 0; i < segments.length; i++) {
          sendHudStatus(
            "Meeting Summarizer",
            `Transcript rất dài — Claude đang tổng hợp phân đoạn ${i + 1}/${segments.length}...`
          );
          const segRes = await client.messages.create({
            model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: [
              {
                role: "user",
                content: `Hãy trích xuất chi tiết mọi chủ đề thảo luận, số liệu, quyết định và công việc cần làm (Action Items) trong phân đoạn ${i + 1}/${segments.length} của cuộc họp sau:\n\n---\n${segments[i]}\n---`,
              },
            ],
          });
          const segText = segRes.content?.find((b) => b.type === "text")?.text || "";
          if (segText) partialNotes.push(`### Tổng hợp phân đoạn ${i + 1}/${segments.length}\n${segText}`);
        }
        effectiveTranscript = partialNotes.join("\n\n");
      }

      const userPrompt = SUMMARY_PROMPT_TEMPLATE(effectiveTranscript);
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      let fullText = response.content?.find((b) => b.type === "text")?.text || "";
      if (!fullText) continue;

      // Chống cắt cụt phần Action Items ở cuối nếu chạm max_tokens
      if (response.stop_reason === "max_tokens") {
        const contResponse = await client.messages.create({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [
            { role: "user", content: userPrompt },
            { role: "assistant", content: fullText },
            {
              role: "user",
              content:
                "Bản tóm tắt trên đang bị ngắt giữa chừng do giới hạn token. Hãy viết tiếp ngay từ chỗ bị ngắt (không lặp lại phần đầu) để hoàn thiện đầy đủ bảng Action Items và phần kết.",
            },
          ],
        });
        const contText = contResponse.content?.find((b) => b.type === "text")?.text || "";
        if (contText) {
          fullText = `${fullText}\n${contText}`;
        }
      }

      return { summary: fullText, model };
    } catch (err) {
      lastErr = err;
      console.warn(`[MeetingSummarizer] Thử model Claude "${model}" thất bại:`, err.message);
      if (err?.status === 401) throw err; // Sai API key thì dừng thử model khác
    }
  }
  throw lastErr || new Error("Không nhận được phản hồi hợp lệ từ Claude API.");
}

async function summarizeWithGemini(transcript, fallbackAi) {
  let effectiveTranscript = transcript;
  const maxRetries = Math.max(3, getAllGeminiKeys({ purpose: "meeting" }).length);
  if (transcript.length > MAX_DIRECT_TRANSCRIPT_CHARS) {
    const segments = splitTextByParagraphs(transcript, 80_000);
    const partialNotes = [];
    for (let i = 0; i < segments.length; i++) {
      sendHudStatus(
        "Meeting Summarizer",
        `Transcript rất dài — Gemini đang tổng hợp phân đoạn ${i + 1}/${segments.length}...`
      );
      const segRes = await withRetry(() =>
        withGeminiFailover(
          async (apiKey) => {
            const client = getGenAiClient(apiKey) || fallbackAi;
            return generateMeetingContent(client, {
              contents: [
                `Hãy trích xuất chi tiết mọi chủ đề thảo luận, số liệu, quyết định và công việc cần làm (Action Items) trong phân đoạn ${i + 1}/${segments.length} của cuộc họp sau:\n\n---\n${segments[i]}\n---`,
              ],
            });
          },
          {
            maxRetries,
            purpose: "meeting",
            onFailover: ({ failedKey, attempt, maxRetries: total }) => {
              const masked = failedKey.length > 8 ? `...${failedKey.slice(-4)}` : failedKey;
              sendHudStatus(
                "Meeting Summarizer",
                `Key (${masked}) chạm hạn mức. Đang chuyển sang key dự phòng ${attempt + 1}/${total}...`
              );
            },
          }
        )
      );
      if (segRes.text) partialNotes.push(`### Tổng hợp phân đoạn ${i + 1}/${segments.length}\n${segRes.text}`);
    }
    effectiveTranscript = partialNotes.join("\n\n");
  }

  const prompt = SUMMARY_PROMPT_TEMPLATE(effectiveTranscript);
  const response = await withRetry(() =>
    withGeminiFailover(
      async (apiKey) => {
        const client = getGenAiClient(apiKey) || fallbackAi;
        return generateMeetingContent(client, {
          contents: [prompt],
        });
      },
      {
        maxRetries,
        purpose: "meeting",
        onFailover: ({ failedKey, attempt, maxRetries: total }) => {
          const masked = failedKey.length > 8 ? `...${failedKey.slice(-4)}` : failedKey;
          sendHudStatus(
            "Meeting Summarizer",
            `Key (${masked}) chạm hạn mức. Đang chuyển sang key dự phòng ${attempt + 1}/${total}...`
          );
        },
      }
    )
  );
  return response.text || "";
}

/**
 * Quét toàn bộ thư mục meeting_recordings để lấy danh sách các phiên họp trước đó,
 * gồm thông tin ngày, giờ, trích đoạn tóm tắt, đường dẫn thư mục và các file liên quan.
 */
export function listMeetingHistory() {
  const baseDir = path.join(userDataDir(), "meeting_recordings");
  if (!fs.existsSync(baseDir)) return [];

  const history = [];
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    const dateDirs = entries
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();

    for (const dateStr of dateDirs) {
      const datePath = path.join(baseDir, dateStr);
      let subEntries = [];
      try {
        subEntries = fs.readdirSync(datePath, { withFileTypes: true });
      } catch {
        continue;
      }

      // 1. Cấu trúc mới: Mỗi phiên làm việc là 1 thư mục riêng biệt (meeting_recordings/YYYY-MM-DD/meeting_HH-MM-SS/)
      const sessionDirs = subEntries.filter((e) => e.isDirectory());
      for (const sub of sessionDirs) {
        const sessionPath = path.join(datePath, sub.name);
        const match = sub.name.match(/(\d{2}-\d{2}-\d{2})/);
        const timeKey = match ? match[1] : "00-00-00";
        let files = [];
        try {
          files = fs.readdirSync(sessionPath);
        } catch {
          continue;
        }

        const item = {
          id: `${dateStr}_${timeKey}`,
          date: dateStr,
          time: timeKey.replace(/-/g, ":"),
          timeKey,
          folderPath: sessionPath,
          wavPath: null,
          transcriptPath: null,
          summaryPath: null,
          summaryContent: "",
          snippet: "",
          createdAt: null,
          hasSummary: false,
          hasWav: false,
          hasTranscript: false,
        };

        for (const file of files) {
          const fullPath = path.join(sessionPath, file);
          if (file.endsWith("_summary.md") || file.endsWith("summary.md")) {
            item.summaryPath = fullPath;
            item.hasSummary = true;
          } else if (file.endsWith("_transcript.txt") || file.endsWith("transcript.txt")) {
            item.transcriptPath = fullPath;
            item.hasTranscript = true;
          } else if (file.endsWith(".wav") && !file.includes("_part")) {
            item.wavPath = fullPath;
            item.hasWav = true;
          }
        }

        const target = item.summaryPath || item.wavPath || item.transcriptPath;
        if (target && fs.existsSync(target)) {
          try {
            item.createdAt = fs.statSync(target).mtimeMs;
          } catch {}
        }
        if (item.wavPath && fs.existsSync(item.wavPath)) {
          try {
            const stat = fs.statSync(item.wavPath);
            if (stat.size > 44) {
              item.durationSeconds = Math.max(1, Math.round((stat.size - 44) / 64000));
            }
          } catch {}
        }
        if (item.summaryPath && fs.existsSync(item.summaryPath)) {
          try {
            const raw = fs.readFileSync(item.summaryPath, "utf8");
            item.summaryContent = raw;
            const clean = raw
              .replace(/#+ [^\n]+/g, "")
              .replace(/- (?:Thời gian|File ghi|Bản ghi|Động cơ)[^\n]+/g, "")
              .replace(/[\r\n]+/g, " ")
              .trim();
            item.snippet = clean.slice(0, 180) + (clean.length > 180 ? "..." : "");
          } catch {}
        } else if (!item.snippet) {
          item.snippet = "Bản ghi âm cuộc họp (chưa có tóm tắt văn bản)";
        }
        history.push(item);
      }

      // 2. Cấu trúc cũ (legacy): các file nằm trực tiếp trong datePath
      const legacyFiles = subEntries.filter((e) => e.isFile()).map((e) => e.name);
      const sessionsMap = new Map();
      for (const file of legacyFiles) {
        const match = file.match(/^meeting_(\d{2}-\d{2}-\d{2})(.*)$/);
        if (!match) continue;
        const timeKey = match[1];
        if (!sessionsMap.has(timeKey)) {
          sessionsMap.set(timeKey, {
            id: `${dateStr}_${timeKey}`,
            date: dateStr,
            time: timeKey.replace(/-/g, ":"),
            timeKey,
            folderPath: datePath,
            wavPath: null,
            transcriptPath: null,
            summaryPath: null,
            summaryContent: "",
            snippet: "",
            createdAt: null,
            hasSummary: false,
            hasWav: false,
            hasTranscript: false,
          });
        }
        const item = sessionsMap.get(timeKey);
        const fullPath = path.join(datePath, file);
        if (file.endsWith("_summary.md")) {
          item.summaryPath = fullPath;
          item.hasSummary = true;
        } else if (file.endsWith("_transcript.txt")) {
          item.transcriptPath = fullPath;
          item.hasTranscript = true;
        } else if (file.endsWith(".wav") && !file.includes("_part")) {
          item.wavPath = fullPath;
          item.hasWav = true;
        }
      }

      for (const item of sessionsMap.values()) {
        const target = item.summaryPath || item.wavPath || item.transcriptPath;
        if (target && fs.existsSync(target)) {
          try {
            item.createdAt = fs.statSync(target).mtimeMs;
          } catch {}
        }
        if (item.wavPath && fs.existsSync(item.wavPath)) {
          try {
            const stat = fs.statSync(item.wavPath);
            if (stat.size > 44) {
              item.durationSeconds = Math.max(1, Math.round((stat.size - 44) / 64000));
            }
          } catch {}
        }
        if (item.summaryPath && fs.existsSync(item.summaryPath)) {
          try {
            const raw = fs.readFileSync(item.summaryPath, "utf8");
            item.summaryContent = raw;
            const clean = raw
              .replace(/#+ [^\n]+/g, "")
              .replace(/- (?:Thời gian|File ghi|Bản ghi|Động cơ)[^\n]+/g, "")
              .replace(/[\r\n]+/g, " ")
              .trim();
            item.snippet = clean.slice(0, 180) + (clean.length > 180 ? "..." : "");
          } catch {}
        } else if (!item.snippet) {
          item.snippet = "Bản ghi âm cuộc họp (chưa có tóm tắt văn bản)";
        }
        history.push(item);
      }
    }

    history.sort((a, b) => {
      if (a.createdAt && b.createdAt) return b.createdAt - a.createdAt;
      return `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`);
    });
  } catch (err) {
    console.error("[MeetingRecorder] Không thể đọc danh sách lịch sử cuộc họp:", err);
  }

  return history;
}

/**
 * Ước lượng số phút hẹn nhắc việc từ chuỗi Deadline tiếng Việt/Anh trong bảng Action Items.
 */
export function estimateReminderMinutesFromDeadline(deadlineStr = "") {
  const s = String(deadlineStr || "").trim().toLowerCase();
  if (!s) return 60;
  const minMatch = s.match(/(\d+)\s*(?:phút|min|p\b)/i);
  if (minMatch) return Math.max(1, Math.min(10080, Number(minMatch[1])));
  const hourMatch = s.match(/(\d+)\s*(?:giờ|tiếng|h\b|hour)/i);
  if (hourMatch) return Math.max(5, Math.min(10080, Number(hourMatch[1]) * 60));
  if (/ngay lập tức|gấp|urgent|asap/i.test(s)) return 15;
  if (/hôm nay|chiều nay|tối nay|today|tonight|eod/i.test(s)) return 120;
  if (/ngày mai|sáng mai|tomorrow/i.test(s)) return 720;
  if (/tuần này|cuối tuần|this week/i.test(s)) return 1440;
  return 60;
}

/**
 * Tự động trích xuất danh sách To-Do List & Action Items (ai làm gì, deadline khi nào)
 * từ bản tóm tắt Markdown của cuộc họp.
 */
export function extractActionItemsFromSummary(summaryMarkdown = "") {
  const text = String(summaryMarkdown || "");
  if (!text.trim()) return [];

  const items = [];
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim().replace(/\*\*/g, ""));

    if (cells.length < 2) continue;
    // Bỏ qua dòng tiêu đề bảng và dòng gạch ngang phân cách (| --- | --- |)
    if (cells.every((c) => /^[-:\s]+$/.test(c))) continue;
    const firstLower = cells[0].toLowerCase();
    const secondLower = (cells[1] || "").toLowerCase();
    if (
      firstLower === "stt" ||
      firstLower === "#" ||
      secondLower.includes("công việc cần làm") ||
      secondLower.includes("action item") ||
      secondLower.includes("nhiệm vụ")
    ) {
      continue;
    }

    const isNumberedFirstCol = /^\d+$/.test(cells[0]);
    const task = isNumberedFirstCol ? (cells[1] || "") : (cells[0] || "");
    const assignee = isNumberedFirstCol ? (cells[2] || "Chưa gán") : (cells[1] || "Chưa gán");
    const deadline = isNumberedFirstCol ? (cells[3] || "Sớm nhất") : (cells[2] || "Sớm nhất");
    const priority = isNumberedFirstCol ? (cells[4] || "Trung bình") : (cells[3] || "Trung bình");

    const cleanTask = task.trim();
    if (
      !cleanTask ||
      cleanTask.length < 3 ||
      /^(?:không có|chưa có|n\/a|none|-)$/i.test(cleanTask)
    ) {
      continue;
    }

    const cleanOwner = assignee.trim() || "Chưa gán";
    items.push({
      index: items.length + 1,
      task: cleanTask,
      assignee: cleanOwner,
      owner: cleanOwner,
      deadline: deadline.trim() || "Sớm nhất",
      priority: priority.trim() || "Trung bình",
      minutes: estimateReminderMinutesFromDeadline(deadline),
    });
  }

  return items;
}

/**
 * Tự động đồng bộ các đầu việc (Action Items) tìm được từ cuộc họp vào hệ thống nhắc nhở của Iris (`quickReminderTool`).
 */
export async function syncActionItemsToReminders(actionItems = []) {
  if (!Array.isArray(actionItems) || actionItems.length === 0) return [];
  const autoSync = String(process.env.IRIS_MEETING_AUTO_REMINDERS ?? "1").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(autoSync)) return [];

  const synced = [];
  for (const item of actionItems.slice(0, 10)) {
    try {
      const title = `[Action Item] ${item.task.slice(0, 60)}`;
      const message = `Phụ trách: ${item.assignee} | Hạn chót: ${item.deadline} — ${item.task}`;
      const res = await quickReminderTool({
        action: "schedule",
        minutes: item.minutes || 60,
        title,
        message,
      });
      if (res && res.status === "success") {
        synced.push({
          id: res.reminder?.id || null,
          task: item.task,
          assignee: item.assignee,
          deadline: item.deadline,
          minutes: item.minutes || 60,
        });
      }
    } catch (err) {
      console.warn("[MeetingRecorder] Lỗi đồng bộ Action Item vào quick_reminder:", err.message);
    }
  }
  return synced;
}

/**
 * Xuất biên bản cuộc họp định dạng HTML chuyên nghiệp (tối ưu chuẩn in PDF / Print-to-PDF).
 */
export function buildPrintableMinutesHtml(optionsOrMarkdown = {}, maybeDateStr = "") {
  const opts =
    typeof optionsOrMarkdown === "string"
      ? { summaryMarkdown: optionsOrMarkdown, dateStr: maybeDateStr, actionItems: extractActionItemsFromSummary(optionsOrMarkdown) }
      : optionsOrMarkdown || {};
  const {
    dateStr = "",
    engineUsed = "",
    wavPath = "",
    summaryMarkdown = "",
    actionItems = [],
    syncedReminders = [],
  } = opts;
  const esc = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const actionRows = actionItems
    .map(
      (it) =>
        `<tr><td>${it.index}</td><td><strong>${esc(it.task)}</strong></td><td>${esc(it.assignee)}</td><td>${esc(it.deadline)}</td></tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Biên Bản Cuộc Họp — Iris Smart Meeting Minutes</title>
  <style>
    body { font-family: "Segoe UI", Roboto, Arial, sans-serif; color: #1e293b; max-width: 860px; margin: 32px auto; padding: 0 24px; line-height: 1.6; }
    h1 { color: #0f172a; border-bottom: 2px solid #0ea5e9; padding-bottom: 10px; }
    .meta { background: #f8fafc; border-left: 4px solid #0ea5e9; padding: 12px 16px; border-radius: 6px; margin-bottom: 24px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0 24px; }
    th, td { border: 1px solid #cbd5e1; padding: 10px 12px; text-align: left; font-size: 14px; }
    th { background: #f1f5f9; color: #0f172a; }
    pre.md { white-space: pre-wrap; font-family: inherit; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; }
    .print-btn { background: #0284c7; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; float: right; }
    @media print { .print-btn { display: none; } body { margin: 0; max-width: 100%; } }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨️ Xuất PDF / In biên bản</button>
  <h1>📋 BIÊN BẢN CUỘC HỌP (IRIS AI MINUTES)</h1>
  <div class="meta">
    <div><strong>Thời gian:</strong> ${esc(dateStr)}</div>
    <div><strong>Động cơ AI:</strong> ${esc(engineUsed)}</div>
    <div><strong>File ghi âm gốc:</strong> ${esc(wavPath)}</div>
    <div><strong>Nhắc việc tự động (Quick Reminders):</strong> Đã đồng bộ ${syncedReminders.length}/${actionItems.length} đầu việc</div>
  </div>
  ${
    actionItems.length > 0
      ? `<h2>✅ Bảng Kế Hoạch Hành Động (Action Items & To-Do List)</h2>
  <table>
    <thead><tr><th>STT</th><th>Công việc cần làm</th><th>Người phụ trách</th><th>Hạn chót (Deadline)</th></tr></thead>
    <tbody>${actionRows}</tbody>
  </table>`
      : ""
  }
  <h2>📝 Nội Dung Chi Tiết Biên Bản</h2>
  <pre class="md">${esc(summaryMarkdown)}</pre>
</body>
</html>`;
}


