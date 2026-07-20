import TelegramBot from 'node-telegram-bot-api';

let bot = null;
let allowedUserId = null;
let authorizedChatId = null; // Lưu chatId thực từ message đầu tiên của user (khác với userId)

/**
 * Initialize the Telegram bot if tokens are present.
 * 
 * @param {Object} callbacks 
 * @param {Function} callbacks.submitTask - (taskObj) => void
 * @param {Function} callbacks.getStatus - () => string
 * @param {Function} callbacks.log - (level, msg) => void
 * @returns {Function} sendMessage - A function to send text back to the authorized user
 */
export function initTelegramBot(callbacks) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const rawAllowedId = process.env.TELEGRAM_ALLOWED_USER_ID;

  if (!token) {
    callbacks.log?.("info", "Telegram Bot: No TELEGRAM_BOT_TOKEN found. Bot is disabled.");
    return () => {}; // return no-op sendMessage
  }

  if (!rawAllowedId) {
    callbacks.log?.("error", "Telegram Bot: Token provided but TELEGRAM_ALLOWED_USER_ID is missing. Refusing to start for security.");
    return () => {};
  }

  allowedUserId = parseInt(rawAllowedId, 10);
  if (isNaN(allowedUserId)) {
    callbacks.log?.("error", "Telegram Bot: TELEGRAM_ALLOWED_USER_ID is not a valid number.");
    return () => {};
  }

  // Create a bot that uses 'polling' to fetch new updates
  bot = new TelegramBot(token, { polling: true });
  callbacks.log?.("info", `Telegram Bot started. Listening for user ID: ${allowedUserId}`);

  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Security check: Ignore everyone except the allowed user
    if (userId !== allowedUserId) {
      callbacks.log?.("warn", `Telegram Bot: Unauthorized access attempt from user ${userId} (${msg.from.username})`);
      return;
    }

    // Cập nhật chatId thực để sendTelegramMessage gửi đúng nơi
    // (chatId khác allowedUserId khi user nhắn từ group chat)
    authorizedChatId = chatId;

    const text = msg.text?.trim() || "";
    if (!text) return;

    if (text === '/start') {
      const opts = {
        reply_markup: {
          keyboard: [
            [{ text: '/status' }, { text: '/routine morning' }],
            [{ text: 'Bật đèn phòng làm việc' }, { text: 'Tắt đèn' }]
          ],
          resize_keyboard: true,
          is_persistent: true
        }
      };
      bot.sendMessage(chatId, "Chào mừng sếp! Sếp có thể tự gõ lệnh, hoặc bấm các nút tiện ích có sẵn dưới đây để ra lệnh nhanh mà không cần gõ phím nhé.", opts);
      return;
    }

    if (text === '/status') {
      const status = callbacks.getStatus?.() || "Unknown";
      bot.sendMessage(chatId, `Current Claude task status: ${status}`);
      return;
    }

    // Command handling
    if (text.startsWith('/task ')) {
      const task = text.replace('/task ', '').trim();
      callbacks.submitTask?.({ task, agent: 'dev' });
      bot.sendMessage(chatId, `Task submitted to DEV:\n${task}`);
      return;
    }

    if (text.startsWith('/po ')) {
      const task = text.replace('/po ', '').trim();
      callbacks.submitTask?.({ task, agent: 'po' });
      bot.sendMessage(chatId, `Task submitted to PO:\n${task}`);
      return;
    }

    if (text.startsWith('/routine ')) {
      const routineName = text.replace('/routine ', '').trim().toLowerCase();
      if (routineName === 'morning') {
        // Lưu ý kỹ thuật quan trọng:
        // display_hud_message là Gemini Live tool — Claude Code headless (DEV)
        // KHÔNG có quyền gọi tool này.
        // Flow đúng: Claude thu thập tin tức → output kết quả →
        // announceClaudeCompletion() thông báo Gemini → Gemini tự gọi display_hud_message.
        // Vì vậy: KHÔNG truyền agent:'dev' (tránh fail do thiếu OpenSpec change),
        // và KHÔNG yêu cầu Claude gọi display_hud_message trong task brief.
        const morningTask = [
          "Morning routine — thực hiện theo thứ tự:",
          "1. Mở Spotify: chạy lệnh 'start spotify.exe' bằng shell command.",
          "2. Lấy tin tức: truy cập một nguồn tin (ví dụ: https://vnexpress.net hoặc https://tuoitre.vn),",
          "   tổng hợp 5 tin nóng nhất trong ngày bằng tiếng Việt.",
          "3. Trả về output CHÍNH XÁC theo định dạng sau (Iris sẽ đọc kết quả này và hiển thị lên HUD):",
          "   TIÊU ĐỀ: Báo cáo Buổi sáng — [ngày hôm nay]",
          "   NỘI DUNG:",
          "   1. [Tóm tắt tin 1]",
          "   2. [Tóm tắt tin 2]",
          "   ... (5 tin)",
          "QUAN TRỌNG: Chỉ output phần tin tức — không thêm giải thích hay commentary ngoài lề.",
        ].join("\n");
        callbacks.submitTask?.({ task: morningTask }); // Không truyền agent — dùng plain Claude
        bot.sendMessage(chatId, `🌅 Chào buổi sáng! Đang bật nhạc và lấy tin tức cho sếp...\nIris sẽ thông báo kết quả khi Claude hoàn thành nhé!`);
      } else {
        bot.sendMessage(chatId, `Unknown routine: ${routineName}. Available routines: morning`);
      }
      return;
    }

    // Default action: just submit as a generic task
    callbacks.submitTask?.({ task: text });
    bot.sendMessage(chatId, `Task submitted:\n${text}`);
  });

  bot.on('polling_error', (error) => {
    callbacks.log?.("error", `Telegram Bot Error: ${error.code} - ${error.message}`);
  });

  /**
   * Send a message to the authorized user.
   * Dùng authorizedChatId (được cập nhật mỗi khi user nhắn tin thành công)
   * thay vì allowedUserId để hỗ trợ cả group chat.
   */
  return function sendTelegramMessage(text) {
    if (bot && authorizedChatId) {
      bot.sendMessage(authorizedChatId, text).catch(err => {
        callbacks.log?.("error", `Telegram Bot send error: ${err.message}`);
      });
    } else if (bot && allowedUserId) {
      // Fallback: chưa có chatId (bot chưa nhận message nào), dùng userId
      // (chỉ đúng với DM, không đúng với group — user nên /start trước)
      bot.sendMessage(allowedUserId, text).catch(err => {
        callbacks.log?.("error", `Telegram Bot send error (fallback): ${err.message}`);
      });
    }
  };
}
