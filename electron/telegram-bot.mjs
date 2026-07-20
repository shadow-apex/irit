import TelegramBot from 'node-telegram-bot-api';

let bot = null;
let allowedUserId = null;

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

    const text = msg.text?.trim() || "";
    if (!text) return;

    if (text === '/start') {
      bot.sendMessage(chatId, "Welcome to Iris Telegram Bot! You can send me tasks, or use /task, /po, /status.");
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

    // Default action: just submit as a generic task
    callbacks.submitTask?.({ task: text });
    bot.sendMessage(chatId, `Task submitted:\n${text}`);
  });

  bot.on('polling_error', (error) => {
    callbacks.log?.("error", `Telegram Bot Error: ${error.code} - ${error.message}`);
  });

  /**
   * Send a message to the authorized user.
   */
  return function sendTelegramMessage(text) {
    if (bot && allowedUserId) {
      bot.sendMessage(allowedUserId, text).catch(err => {
        callbacks.log?.("error", `Telegram Bot send error: ${err.message}`);
      });
    }
  };
}
