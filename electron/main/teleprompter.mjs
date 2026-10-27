/**
 * electron/main/teleprompter.mjs
 *
 * Live transcriber / copilot-mode / translate-mode HUD features: streaming
 * mic+system audio through the Python sidecar, asking Claude for copilot
 * suggestions, and pushing live captions to the Glass HUD.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSidecar, stopSidecar, resolvePythonCommand } from "./sidecar-process.mjs";
import { emitEvent } from "./events.mjs";
import { mainWindow } from "./window-manager.mjs";
import { enterHud } from "./window-manager.mjs";
import { ai } from "./gemini-live.mjs";
import { userDataDir, unpackedRepoRoot } from "./paths.mjs";
import { grabPrimaryScreenJpeg, getVisionSnapMode } from "./vision.mjs";
import { activeWindowInfoTool } from "./local-tools.mjs";
import { getAllGeminiKeys, getGenAiClient, getNextGeminiKey, withGeminiFailover, isRateLimitError } from "./gemini-keys.mjs";
import { getMeetingState } from "./meeting-recording.mjs";
import { envFlag } from "./env-config.mjs";

const TELEPROMPTER_CANDIDATE_MODELS = Array.from(
  new Set(
    [
      String(process.env.GEMINI_TRANSLATE_MODEL || "").trim(),
      "gemini-2.0-flash",
      "gemini-flash-latest",
      "gemini-flash-lite-latest",
      "gemini-2.5-flash",
    ].filter(Boolean)
  )
);

export let liveTranscriber = null; // handle { proc, state, exitCode }
export let liveTranscripts = [];
export let copilotBuffer = [];
export let copilotTimer = null;
// FEAT-TELEPROMPTER-INTERVIEW-01 (đã thiết kế lại theo yêu cầu): "Nhắc bài"
// giờ là một bảng gợi ý MINH BẠCH trên HUD — không còn tự tắt mic để giấu
// (đã bỏ hẳn cơ chế "teleprompter:force-mic"), và không còn ghi đè 1 dòng
// gợi ý duy nhất mỗi lần có câu hỏi mới. Mỗi câu hỏi/gợi ý được PUSH vào
// copilotHistory (kèm nguyên văn ngữ cảnh câu hỏi để dễ tìm lại), HudShell
// render thành danh sách cuộn được + có ô tìm kiếm riêng. copilotStatus là
// dòng trạng thái tạm thời ("Đang suy nghĩ...") — không lưu vào lịch sử.
export let copilotHistory = []; // { id, question, answer, ts, engine }[]
export let copilotStatus = "";
export let copilotEnabled = false;
export const COPILOT_HISTORY_MAX = 100; // giới hạn bộ nhớ cho 1 phiên Alt+T dài
export let liveLogStream = null;

// "Dịch" mode — dịch hội thoại (transcript của cả [Bạn] và [Đối tác]) sang 1
// ngôn ngữ đích do người dùng chọn khi bấm nút Dịch trên HUD. Loại trừ với
// copilotEnabled (Nhắc bài) — bật cái này tự tắt cái kia và ngược lại (xem
// toggleTranslateMode/toggleCopilotMode), để tránh chạy 2 luồng gọi API
// song song trên cùng 1 transcript.
export let translateEnabled = false;
export let translateTargetLang = "";
export let liveTranslations = []; // song song với liveTranscripts, tối đa 3 dòng gần nhất
export let currentStreamingTranslation = ""; // hiển thị realtime khi dịch
export let allSessionTranscripts = []; // Toàn bộ lịch sử hội thoại trong phiên để tự động xuất biên bản Markdown
export let liveBulletPoints = []; // Tóm tắt ý chính theo thời gian thực (Real-time Bullet Points)

export async function getGeminiVisionClient(apiKey) {
  const key = (
    apiKey ||
    getNextGeminiKey({ purpose: "vision", preferVision: true }) ||
    process.env.GEMINI_VISION_API_KEY ||
    process.env.GEMINI_API_KEY ||
    ""
  ).trim();
  if (!key) return null;
  return getGenAiClient(key);
}

export async function callClaudeForTeleprompter(systemPrompt, userText, { maxTokens = 600 } = {}) {
  const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.IRIS_TELEPROMPTER_ANTHROPIC_KEY || "").trim();
  if (!apiKey || !apiKey.startsWith("sk-ant-")) {
    throw new Error(
      "Thiếu ANTHROPIC_API_KEY hợp lệ (key phải bắt đầu bằng sk-ant-) — chuyển sang Gemini dự phòng."
    );
  }
  const candidateModels = [
    process.env.ANTHROPIC_MODEL,
    "claude-3-7-sonnet-latest",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-sonnet-latest",
  ].filter(Boolean);

  const uniqueModels = [...new Set(candidateModels)];
  let lastErr = null;

  for (const model of uniqueModels) {
    let timer = null;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 15000); // 15s timeout
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userText }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        if (res.status === 404 && uniqueModels.indexOf(model) < uniqueModels.length - 1) {
          console.warn(`[callClaudeForTeleprompter] Model ${model} không tồn tại (404), thử model tiếp theo...`);
          continue;
        }
        throw new Error(`Claude API (${model}) lỗi ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const block = Array.isArray(data.content) ? data.content.find((b) => b.type === "text") : null;
      return (block?.text || "").trim();
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error("Claude API quá thời gian chờ (15s)");
      }
      lastErr = err;
      if (!err.message?.includes("404")) {
        throw err;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  throw lastErr || new Error("Không thể gọi Claude API");
}

let hudClearTimer = null;

export function updateTeleprompterHud() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents?.isDestroyed?.()) return;

  // Nếu đang trong phiên ghi âm hoặc tóm tắt cuộc họp (Alt+M), không ghi đè cửa sổ HUD của Meeting Summarizer
  try {
    const meeting = typeof getMeetingState === "function" ? getMeetingState() : null;
    if (meeting?.isRecording || meeting?.isSummarizing) {
      return;
    }
  } catch {}

  let content = liveTranscripts.join("\n");
  if (translateEnabled) {
    let t = [...liveTranslations];
    if (currentStreamingTranslation) {
      t.push(`[Đang dịch]: ${currentStreamingTranslation}`);
    }
    if (t.length) {
      content += `\n\n🌐 [Dịch sang ${translateTargetLang || "ngôn ngữ đích"}]:\n` + t.join("\n");
    }
  }
  if (Array.isArray(liveBulletPoints) && liveBulletPoints.length > 0) {
    content += `\n\n📌 [Ý chính thời gian thực]:\n` + liveBulletPoints.map((b) => `• ${b}`).join("\n");
  }
  // Nhắc bài không còn ghi đè vào `content` dạng text (dòng đơn, dễ mất) —
  // gửi copilotHistory/copilotStatus như dữ liệu có cấu trúc riêng,
  // HudShell tự render thành bảng cuộn được, giữ nguyên toàn bộ lịch sử
  // trong phiên (không bị mất khi có câu hỏi mới).
  try {
    mainWindow.webContents.send("hud:message", {
      title: "Live Teleprompter",
      content,
      copilotHistory: (copilotEnabled || copilotHistory.length > 0) ? copilotHistory : undefined,
      copilotStatus: (copilotEnabled || copilotStatus) ? copilotStatus : undefined,
      teleprompterState: {
        translateEnabled,
        translateTargetLang,
        copilotEnabled,
        transcriptCount: allSessionTranscripts.length,
        bulletCount: Array.isArray(liveBulletPoints) ? liveBulletPoints.length : 0,
        liveBulletPoints: Array.isArray(liveBulletPoints) ? liveBulletPoints : [],
      },
    });
  } catch (err) {
    console.warn("[updateTeleprompterHud] Lỗi gửi hud:message:", err);
  }
}

export async function toggleTranslateMode(targetLang) {
  const cleanLang = (targetLang || "").trim();
  if (cleanLang) {
    // Nếu chọn ngôn ngữ cụ thể -> luôn BẬT và chuyển sang ngôn ngữ đó
    translateEnabled = true;
    translateTargetLang = cleanLang;
    liveTranslations = [];
    currentStreamingTranslation = "";
  } else {
    // Tắt dịch
    translateEnabled = false;
    translateTargetLang = "";
    liveTranslations = [];
    currentStreamingTranslation = "";
  }
  updateTeleprompterHud();
  return { status: "success", message: `Dịch: ${translateEnabled ? `BẬT (${translateTargetLang})` : "TẮT"}` };
}

export function toggleCopilotMode() {
  copilotEnabled = !copilotEnabled;
  if (!copilotEnabled) {
    copilotStatus = "";
    if (copilotTimer) clearTimeout(copilotTimer);
  } else {
    copilotStatus = "💡 Nhắc bài đã BẬT — đang lắng nghe.";
  }

  if (liveTranscriber && mainWindow) {
    updateTeleprompterHud();
  }
  
  return { status: "success", message: `Nhắc bài: ${copilotEnabled ? "ON" : "OFF"}` };
}

/**
 * Tự động xuất biên bản cuộc họp & nhắc bài ra file Markdown trong ~/iris-second-brain/meetings/
 */
export async function exportTeleprompterMinutes() {
  if (allSessionTranscripts.length === 0 && copilotHistory.length === 0) {
    return { ok: false, status: "empty", message: "Chưa có dữ liệu hội thoại trong phiên này để xuất." };
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const fileName = `teleprompter-${dateStr}_${timeStr}.md`;

  const secondBrainDir = path.join(os.homedir(), "iris-second-brain", "meetings");
  try {
    fs.mkdirSync(secondBrainDir, { recursive: true });
  } catch (mkdirErr) {
    return { ok: false, status: "error", message: `Không thể tạo thư mục lưu biên bản (${mkdirErr.message}).` };
  }
  const filePath = path.join(secondBrainDir, fileName);

  let md = `# BIÊN BẢN HỘI THOẠI & NHẮC BÀI (LIVE TELEPROMPTER)\n\n`;
  md += `- **Thời gian xuất:** ${now.toLocaleString("vi-VN")}\n`;
  md += `- **Chế độ dịch:** ${translateEnabled ? `BẬT (${translateTargetLang})` : "TẮT"}\n`;
  md += `- **Chế độ nhắc bài (Copilot):** ${copilotEnabled ? "BẬT" : "TẮT"}\n`;
  md += `- **Tổng số câu hội thoại:** ${allSessionTranscripts.length}\n`;
  md += `- **Số câu hỏi & gợi ý:** ${copilotHistory.length}\n\n`;
  md += `---\n\n`;

  if (liveBulletPoints.length > 0) {
    md += `## 📌 TÓM TẮT Ý CHÍNH THỜI GIAN THỰC (REAL-TIME BULLET POINTS)\n\n`;
    liveBulletPoints.forEach((b) => {
      md += `- ${b}\n`;
    });
    md += `\n---\n\n`;
  }

  if (copilotHistory.length > 0) {
    md += `## 💡 CÁC CÂU HỎI & GỢI Ý ĐỐI ĐÁP (COPILOT Q&A)\n\n`;
    copilotHistory.forEach((item, idx) => {
      md += `### ${idx + 1}. ${item.question}\n`;
      md += `- **Thời gian:** ${new Date(item.ts).toLocaleTimeString("vi-VN")}\n`;
      if (item.engine) md += `- **Engine:** ${item.engine}\n`;
      md += `\n> **Gợi ý trả lời:**\n> ${String(item.answer ?? "").replace(/\n/g, "\n> ")}\n\n`;
    });
    md += `---\n\n`;
  }

  md += `## 📝 NỘI DUNG HỘI THOẠI CHI TIẾT (TRANSCRIPT)\n\n`;
  allSessionTranscripts.forEach((line) => {
    md += `**[${line.time}]** ${line.text}\n\n`;
    if (line.translation) {
      md += `> 🌐 *Bản dịch:* ${line.translation}\n\n`;
    }
  });

  try {
    fs.writeFileSync(filePath, md, "utf8");
  } catch (writeErr) {
    return { ok: false, status: "error", message: `Không thể lưu biên bản (${writeErr.message}).` };
  }

  return {
    ok: true,
    status: "success",
    path: filePath,
    filePath,
    fileName,
    count: allSessionTranscripts.length + copilotHistory.length,
    message: `Đã lưu biên bản thành công vào: ${fileName}`,
  };
}

let bulletSummaryInFlight = false;

/**
 * Tự động trích xuất/cập nhật các ý chính theo thời gian thực (Real-time Bullet Points)
 * hỗ trợ song ngữ Anh - Việt cho phỏng vấn hoặc thuyết trình.
 */
export async function refreshRealtimeBulletPoints() {
  if (bulletSummaryInFlight || allSessionTranscripts.length < 2) return liveBulletPoints;
  const recentSlice = allSessionTranscripts.slice(-6).map((item) => item.text).join("\n");
  if (!recentSlice.trim()) return liveBulletPoints;

  bulletSummaryInFlight = true;
  try {
    const prompt =
      "Bạn là trợ lý tóm tắt thời gian thực song ngữ Anh - Việt. Dựa trên các câu hội thoại mới nhất dưới đây, hãy trích xuất tối đa 3 gạch đầu dòng (bullet points) ngắn gọn nhất (mỗi ý không quá 16 từ) nêu bật ý chính, số liệu hoặc câu hỏi trọng tâm đang thảo luận. " +
      "Chỉ trả về các dòng bắt đầu bằng '- ', không thêm tiêu đề hay lời dẫn.\n\n" +
      recentSlice;

    let raw = "";
    if (getAllGeminiKeys({ purpose: "teleprompter" }).length > 0) {
      const res = await withGeminiFailover(
        async (apiKey) => {
          const client = getGenAiClient(apiKey);
          for (const m of TELEPROMPTER_CANDIDATE_MODELS) {
            try {
              return await client.models.generateContent({ model: m, contents: prompt });
            } catch {
              continue;
            }
          }
          return null;
        },
        { purpose: "teleprompter" }
      ).catch(() => null);
      raw = String(res?.text || "").trim();
    } else if (ai) {
      const res = await ai.models.generateContent({ model: "gemini-flash-latest", contents: prompt }).catch(() => null);
      raw = String(res?.text || "").trim();
    }

    if (raw) {
      const bullets = raw
        .split(/\r?\n/)
        .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
        .filter((l) => l.length >= 4)
        .slice(0, 4);
      if (bullets.length > 0) {
        liveBulletPoints = bullets;
        updateTeleprompterHud();
      }
    }
  } catch {
    // Bỏ qua lỗi tóm tắt nền để không ảnh hưởng luồng chính
  } finally {
    bulletSummaryInFlight = false;
  }
  return liveBulletPoints;
}

/**
 * Kiểm tra nhanh xem lượt nói vừa rồi có phải là câu hỏi phỏng vấn / chất vấn của đối tác không
 * để rút ngắn thời gian phản hồi Q&A Copilot.
 */
export function isQuestionLikeUtterance(text = "") {
  const s = String(text || "").trim();
  if (!s) return false;
  if (s.includes("?")) return true;
  return /\b(what|why|how|when|where|who|which|could you|can you|would you|tell me|explain|describe|là gì|như thế nào|tại sao|vì sao|khi nào|ở đâu|cho hỏi|giải thích|trình bày|so sánh)\b/i.test(s);
}
export async function toggleLiveTranscriber() {
  if (liveTranscriber && (liveTranscriber.state === "starting" || liveTranscriber.state === "stopping")) {
    return { status: "error", error: "Đang xử lý, vui lòng đợi." };
  }

  if (!liveTranscriber || liveTranscriber.state === "dead") {
    const pythonPath = resolvePythonCommand(); // BUGFIX-SIDECAR-PYCMD-01
    const scriptPath = path.join(unpackedRepoRoot(), "assets", "sidecar", "live_transcriber.py");

    liveTranscriber = spawnSidecar(pythonPath, [scriptPath], {
      cwd: unpackedRepoRoot(),
      onFatalError: (message) => {
        if (mainWindow) {
          mainWindow.webContents.send("hud:message", { title: "Lỗi Live Teleprompter", content: message });
        }
      },
    });
    liveTranscripts = [];
    allSessionTranscripts = [];
    liveBulletPoints = [];
    copilotBuffer = [];
    copilotHistory = [];
    copilotStatus = "";
    if (copilotTimer) clearTimeout(copilotTimer);

    // L-01: transcript là dữ liệu cá nhân + repoRoot chỉ-đọc khi đóng gói => ghi vào userData.
    const logDir = path.join(userDataDir(), "teleprompter_logs");
    fs.mkdirSync(logDir, { recursive: true });
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    liveLogStream = fs.createWriteStream(path.join(logDir, `transcript_${ts}.txt`), { flags: 'a' });
    liveLogStream.write(`=== Phiên dịch & Nhắc bài (${ts}) ===\n(Bao gồm lời của bạn và người đối diện)\n\n`);

    const updateLiveHud = () => updateTeleprompterHud();

    enterHud();
    if (hudClearTimer) {
      clearTimeout(hudClearTimer);
      hudClearTimer = null;
    }
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents?.isDestroyed?.()) {
      mainWindow.webContents.send("hud:message", { title: "Live Teleprompter", content: "Đang khởi động AI dịch thuật... (Bấm Alt+T để tắt)" });
    }

    liveTranscriber.proc.stdout.on("data", (data) => {
      const output = data.toString();
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.includes("[TRANSCRIPT]")) {
          const text = line.split("[TRANSCRIPT]")[1].trim();
          if (text) {
             // Mốc thời gian lúc transcript được CHỐT (sidecar mới chỉ in
             // dòng này khi Deepgram báo is_final+speech_final/UtteranceEnd —
             // tức "ngay sau khi nói xong", không còn đợi đủ 4s cố định).
             // Dùng để đo độ trễ dịch thật, ghi vào log — không hiển thị lên
             // HUD để không đổi UX hiện có.
             const finalizedAt = Date.now();

             if (liveLogStream) {
               liveLogStream.write(`${text}\n`);
             }
             liveTranscripts.push(text);
             if (liveTranscripts.length > 3) liveTranscripts.shift();

             const speakerMatch = text.match(/^\[(Bạn|Đối tác|Chung)\]/);
             const transcriptEntry = {
               time: new Date().toLocaleTimeString("vi-VN"),
               speaker: speakerMatch ? speakerMatch[1] : "Chung",
               text,
               translation: "",
             };
             allSessionTranscripts.push(transcriptEntry);
             if (allSessionTranscripts.length % 3 === 0) {
               refreshRealtimeBulletPoints().catch(() => {});
             }

             // FEAT-TELEPROMPTER-INTERVIEW-01: Dịch — mỗi dòng transcript mới
             // được dịch sang translateTargetLang ngay khi bật, độc lập với
             // Nhắc bài (2 chế độ loại trừ nhau ở toggleCopilotMode/toggleTranslateMode).
             //
             // NÂNG CẤP: kèm theo 1-2 câu ngữ cảnh gần nhất (tái dùng
             // liveTranscripts, vốn đã giữ tối đa 3 dòng gần nhất cho HUD —
             // không thêm biến trạng thái mới) thay vì gửi đúng 1 dòng trơ
             // trọi như bản cũ. Giúp Claude dịch đúng đại từ/ý được nhắc ở
             // câu trước, đặc biệt khi người nói liên tục nhiều câu vắt qua
             // nhiều lần chốt transcript. Yêu cầu rõ ràng: chỉ dịch câu MỚI,
             // không dịch lại phần ngữ cảnh.
             if (translateEnabled) {
               (async () => {
                 try {
                   const priorLines = liveTranscripts.slice(0, -1);
                   const userText = priorLines.length
                     ? `Ngữ cảnh gần đây (CHỈ để tham khảo, KHÔNG dịch lại):\n${priorLines.join("\n")}\n\nCâu MỚI cần dịch:\n${text}`
                     : text;
                   const sysPrompt = `Bạn là công cụ dịch song song thời gian thực. Dịch CÂU MỚI (đánh dấu rõ trong tin nhắn, nếu có) sang ngôn ngữ "${translateTargetLang}", dựa vào ngữ cảnh phía trên (nếu có) để dịch đúng đại từ/ý được nhắc ở câu trước. ` +
                       `CHỈ trả về bản dịch của CÂU MỚI — không dịch lại phần ngữ cảnh, không giải thích, không thêm gì khác. Giữ nguyên các tiền tố [Bạn]/[Đối tác]/[Chung] ở đầu câu MỚI nếu có, chỉ dịch phần nội dung sau tiền tố.`;

                   const hasGeminiKeys = getAllGeminiKeys({ purpose: "teleprompter" }).length > 0 || Boolean(ai);
                   if (hasGeminiKeys) {
                     currentStreamingTranslation = "⏳...";
                     updateLiveHud();
                     let fullText = "";
                     if (getAllGeminiKeys({ purpose: "teleprompter" }).length > 0) {
                       await withGeminiFailover(
                         async (apiKey) => {
                           fullText = "";
                           const client = getGenAiClient(apiKey);
                           let streamErr = null;
                           for (const m of TELEPROMPTER_CANDIDATE_MODELS) {
                             try {
                               const responseStream = await client.models.generateContentStream({
                                 model: m,
                                 contents: sysPrompt + "\n\n" + userText,
                               });
                               for await (const chunk of responseStream) {
                                 if (chunk.text) {
                                   fullText += chunk.text;
                                   currentStreamingTranslation = fullText.trim();
                                   updateLiveHud();
                                 }
                               }
                               return;
                             } catch (err) {
                               streamErr = err;
                               if (isRateLimitError(err)) {
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
                           if (streamErr) throw streamErr;
                         },
                         { purpose: "teleprompter" }
                       );
                     } else if (ai) {
                       const responseStream = await ai.models.generateContentStream({
                         model: "gemini-flash-latest",
                         contents: sysPrompt + "\n\n" + userText,
                       });
                       for await (const chunk of responseStream) {
                         if (chunk.text) {
                           fullText += chunk.text;
                           currentStreamingTranslation = fullText.trim();
                           updateLiveHud();
                         }
                       }
                     }

                     currentStreamingTranslation = "";
                     if (fullText.trim()) {
                       transcriptEntry.translation = fullText.trim();
                       liveTranslations.push(fullText.trim());
                       if (liveTranslations.length > 3) liveTranslations.shift();
                       if (liveLogStream) {
                         const latencyMs = Date.now() - finalizedAt;
                         liveLogStream.write(`[Dịch Flash -> ${translateTargetLang}] (⏱ ${latencyMs}ms): ${fullText.trim()}\n`);
                       }
                     }
                     updateLiveHud();
                   }
                   if (liveTranslations.length === 0 || !hasGeminiKeys) {
                     const claudeKey = (process.env.ANTHROPIC_API_KEY || process.env.IRIS_TELEPROMPTER_ANTHROPIC_KEY || "").trim();
                     if (claudeKey) {
                       currentStreamingTranslation = "⏳...";
                       updateLiveHud();
                       const translated = await callClaudeForTeleprompter(sysPrompt, userText, { maxTokens: 300 });
                       currentStreamingTranslation = "";
                       if (translated) {
                         transcriptEntry.translation = translated;
                         liveTranslations.push(translated);
                         if (liveTranslations.length > 3) liveTranslations.shift();
                         if (liveLogStream) {
                           const latencyMs = Date.now() - finalizedAt;
                           liveLogStream.write(`[Dịch Claude -> ${translateTargetLang}] (⏱ ${latencyMs}ms): ${translated}\n`);
                         }
                         updateLiveHud();
                       }
                     }
                   }
                 } catch (e) {
                   currentStreamingTranslation = "";
                   liveTranslations.push(`⚠️ Lỗi dịch: ${e.message}`);
                   if (liveTranslations.length > 3) liveTranslations.shift();
                   updateLiveHud();
                 }
               })();
             }

             if (!copilotEnabled) {
               updateLiveHud();
               return;
             }

             // AI Copilot Logic ("Nhắc bài") — buffer vài dòng transcript gần
             // nhất (cả [Bạn] lẫn [Đối tác]; mic KHÔNG còn bị tự tắt nữa) làm
             // ngữ cảnh, đợi 3s im lặng rồi hỏi Claude xem có câu hỏi nào cần
             // gợi ý trả lời không. Mỗi gợi ý thật sự (khác "NONE") được PUSH
             // vào copilotHistory kèm nguyên văn ngữ cảnh đã dùng — không còn
             // ghi đè lên 1 biến duy nhất — để không mất câu hỏi cũ khi có
             // câu hỏi mới, và HudShell render thành danh sách cuộn + tìm
             // kiếm được.
             copilotBuffer.push(text);
             if (copilotBuffer.length > 10) copilotBuffer.shift();
             
             if (copilotTimer) clearTimeout(copilotTimer);
             
             // Nếu câu vừa chốt là câu hỏi của [Đối tác] hoặc có dấu hỏi/từ để hỏi -> phản hồi tức thì (900ms), ngược lại 1800ms
             const isPartnerQuestion = text.startsWith("[Đối tác]") && isQuestionLikeUtterance(text);
             const debounceMs = isPartnerQuestion ? 900 : (isQuestionLikeUtterance(text) ? 1200 : 1800);

             copilotTimer = setTimeout(async () => {
               const contextText = copilotBuffer.join("\n");
               if (!contextText.trim()) return;
               
               copilotStatus = "💡 Đang phân tích ngữ cảnh & suy nghĩ...";
               updateLiveHud();

               // Tự động kết hợp ngữ cảnh màn hình (slide/tài liệu/code đang mở) với câu hỏi của đối phương
               const autoVisionEnabled = envFlag("IRIS_COPILOT_AUTO_VISION", true);
               let activeWinHeader = "";
               let copilotScreenBase64 = null;
               if (autoVisionEnabled) {
                 try {
                   const [winInfo, grabbed] = await Promise.all([
                     typeof activeWindowInfoTool === "function" ? activeWindowInfoTool().catch(() => null) : Promise.resolve(null),
                     grabPrimaryScreenJpeg(65).catch(() => null),
                   ]);
                   if (winInfo?.title) {
                     activeWinHeader = `\n[Ngữ cảnh cửa sổ/tài liệu đang mở trên màn hình: "${winInfo.title}" (${winInfo.process_name || "app"})]`;
                   }
                   if (grabbed?.buffer && Buffer.isBuffer(grabbed.buffer)) {
                     copilotScreenBase64 = grabbed.buffer.toString("base64");
                   }
                 } catch {}
               }

               const systemPrompt =
                 "Bạn là trợ lý chiến lược & Q&A Copilot thời gian thực hỗ trợ tôi trong phỏng vấn, thuyết trình hoặc đàm phán quan trọng (hỗ trợ song ngữ Anh - Việt mượt mà). " +
                 "Bạn nhận được đoạn hội thoại gần nhất (giọng của tôi: [Bạn], giọng đối tác: [Đối tác]) KÈM ngữ cảnh màn hình/tài liệu đang mở (nếu có). " +
                 "Nếu đối tác vừa hỏi (bằng tiếng Anh hoặc tiếng Việt) hoặc nêu vấn đề liên quan tới cuộc trò chuyện hay slide/tài liệu trên màn hình, hãy cung cấp ngay câu trả lời gợi ý SẮC BÉN, chính xác và thuyết phục nhất (nếu câu hỏi bằng tiếng Anh, hãy gợi ý câu trả lời tiếng Anh kèm tóm tắt ý tiếng Việt ngắn gọn). " +
                 "Trình bày dưới dạng 1-3 gạch đầu dòng (bullet points) siêu ngắn gọn để tôi liếc HUD tàng hình và nói lại được ngay lập tức. " +
                 "Nếu chưa có gì đáng trả lời (tôi đang tự nói hoặc chuyện phiếm), trả về đúng 1 chữ 'NONE'." +
                 activeWinHeader;

               let suggestion = "";
               let engineUsed = "Claude";
               try {
                 // Nếu có ảnh chụp slide/tài liệu màn hình và có Gemini Vision key, ưu tiên kết hợp đa phương thức (Screen + Audio Question)
                 if (copilotScreenBase64 && (getAllGeminiKeys({ purpose: "teleprompter" }).length > 0 || ai)) {
                   const response = getAllGeminiKeys({ purpose: "teleprompter" }).length > 0
                     ? await withGeminiFailover(
                         async (apiKey) => {
                           const client = getGenAiClient(apiKey);
                           let lastErr = null;
                           for (const m of TELEPROMPTER_CANDIDATE_MODELS) {
                             try {
                               return await client.models.generateContent({
                                 model: m,
                                 contents: [
                                   { inlineData: { mimeType: "image/jpeg", data: copilotScreenBase64 } },
                                   { text: systemPrompt + "\n\nĐoạn hội thoại gần nhất:\n" + contextText },
                                 ],
                               });
                             } catch (err) {
                               lastErr = err;
                               if (isRateLimitError(err)) continue;
                               const errMsg = String(err?.message || "");
                               const errStatus = err?.status ?? err?.code ?? err?.httpStatus;
                               if (errStatus === 404 || errStatus === 400 || /no longer available|not found|404|NOT_FOUND|deprecated|is not supported|invalid argument/i.test(errMsg)) continue;
                               throw err;
                             }
                           }
                           throw lastErr || new Error("Không thể gọi Gemini Multimodal Copilot.");
                         },
                         { purpose: "teleprompter" }
                       )
                     : await ai.models.generateContent({
                         model: "gemini-flash-latest",
                         contents: [
                           { inlineData: { mimeType: "image/jpeg", data: copilotScreenBase64 } },
                           { text: systemPrompt + "\n\nĐoạn hội thoại gần nhất:\n" + contextText },
                         ],
                       });
                   suggestion = (response?.text || "").trim();
                   engineUsed = "Gemini Vision Copilot";
                 } else {
                   suggestion = await callClaudeForTeleprompter(systemPrompt, contextText, { maxTokens: 350 });
                 }
               } catch (claudeErr) {
                 // Chưa cấu hình IRIS_TELEPROMPTER_ANTHROPIC_KEY (hoặc lỗi mạng) ->
                 // fallback sang Gemini để tính năng luôn hoạt động
                 emitEvent({ type: "log", level: "warn", message: `Nhắc bài: chuyển sang Gemini dự phòng (${claudeErr.message}).` });
                 if (getAllGeminiKeys({ purpose: "teleprompter" }).length === 0 && !ai) { copilotStatus = ""; updateLiveHud(); return; }
                 try {
                   const contentsPayload = copilotScreenBase64
                     ? [
                         { inlineData: { mimeType: "image/jpeg", data: copilotScreenBase64 } },
                         { text: systemPrompt + "\n\n" + contextText },
                       ]
                     : systemPrompt + "\n\n" + contextText;
                   const response = getAllGeminiKeys({ purpose: "teleprompter" }).length > 0
                     ? await withGeminiFailover(
                         async (apiKey) => {
                           const client = getGenAiClient(apiKey);
                           let lastErr = null;
                           for (const m of TELEPROMPTER_CANDIDATE_MODELS) {
                             try {
                               return await client.models.generateContent({
                                 model: m,
                                 contents: contentsPayload,
                               });
                             } catch (err) {
                               lastErr = err;
                               if (isRateLimitError(err)) {
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
                           throw lastErr || new Error("Không thể gọi Gemini Copilot.");
                         },
                         { purpose: "teleprompter" }
                       )
                     : await (async () => {
                         let lastErr = null;
                         for (const m of TELEPROMPTER_CANDIDATE_MODELS) {
                           try {
                             return await ai.models.generateContent({
                               model: m,
                               contents: contentsPayload,
                             });
                           } catch (err) {
                             lastErr = err;
                             if (isRateLimitError(err)) {
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
                         throw lastErr || new Error("Không thể gọi Gemini Copilot.");
                       })();
                   suggestion = (response?.text || "").trim();
                   engineUsed = copilotScreenBase64 ? "Gemini Vision (fallback)" : "Gemini (fallback)";
                 } catch (geminiErr) {
                   copilotStatus = "";
                   updateLiveHud();
                   return;
                 }
               }

               suggestion = suggestion.trim();
               if (suggestion && suggestion !== "NONE") {
                 copilotHistory.push({
                   id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                   question: contextText.length > 400 ? `…${contextText.slice(-400)}` : contextText,
                   answer: suggestion,
                   ts: Date.now(),
                   engine: engineUsed,
                 });
                 if (copilotHistory.length > COPILOT_HISTORY_MAX) copilotHistory.shift();
                 copilotStatus = "";
                 if (liveLogStream) {
                   liveLogStream.write(`[AI Gợi ý - ${engineUsed}]: ${suggestion}\n\n`);
                 }
               } else {
                 copilotStatus = "💡 (Đang lắng nghe...)";
               }
               updateLiveHud();
             }, debounceMs);
             
             updateLiveHud();
          }
        } else if (line.includes("READY")) {
           if (mainWindow) {
             mainWindow.webContents.send("hud:message", { title: "Live Teleprompter", content: "Đã sẵn sàng. Bắt đầu nói chuyện..." });
           }
        }
      }
    });

    liveTranscriber.proc.stderr.on("data", (data) => console.error(`Live Transcriber Err: ${data}`));
    return { status: "success", message: "Bắt đầu Nhắc Tuồng." };
  }

  // --- Dừng ---
  // BUG-TELE-01 FIX: giữ nguyên `liveTranscriber` (đừng null ngay) và để
  // stopSidecar tự đặt state = "stopping" trên chính handle đó, rồi AWAIT
  // cho tới khi sidecar thật sự thoát mới null hoá + dọn log. Bản gốc null
  // hoá liveTranscriber NGAY LẬP TỨC rồi mới gọi stopSidecar() (không
  // await) — nghĩa là guard "starting/stopping" ở đầu hàm không còn thấy
  // gì để chặn, nên bấm Alt+T lần nữa trong lúc process cũ đang tắt (tối đa
  // 3s) sẽ spawn THÊM một live_transcriber.py thứ hai chồng lên, tranh mic
  // với process cũ — và vì liveLogStream/liveTranscripts là biến module
  // dùng chung, các dòng TRANSCRIPT cuối cùng của phiên cũ (đến trễ) bị ghi
  // nhầm vào log/HUD của phiên MỚI.
  if (liveLogStream) {
    liveLogStream.write("\n=== Kết thúc phiên ===\n");
    liveLogStream.end();
    liveLogStream = null;
  }

  enterHud();
  if (hudClearTimer) {
    clearTimeout(hudClearTimer);
    hudClearTimer = null;
  }
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents?.isDestroyed?.()) {
    mainWindow.webContents.send("hud:message", { title: "Live Teleprompter", content: "Đã tắt tính năng Nhắc Tuồng." });
    hudClearTimer = setTimeout(() => {
      hudClearTimer = null;
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents?.isDestroyed?.()) {
        mainWindow.webContents.send("hud:message", null);
      }
    }, 2000);
  }

  await stopSidecar(liveTranscriber, { timeoutMs: 3000 }); // luôn resolve, không treo vô hạn
  liveTranscriber = null;
  liveTranscripts = [];
  copilotBuffer = [];
  copilotHistory = [];
  copilotStatus = "";
  if (copilotTimer) clearTimeout(copilotTimer);
  liveTranslations = [];
  currentStreamingTranslation = "";
  translateEnabled = false;
  translateTargetLang = "";
  // Tắt cả Alt+T thì Nhắc bài cũng coi như tắt theo. Không còn gửi
  // "teleprompter:force-mic" (đã bỏ cơ chế tự tắt/mở mic laptop).
  copilotEnabled = false;

  return { status: "success", message: "Đã tắt Nhắc Tuồng." };
}

export async function askTeleprompter(question) {
  const options = arguments.length > 1 && arguments[1] ? arguments[1] : {};
  const { cropRect, imageBase64, isFullScreen: isFullScreenOpt, hideUntilResolved } = (typeof options === "object" && options !== null) ? options : {};
  if (!question || typeof question !== "string" || !question.trim()) {
    return { status: "error", error: "Câu hỏi không được để trống." };
  }
  const cleanQ = question.trim();

  // Đảm bảo kích hoạt chế độ nhắc bài
  copilotEnabled = true;
  if (!hideUntilResolved) {
    enterHud();
  }

  const contextText = copilotBuffer.length > 0
    ? copilotBuffer.join("\n")
    : (liveTranscripts.length > 0 ? liveTranscripts.join("\n") : "(Chưa có nội dung phiên âm)");

  const systemPrompt =
    "Bạn là trợ lý AI thông minh trong cuộc họp và hỗ trợ công việc. " +
    "Dựa vào nội dung cuộc họp hoặc ảnh chụp màn hình hiện tại (nếu có), hãy trả lời câu hỏi của người dùng thật súc tích, chính xác và trực tiếp.\n\n" +
    "Nội dung phiên âm cuộc họp gần nhất:\n" + contextText;

  // Chế độ Vision (Alt+S): đọc trạng thái qua import tĩnh (không dùng `await import()` — dynamic import làm vỡ test VM sandbox). `typeof` an toàn trong sandbox test.
  const isVisionSnapMode = typeof getVisionSnapMode === "function" ? Boolean(getVisionSnapMode()) : false;
  // Alt+S BẬT mà không có vùng khoanh/ảnh sẵn ⇒ chụp TOÀN MÀN HÌNH mới nhất cho mỗi câu hỏi.
  const isFullScreen = Boolean(isFullScreenOpt || (isVisionSnapMode && !cropRect && !imageBase64));
  const isVisionQuery = Boolean(cropRect || imageBase64 || isFullScreen);
  const claudeKey = (process.env.ANTHROPIC_API_KEY || process.env.IRIS_TELEPROMPTER_ANTHROPIC_KEY || "").trim();

  copilotStatus = isVisionQuery
    ? (isFullScreen ? "📸 Đang phân tích toàn màn hình với Gemini Vision..." : "📸 Đang phân tích vùng khoanh với Gemini Vision...")
    : (claudeKey ? "⏳ Đang gửi câu hỏi tới Claude..." : "⏳ Đang gửi câu hỏi tới AI...");

  if (!hideUntilResolved) {
    updateTeleprompterHud();
  }

  let answer = "";
  let engineUsed = isVisionQuery ? "Gemini Vision" : (claudeKey ? "Claude" : "Gemini");
  let claudeError = null;

  // 1. Ưu tiên gọi Claude API trước (nếu là câu hỏi văn bản thuần không kèm vùng khoanh màn hình)
  if (claudeKey && !isVisionQuery) {
    try {
      answer = await callClaudeForTeleprompter(systemPrompt, cleanQ, { maxTokens: 600 });
      engineUsed = "Claude";
    } catch (err) {
      claudeError = err;
      console.warn("[askTeleprompter] Claude API thất bại, chuyển sang Gemini:", err.message);
    }
  } else {
    claudeError = null;
  }

  // 2. Dự phòng: Không có key Claude hoặc Claude lỗi, hoặc câu hỏi Vision => dùng Gemini
  if (!answer) {
    copilotStatus = isVisionQuery
      ? (isFullScreen ? "📸 Đang chụp màn hình & phân tích với Gemini Vision..." : "📸 Đang chụp vùng khoanh & phân tích với Gemini Vision...")
      : "⏳ Đang suy nghĩ câu trả lời...";
    updateTeleprompterHud();

    const usePoolFailover = typeof withGeminiFailover === "function" && typeof getAllGeminiKeys === "function";
    const geminiClient = usePoolFailover ? null : await getGeminiVisionClient();
    const hasKey = usePoolFailover
      ? getAllGeminiKeys({ purpose: isVisionQuery ? "vision" : "teleprompter", preferVision: isVisionQuery }).length > 0
      : Boolean(geminiClient);
    if (!hasKey) {
      copilotStatus = "";
      updateTeleprompterHud();
      const prefix = claudeError ? `Claude: ${claudeError.message}. ` : "";
      return {
        status: "error",
        error: `${prefix}Gemini chưa được cấu hình (thiếu GEMINI_API_KEY hoặc GEMINI_VISION_API_KEY).`
      };
    }

    let screenBase64 = imageBase64 || null;
    let teleOmniElements = "";
    try {
      // Chỉ chụp màn hình khi có yêu cầu Vision (khoanh vùng hoặc toàn màn hình).
      // Khi ấn Enter hỏi thông thường => KHÔNG chụp màn hình, trả lời trực tiếp bằng text.
      if (isVisionQuery && !screenBase64) {
        try {
          const grabbed = await grabPrimaryScreenJpeg(75, { cropRect });
          if (grabbed?.buffer && Buffer.isBuffer(grabbed.buffer)) {
            screenBase64 = grabbed.buffer.toString("base64");
            if (!cropRect && envFlag("IRIS_OMNI_AUTO_ANNOTATE", false)) {
              try {
                const { annotateWithOmniParser } = await import("../computer-session.mjs");
                const omniRes = await annotateWithOmniParser(screenBase64, grabbed.geometry?.screen_w || 1920, grabbed.geometry?.screen_h || 1080);
                if (omniRes?.annotated && omniRes?.base64) {
                  screenBase64 = omniRes.base64;
                  if (omniRes.elementsText) {
                    teleOmniElements = omniRes.elementsText;
                  }
                }
              } catch (oErr) {
                console.warn("[askTeleprompter] Omni auto-annotate error:", oErr.message);
              }
            }
          }
        } catch (grabErr) {
          console.warn("[askTeleprompter] Không thể chụp màn hình cho Gemini Vision:", grabErr.message);
        }
      }

      const candidateModels = Array.from(
        new Set(
          [
            String((isVisionQuery ? process.env.GEMINI_VISION_MODEL : process.env.GEMINI_TEXT_MODEL) || "").trim(),
            "gemini-2.0-flash",
            "gemini-flash-latest",
            "gemini-flash-lite-latest",
            "gemini-2.5-flash",
          ].filter(Boolean)
        )
      );

      const prompt =
        `${systemPrompt}\n\n` +
        (screenBase64 ? (cropRect ? "Lưu ý: Đã đính kèm ảnh chụp VÙNG CHỌN màn hình người dùng vừa khoanh để bạn quan sát tập trung.\n\n" : "Lưu ý: Đã đính kèm ảnh chụp màn hình hiện tại để bạn quan sát ngữ cảnh ứng dụng/tài liệu đang mở.\n\n") : "") +
        (teleOmniElements ? `${teleOmniElements}\n\n` : "") +
        `Câu hỏi của người dùng: ${cleanQ}`;

      const contents = [];
      if (screenBase64) {
        contents.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: screenBase64,
          },
        });
      }
      contents.push({ text: prompt });

      const invokeVision = async (client) => {
        let lastErr = null;
        for (const modelToTry of candidateModels) {
          let geminiTimer = null;
          try {
            return await Promise.race([
              client.models.generateContent({
                model: modelToTry,
                contents,
              }),
              new Promise((_, reject) => {
                geminiTimer = setTimeout(() => reject(new Error("Gemini quá thời gian chờ (25s)")), 25000);
              }),
            ]);
          } catch (modelErr) {
            lastErr = modelErr;
            if (isRateLimitError(modelErr)) {
              continue;
            }
            const modelErrMsg = String(modelErr?.message || "");
            const modelErrStatus = modelErr?.status ?? modelErr?.code ?? modelErr?.httpStatus;
            if (
              modelErrStatus === 404 ||
              modelErrStatus === 400 ||
              /no longer available|not found|404|NOT_FOUND|deprecated|is not supported|invalid argument/i.test(modelErrMsg)
            ) {
              continue;
            }
            throw modelErr;
          } finally {
            if (geminiTimer) clearTimeout(geminiTimer);
          }
        }
        throw lastErr || new Error("Không thể kết nối tới các model Gemini.");
      };

      const res = usePoolFailover
        ? await withGeminiFailover(
            async (apiKey) => {
              const client = await getGeminiVisionClient(apiKey);
              if (!client) throw new Error("Không có Gemini client khả dụng.");
              return invokeVision(client);
            },
            {
              purpose: isVisionQuery ? "vision" : "teleprompter",
              preferVision: isVisionQuery,
              onFailover: ({ failedKey, attempt, maxRetries }) => {
                const masked = failedKey.length > 8 ? `...${failedKey.slice(-4)}` : failedKey;
                copilotStatus = `Key (${masked}) chạm hạn mức, đang tự động đổi sang key ${attempt + 1}/${maxRetries}...`;
                updateTeleprompterHud();
              },
            }
          )
        : await invokeVision(geminiClient);

      answer = (res?.text || "").trim();
      engineUsed = screenBase64 ? "Gemini Vision" : "Gemini";
    } catch (gErr) {
      copilotStatus = "";
      updateTeleprompterHud();
      const prefix = claudeError ? `Claude: ${claudeError.message}. ` : "";
      let cleanMsg = gErr?.message || String(gErr);
      try {
        const parsed = JSON.parse(cleanMsg);
        if (parsed?.error?.message) cleanMsg = parsed.error.message;
      } catch {}
      if (/high demand|UNAVAILABLE|503/i.test(cleanMsg)) {
        cleanMsg = "Máy chủ Gemini đang quá tải tạm thời (503 High Demand). Vui lòng thử lại sau vài giây.";
      } else if (/quota|RESOURCE_EXHAUSTED|429/i.test(cleanMsg)) {
        cleanMsg = "Toàn bộ API key Gemini trong kho đều đã chạm hạn mức ngày (429 Quota Exceeded). Vui lòng thêm key mới vào .env hoặc thử lại sau khi Google reset quota.";
      }
      return {
        status: "error",
        error: `${prefix}Gemini${screenBase64 ? " Vision" : ""}: ${cleanMsg}`,
      };
    }
  }

  if (answer) {
    copilotHistory.push({
      id: `${Date.now()}-qna`,
      question: `🔎 (Hỏi trực tiếp): ${cleanQ}`,
      answer: answer,
      ts: Date.now(),
      engine: engineUsed,
    });
    if (copilotHistory.length > COPILOT_HISTORY_MAX) {
      copilotHistory.shift();
    }
  }

  copilotStatus = "";
  updateTeleprompterHud();
  return { status: "success", answer, engine: engineUsed };
}
