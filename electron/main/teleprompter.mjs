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
import { repoRoot } from "./paths.mjs";

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

export async function callClaudeForTeleprompter(systemPrompt, userText, { maxTokens = 400 } = {}) {
  const apiKey = (process.env.IRIS_TELEPROMPTER_ANTHROPIC_KEY || "").trim();
  if (!apiKey) {
    throw new Error(
      "Thiếu IRIS_TELEPROMPTER_ANTHROPIC_KEY trong .env — cần API key Claude riêng cho tính năng Dịch/Nhắc bài (xem .env.example)."
    );
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userText }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Claude API lỗi ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const block = Array.isArray(data.content) ? data.content.find((b) => b.type === "text") : null;
  return (block?.text || "").trim();
}

export function updateTeleprompterHud() {
  if (!mainWindow) return;
  let content = liveTranscripts.join("\n");
  if (translateEnabled && liveTranslations.length) {
    content += "\n\n" + liveTranslations.join("\n");
  }
  // Nhắc bài không còn ghi đè vào `content` dạng text (dòng đơn, dễ mất) —
  // gửi copilotHistory/copilotStatus như dữ liệu có cấu trúc riêng,
  // HudShell tự render thành bảng cuộn được, giữ nguyên toàn bộ lịch sử
  // trong phiên (không bị mất khi có câu hỏi mới).
  mainWindow.webContents.send("hud:message", {
    title: "Live Teleprompter",
    content,
    copilotHistory: copilotEnabled ? copilotHistory : undefined,
    copilotStatus: copilotEnabled ? copilotStatus : undefined,
  });
}

export async function toggleTranslateMode(targetLang) {
  translateEnabled = !translateEnabled;
  if (translateEnabled) {
    translateTargetLang = (targetLang || "English").trim();
    liveTranslations = [];
    // Dịch và Nhắc bài loại trừ nhau (xem comment ở khai báo translateEnabled
    // phía trên) — tắt Nhắc bài nếu đang bật, đối xứng với việc
    // toggleCopilotMode() đã tắt Dịch khi bật Nhắc bài. Bản trước chỉ tắt
    // 1 chiều (bật Nhắc bài mới tắt Dịch) nên bật Dịch trong lúc Nhắc bài
    // đang chạy khiến cả 2 chạy song song, chồng gợi ý lên nhau.
    if (copilotEnabled) {
      copilotEnabled = false;
      copilotStatus = "";
      if (copilotTimer) clearTimeout(copilotTimer);
    }
  } else {
    translateTargetLang = "";
    liveTranslations = [];
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
    const scriptPath = path.join(repoRoot, "sidecar", "live_transcriber.py");

    liveTranscriber = spawnSidecar(pythonPath, [scriptPath], {
      cwd: repoRoot,
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

    const logDir = path.join(repoRoot, "teleprompter_logs");
    fs.mkdirSync(logDir, { recursive: true });
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    liveLogStream = fs.createWriteStream(path.join(logDir, `transcript_${ts}.txt`), { flags: 'a' });
    liveLogStream.write(`=== Phiên dịch & Nhắc bài (${ts}) ===\n(Bao gồm lời của bạn và người đối diện)\n\n`);

    const updateLiveHud = () => updateTeleprompterHud();

    enterHud();
    if (mainWindow) {
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
                   const translated = await callClaudeForTeleprompter(
                     `Bạn là công cụ dịch song song thời gian thực. Dịch CÂU MỚI (đánh dấu rõ trong tin nhắn, nếu có) sang ngôn ngữ "${translateTargetLang}", dựa vào ngữ cảnh phía trên (nếu có) để dịch đúng đại từ/ý được nhắc ở câu trước. ` +
                       `CHỈ trả về bản dịch của CÂU MỚI — không dịch lại phần ngữ cảnh, không giải thích, không thêm gì khác. Giữ nguyên các tiền tố [Bạn]/[Đối tác]/[Chung] ở đầu câu MỚI nếu có, chỉ dịch phần nội dung sau tiền tố.`,
                     userText,
                     { maxTokens: 200 }
                   );
                   if (translated) {
                     liveTranslations.push(translated);
                     if (liveTranslations.length > 3) liveTranslations.shift();
                     if (liveLogStream) {
                       const latencyMs = Date.now() - finalizedAt;
                       liveLogStream.write(`[Dịch -> ${translateTargetLang}] (⏱ ${latencyMs}ms): ${translated}\n`);
                     }
                     updateLiveHud();
                   }
                 } catch (e) {
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
                 "Bạn là trợ lý hỗ trợ tôi trả lời nhanh trong một cuộc trò chuyện/họp trực tiếp. " +
                 "Bạn sẽ nhận đoạn transcript gần nhất (giọng của tôi đánh dấu [Bạn], giọng người đối diện đánh dấu [Đối tác]). " +
                 "Nếu người đối diện vừa hỏi hoặc cần tôi phản hồi, đưa ra 1-2 câu trả lời ĐỀ XUẤT ngắn gọn, tự nhiên, đúng trọng tâm, dựa trên thông tin có trong ngữ cảnh. " +
                 "Nếu không có gì đáng trả lời (tôi đang tự nói, hoặc chỉ là câu chuyện phiếm chưa cần phản hồi), trả về đúng 1 chữ 'NONE'.";

               let suggestion = "";
               let engineUsed = "Claude";
               try {
                 suggestion = await callClaudeForTeleprompter(systemPrompt, contextText, { maxTokens: 300 });
               } catch (claudeErr) {
                 // Chưa cấu hình IRIS_TELEPROMPTER_ANTHROPIC_KEY (hoặc lỗi mạng) ->
                 // fallback tạm sang Gemini (đã có sẵn) để tính năng không bị câm,
                 // đồng thời báo rõ lý do trong log để người dùng biết cần cấu hình.
                 emitEvent({ type: "log", level: "warn", message: `Nhắc bài: gọi Claude thất bại (${claudeErr.message}), fallback sang Gemini.` });
                 if (!ai) { copilotStatus = ""; updateLiveHud(); return; }
                 try {
                   const response = await ai.models.generateContent({
                     model: "gemini-flash-latest",
                     contents: systemPrompt + "\n\n" + contextText,
                   });
                   suggestion = (response.text || "").trim();
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
  if (mainWindow) {
    mainWindow.webContents.send("hud:message", { title: "Live Teleprompter", content: "Đã tắt tính năng Nhắc Tuồng." });
    setTimeout(() => {
       if (mainWindow) mainWindow.webContents.send("hud:message", null);
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
  translateEnabled = false;
  translateTargetLang = "";
  // Tắt cả Alt+T thì Nhắc bài cũng coi như tắt theo. Không còn gửi
  // "teleprompter:force-mic" (đã bỏ cơ chế tự tắt/mở mic laptop).
  copilotEnabled = false;

  return { status: "success", message: "Đã tắt Nhắc Tuồng." };
}
