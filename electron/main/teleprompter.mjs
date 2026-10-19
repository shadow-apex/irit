/**
 * electron/main/teleprompter.mjs
 *
 * Live transcriber / copilot-mode / translate-mode HUD features: streaming
 * mic+system audio through the Python sidecar, asking Claude for copilot
 * suggestions, and pushing live captions to the Glass HUD.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSidecar, stopSidecar, resolvePythonCommand } from "./sidecar-process.mjs";
import { emitEvent } from "./events.mjs";
import { mainWindow } from "./window-manager.mjs";
import { enterHud } from "./window-manager.mjs";
import { ai } from "./gemini-live.mjs";
import { userDataDir, unpackedRepoRoot } from "./paths.mjs";
import { grabPrimaryScreenJpeg } from "./vision.mjs";
import { getAllGeminiKeys, getGenAiClient, getNextGeminiKey, withGeminiFailover, isRateLimitError } from "./gemini-keys.mjs";

const TELEPROMPTER_CANDIDATE_MODELS = Array.from(
  new Set(
    [
      String(process.env.GEMINI_TRANSLATE_MODEL || "").trim(),
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-2.5-flash",
      "gemini-flash-latest",
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

async function getGenAi(apiKey) {
  const client = getGenAiClient(apiKey);
  if (client) return client;
  if (ai) return ai;
  return null;
}

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
  if (!apiKey) {
    throw new Error(
      "Thiếu ANTHROPIC_API_KEY trong cấu hình / .env — chưa cấu hình API key Claude."
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
    if (copilotEnabled) {
      copilotEnabled = false;
      copilotStatus = "";
      if (copilotTimer) clearTimeout(copilotTimer);
    }
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
    // Lịch sử gợi ý KHÔNG bị xoá khi tắt — chỉ ẩn khỏi HUD (updateTeleprompterHud
    // không gửi copilotHistory khi copilotEnabled=false). Bật lại trong cùng
    // phiên Alt+T sẽ thấy lại toàn bộ câu hỏi/gợi ý cũ, không bị mất.
  } else {
    copilotStatus = "💡 Nhắc bài đã BẬT — đang lắng nghe.";
    // Dịch và Nhắc bài loại trừ nhau (1 khung nhỏ, tránh gọi 2 luồng API
    // song song trên cùng transcript) — tắt Dịch nếu đang bật.
    if (translateEnabled) {
      translateEnabled = false;
      translateTargetLang = "";
      liveTranslations = [];
    }
  }

  // Đã bỏ hẳn cơ chế tự tắt/mở mic laptop (trước đây gửi
  // "teleprompter:force-mic" mỗi khi bật/tắt Nhắc bài). Nhắc bài giờ CHỈ
  // hiển thị gợi ý minh bạch trên HUD — không tự ý đổi trạng thái mic. Nút
  // mic thủ công trên HUD hoạt động độc lập hoàn toàn với tính năng này.

  if (liveTranscriber && mainWindow) {
    updateTeleprompterHud();
  }
  
  return { status: "success", message: `Nhắc bài: ${copilotEnabled ? "ON" : "OFF"}` };
}

export async function toggleLiveTranscriber() {
  if (liveTranscriber && (liveTranscriber.state === "starting" || liveTranscriber.state === "stopping")) {
    return { status: "error", error: "Đang xử lý, vui lòng đợi." };
  }

  if (!liveTranscriber || liveTranscriber.state === "dead") {
    const pythonPath = resolvePythonCommand(); // BUGFIX-SIDECAR-PYCMD-01
    const scriptPath = path.join(unpackedRepoRoot(), "sidecar", "live_transcriber.py");

    liveTranscriber = spawnSidecar(pythonPath, [scriptPath], {
      cwd: unpackedRepoRoot(),
      onFatalError: (message) => {
        if (mainWindow) {
          mainWindow.webContents.send("hud:message", { title: "Lỗi Live Teleprompter", content: message });
        }
      },
    });
    liveTranscripts = [];
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
                               if (isRateLimitError(err) || /503|UNAVAILABLE|high demand/i.test(err?.message || "")) {
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
             
             copilotTimer = setTimeout(async () => {
               // Nối bằng "\n" thay vì " " (bản cũ) để ranh giới lượt nói
               // [Bạn]/[Đối tác] rõ ràng hơn khi Claude đọc — tránh dồn cả
               // đoạn hội thoại thành một câu dài dính liền nhau. Chỉ đổi
               // format prompt nội bộ, không đổi hành vi người dùng thấy.
               const contextText = copilotBuffer.join("\n");
               if (!contextText.trim()) return;
               
               copilotStatus = "💡 Đang suy nghĩ...";
               updateLiveHud();

               const systemPrompt =
                 "Bạn là trợ lý chiến lược (Meeting Copilot) hỗ trợ tôi trong các cuộc họp hoặc đàm phán quan trọng. " +
                 "Bạn sẽ nhận đoạn transcript gần nhất (giọng của tôi: [Bạn], giọng đối tác: [Đối tác]). " +
                 "Nếu đối tác vừa hỏi hoặc đưa ra vấn đề cần phản hồi, hãy cung cấp ngay các luận điểm trả lời SẮC BÉN, thông minh và thuyết phục nhất. " +
                 "Trình bày dưới dạng 1-3 gạch đầu dòng (bullet points) siêu ngắn gọn để tôi có thể liếc kính HUD và nói lại được ngay lập tức. " +
                 "Nếu chưa có gì đáng trả lời (tôi đang tự nói hoặc chuyện phiếm), trả về đúng 1 chữ 'NONE'.";

               let suggestion = "";
               let engineUsed = "Claude";
               try {
                 suggestion = await callClaudeForTeleprompter(systemPrompt, contextText, { maxTokens: 300 });
               } catch (claudeErr) {
                 // Chưa cấu hình IRIS_TELEPROMPTER_ANTHROPIC_KEY (hoặc lỗi mạng) ->
                 // fallback tạm sang Gemini (đã có sẵn) để tính năng không bị câm,
                 // đồng thời báo rõ lý do trong log để người dùng biết cần cấu hình.
                 emitEvent({ type: "log", level: "warn", message: `Nhắc bài: gọi Claude thất bại (${claudeErr.message}), fallback sang Gemini.` });
                 if (getAllGeminiKeys({ purpose: "teleprompter" }).length === 0 && !ai) { copilotStatus = ""; updateLiveHud(); return; }
                 try {
                   const response = getAllGeminiKeys({ purpose: "teleprompter" }).length > 0
                     ? await withGeminiFailover(
                         async (apiKey) => {
                           const client = getGenAiClient(apiKey);
                           let lastErr = null;
                           for (const m of TELEPROMPTER_CANDIDATE_MODELS) {
                             try {
                               return await client.models.generateContent({
                                 model: m,
                                 contents: systemPrompt + "\n\n" + contextText,
                               });
                             } catch (err) {
                               lastErr = err;
                               if (isRateLimitError(err) || /503|UNAVAILABLE|high demand/i.test(err?.message || "")) {
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
                               contents: systemPrompt + "\n\n" + contextText,
                             });
                           } catch (err) {
                             lastErr = err;
                             if (isRateLimitError(err) || /503|UNAVAILABLE|high demand/i.test(err?.message || "")) {
                               continue;
                             }
                             throw err;
                           }
                         }
                         throw lastErr || new Error("Không thể gọi Gemini Copilot.");
                       })();
                   suggestion = (response?.text || "").trim();
                   engineUsed = "Gemini (fallback)";
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
             }, 3000);
             
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
  if (!question || typeof question !== "string" || !question.trim()) {
    return { status: "error", error: "Câu hỏi không được để trống." };
  }
  const cleanQ = question.trim();

  // Đảm bảo mở HUD và kích hoạt chế độ nhắc bài để hiển thị kết quả
  copilotEnabled = true;
  enterHud();

  const contextText = copilotBuffer.length > 0
    ? copilotBuffer.join("\n")
    : (liveTranscripts.length > 0 ? liveTranscripts.join("\n") : "(Chưa có nội dung phiên âm)");

  const systemPrompt =
    "Bạn là trợ lý AI thông minh trong cuộc họp và hỗ trợ công việc. " +
    "Dựa vào nội dung cuộc họp hoặc ảnh chụp màn hình hiện tại (nếu có), hãy trả lời câu hỏi của người dùng thật súc tích, chính xác và trực tiếp.\n\n" +
    "Nội dung phiên âm cuộc họp gần nhất:\n" + contextText;

  copilotStatus = "⏳ Đang gửi câu hỏi tới Claude...";
  updateTeleprompterHud();

  let answer = "";
  let engineUsed = "Claude";
  let claudeError = null;

  // 1. Ưu tiên gọi Claude API trước
  const claudeKey = (process.env.ANTHROPIC_API_KEY || process.env.IRIS_TELEPROMPTER_ANTHROPIC_KEY || "").trim();
  if (claudeKey) {
    try {
      answer = await callClaudeForTeleprompter(systemPrompt, cleanQ, { maxTokens: 600 });
      engineUsed = "Claude";
    } catch (err) {
      claudeError = err;
      console.warn("[askTeleprompter] Claude API thất bại, chuyển sang Gemini Vision:", err.message);
    }
  } else {
    claudeError = null;
  }

  // 2. Dự phòng: Không có key Claude hoặc Claude lỗi => dùng Gemini Vision + chụp màn hình
  if (!answer) {
    copilotStatus = "📸 Đang chụp màn hình & chuyển sang Gemini Vision...";
    updateTeleprompterHud();

    const usePoolFailover = typeof withGeminiFailover === "function" && typeof getAllGeminiKeys === "function";
    const geminiClient = usePoolFailover ? null : await getGeminiVisionClient();
    const hasVisionKey = usePoolFailover
      ? getAllGeminiKeys({ purpose: "vision", preferVision: true }).length > 0
      : Boolean(geminiClient);
    if (!hasVisionKey) {
      copilotStatus = "";
      updateTeleprompterHud();
      const prefix = claudeError ? `Claude: ${claudeError.message}. ` : "";
      return {
        status: "error",
        error: `${prefix}Gemini Vision chưa được cấu hình (thiếu GEMINI_API_KEY hoặc GEMINI_VISION_API_KEY).`
      };
    }

    try {
      // Chụp màn hình chính gửi kèm cho Gemini Vision
      let screenBase64 = null;
      try {
        const grabbed = await grabPrimaryScreenJpeg(75);
        if (grabbed?.buffer && Buffer.isBuffer(grabbed.buffer)) {
          screenBase64 = grabbed.buffer.toString("base64");
        }
      } catch (grabErr) {
        console.warn("[askTeleprompter] Không thể chụp màn hình cho Gemini Vision:", grabErr.message);
      }

      const candidateModels = Array.from(
        new Set(
          [
            String(process.env.GEMINI_VISION_MODEL || "").trim(),
            "gemini-2.0-flash",
            "gemini-1.5-flash",
            "gemini-2.5-flash",
            "gemini-flash-latest",
          ].filter(Boolean)
        )
      );

      const prompt =
        `${systemPrompt}\n\n` +
        (screenBase64 ? "Lưu ý: Đã đính kèm ảnh chụp màn hình hiện tại để bạn quan sát ngữ cảnh ứng dụng/tài liệu đang mở.\n\n" : "") +
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
                geminiTimer = setTimeout(() => reject(new Error("Gemini Vision quá thời gian chờ (25s)")), 25000);
              }),
            ]);
          } catch (modelErr) {
            lastErr = modelErr;
            if (isRateLimitError(modelErr) || /503|UNAVAILABLE|high demand/i.test(modelErr?.message || "")) {
              continue;
            }
            throw modelErr;
          } finally {
            if (geminiTimer) clearTimeout(geminiTimer);
          }
        }
        throw lastErr || new Error("Không thể kết nối tới các model Gemini Vision.");
      };

      const res = usePoolFailover
        ? await withGeminiFailover(
            async (apiKey) => {
              const client = await getGeminiVisionClient(apiKey);
              if (!client) throw new Error("Không có Gemini Vision client khả dụng.");
              return invokeVision(client);
            },
            { purpose: "vision", preferVision: true }
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
        cleanMsg = "Hết hạn mức API Gemini (429 Quota). Hệ thống đang chuyển sang key dự phòng.";
      }
      return {
        status: "error",
        error: `${prefix}Gemini Vision: ${cleanMsg}`,
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
