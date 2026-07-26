import { Anthropic } from "@anthropic-ai/sdk";
import { mouse, keyboard, Point, Key, Button, screen as nutScreen } from "@nut-tree-fork/nut-js";
import { desktopCapturer, screen as electronScreen } from "electron";

// Config nut.js
nutScreen.config.autoHighlight = false;
mouse.config.autoDelayMs = 100;

// ===== Bảng map tên phím (theo chuẩn xdotool mà Claude Computer Use gửi lên) =====
// sang enum Key của nut.js. Bao gồm chữ cái, số, phím chức năng, phím điều
// hướng và các phím modifier (ctrl/alt/shift/win-super).
const KEY_MAP = {
  // Modifier
  ctrl: Key.LeftControl,
  control: Key.LeftControl,
  leftctrl: Key.LeftControl,
  rightctrl: Key.RightControl,
  alt: Key.LeftAlt,
  leftalt: Key.LeftAlt,
  rightalt: Key.RightAlt,
  altgr: Key.RightAlt,
  shift: Key.LeftShift,
  leftshift: Key.LeftShift,
  rightshift: Key.RightShift,
  // Windows / macOS Cmd / Linux Super đều map vào Key.LeftSuper của nut.js
  super: Key.LeftSuper,
  win: Key.LeftSuper,
  windows: Key.LeftSuper,
  meta: Key.LeftSuper,
  cmd: Key.LeftSuper,
  command: Key.LeftSuper,

  // Phím điều khiển / điều hướng
  return: Key.Enter,
  enter: Key.Enter,
  escape: Key.Escape,
  esc: Key.Escape,
  tab: Key.Tab,
  space: Key.Space,
  backspace: Key.Backspace,
  delete: Key.Delete,
  del: Key.Delete,
  insert: Key.Insert,
  home: Key.Home,
  end: Key.End,
  pageup: Key.PageUp,
  page_up: Key.PageUp,
  pagedown: Key.PageDown,
  page_down: Key.PageDown,
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
  capslock: Key.CapsLock,
  numlock: Key.NumLock,
  scrolllock: Key.ScrollLock,
  pause: Key.Pause,
  printscreen: Key.Print,
  print: Key.Print,
  menu: Key.Menu,

  // Ký tự / dấu câu
  minus: Key.Minus,
  "-": Key.Minus,
  equal: Key.Equal,
  "=": Key.Equal,
  comma: Key.Comma,
  ",": Key.Comma,
  period: Key.Period,
  ".": Key.Period,
  slash: Key.Slash,
  "/": Key.Slash,
  backslash: Key.Backslash,
  "\\": Key.Backslash,
  semicolon: Key.Semicolon,
  ";": Key.Semicolon,
  quote: Key.Quote,
  "'": Key.Quote,
  grave: Key.Grave,
  "`": Key.Grave,
  bracketleft: Key.LeftBracket,
  "[": Key.LeftBracket,
  bracketright: Key.RightBracket,
  "]": Key.RightBracket,

  // Numpad
  add: Key.Add,
  subtract: Key.Subtract,
  multiply: Key.Multiply,
  divide: Key.Divide,
  decimal: Key.Decimal,
};

// Chữ cái a-z
for (const letter of "abcdefghijklmnopqrstuvwxyz") {
  KEY_MAP[letter] = Key[letter.toUpperCase()];
}
// Số 0-9 (cả dạng "1" lẫn dạng xdotool "0"-"9")
for (let i = 0; i <= 9; i++) {
  KEY_MAP[String(i)] = Key[`Num${i}`];
}
// Phím chức năng F1-F24
for (let i = 1; i <= 24; i++) {
  KEY_MAP[`f${i}`] = Key[`F${i}`];
}

// Nhận vào chuỗi kiểu "ctrl+a", "ctrl+shift+t", "super+d", "Return"... và
// bấm tổ hợp phím tương ứng: giữ hết các modifier -> bấm phím chính -> nhả
// phím chính -> nhả các modifier theo thứ tự ngược lại.
async function pressKeyCombo(rawText) {
  const parts = String(rawText)
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);

  const keys = parts.map((p) => KEY_MAP[p]);
  const unknownIndex = keys.findIndex((k) => k === undefined);
  if (unknownIndex !== -1) {
    throw new Error(`Unknown key part: "${parts[unknownIndex]}" in "${rawText}"`);
  }
  if (keys.length === 0) {
    throw new Error(`Empty key text`);
  }

  if (keys.length === 1) {
    // Phím đơn: bấm rồi nhả (giống keyboard.type nhưng nhất quán với combo)
    await keyboard.pressKey(keys[0]);
    await keyboard.releaseKey(keys[0]);
    return;
  }

  const modifiers = keys.slice(0, -1);
  const mainKey = keys[keys.length - 1];
  try {
    for (const mod of modifiers) await keyboard.pressKey(mod);
    await keyboard.pressKey(mainKey);
    await keyboard.releaseKey(mainKey);
  } finally {
    // Luôn nhả hết modifier kể cả khi có lỗi ở giữa, tránh phím bị "kẹt"
    for (const mod of [...modifiers].reverse()) await keyboard.releaseKey(mod);
  }
}

// ============================================================================
// Tích hợp OmniParser (microsoft/OmniParser, bản thật đọc từ
// reponew/toado/api_server.py) để tăng độ chính xác click chuột cho
// Computer Use.
// ============================================================================
// Trước khi gửi ảnh chụp màn hình cho model phân tích (bước "screenshot" bên
// dưới trong runComputerSession), ta gửi ảnh đó qua OmniParser trước.
// OmniParser (chạy local, ví dụ `python api_server.py` tại port 8000) sẽ:
//   1. Chạy YOLO để phát hiện toàn bộ vùng UI có thể tương tác + OCR để đọc
//      chữ trên màn hình.
//   2. Vẽ khung đỏ + đánh số [0][1][2]... trực tiếp lên ảnh (Set-of-Marks),
//      trả về ảnh đã đánh dấu cùng toạ độ tỉ lệ (ratio 0-1) của từng khung.
// Ảnh đã đánh khung + danh sách toạ độ pixel tuyệt đối (quy đổi từ ratio
// theo đúng width/height màn hình thật) được gửi cho Claude thay ảnh gốc,
// giúp Claude bấm đúng theo số thứ tự/toạ độ khung thay vì tự đoán toạ độ
// điểm ảnh từ đầu.
//
// CONTRACT THẬT (đã đọc trực tiếp từ reponew/toado/api_server.py +
// reponew/toado/util/utils.py — KHÔNG phải đoán):
//   POST {OMNIPARSER_ANNOTATE_URL}   (mặc định http://127.0.0.1:8000/parse — KHÔNG có dấu / cuối)
//   Content-Type: multipart/form-data
//     - field "file": ảnh (bytes), bất kỳ định dạng PIL đọc được (jpeg/png đều OK)
//     - field "prompt": CỐ TÌNH BỎ TRỐNG — nếu gửi kèm "prompt", server sẽ tự
//       gọi Gemini để chọn RA MỘT khung duy nhất khớp với prompt đó và trả về
//       {target_id, target_center} thay vì danh sách đầy đủ (đây là hành vi
//       endpoint `startOmniParserTask` trong electron/main.mjs đã dùng sẵn
//       cho tác vụ 1 lần ăn ngay — khác mục đích với vòng lặp nhiều bước ở
//       đây, nơi CHÍNH CLAUDE cần thấy toàn bộ danh sách khung để tự quyết
//       định click cái nào ở mỗi bước).
//   Response JSON (khi không gửi "prompt", hoặc thiếu GEMINI_API_KEY):
//     {
//       "labeled_image_base64": "<base64 PNG, KHÔNG kèm prefix data:>",
//       "coordinates": { "0": [x_ratio, y_ratio, w_ratio, h_ratio], "1": [...], ... }
//     }
//     (coordinates là xywh — góc trên-trái + rộng/cao — theo tỉ lệ 0-1 so
//     với chiều rộng/cao ảnh gốc; key là chuỗi số thứ tự khung, đúng bằng số
//     được vẽ trên ảnh.)
const OMNIPARSER_ANNOTATE_URL =
  process.env.OMNIPARSER_ANNOTATE_URL || process.env.OMNIPARSER_API_URL || "http://127.0.0.1:8000/parse";
const OMNIPARSER_ENABLED = (process.env.OMNIPARSER_ENABLED ?? "true").toLowerCase() !== "false";
// YOLO + OCR (PaddleOCR) trên CPU/GPU yếu có thể mất hàng chục giây mỗi lần
// — main.mjs (startOmniParserTask) đã dùng sẵn 90s cho cùng một server này,
// nên giữ cùng giá trị mặc định để không bị timeout giả trên máy yếu.
const OMNIPARSER_TIMEOUT_MS = Number(process.env.OMNIPARSER_TIMEOUT_MS || 90000);

/**
 * Gửi ảnh chụp màn hình (base64 JPEG) sang OmniParser để lấy về ảnh đã đánh
 * Set-of-Marks (khung đỏ + số thứ tự [0][1][2]...) cùng danh sách toạ độ
 * pixel tuyệt đối (quy đổi từ ratio 0-1 theo width/height thật của màn
 * hình) của từng khung.
 *
 * Luôn trả về { base64, elementsText, annotated }. Nếu OmniParser không phản
 * hồi được (server chưa bật, timeout, lỗi mạng, thiếu pyautogui/torch...),
 * trả về ảnh gốc không thay đổi (annotated=false) để Computer Use vẫn tiếp
 * tục hoạt động bình thường như trước khi có OmniParser — không bao giờ làm
 * cả tác vụ thất bại chỉ vì OmniParser offline.
 */
async function annotateWithOmniParser(screenshotBase64, width, height, onStream) {
  if (!OMNIPARSER_ENABLED) {
    return { base64: screenshotBase64, elementsText: "", annotated: false };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OMNIPARSER_TIMEOUT_MS);

  try {
    const imageBuffer = Buffer.from(screenshotBase64, "base64");
    const formData = new FormData();
    // Field "file" đúng tên mà api_server.py khai báo: `file: UploadFile = File(...)`.
    // KHÔNG append field "prompt" — để trống thì server bỏ qua bước gọi
    // Gemini nội bộ và trả về toàn bộ danh sách khung cho Claude tự chọn.
    formData.append("file", new Blob([imageBuffer], { type: "image/jpeg" }), "screenshot.jpg");

    const response = await fetch(OMNIPARSER_ANNOTATE_URL, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`OmniParser HTTP ${response.status}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ""}`);
    }

    const result = await response.json();
    if (result.error) {
      throw new Error(String(result.error));
    }

    // Đúng tên field theo api_server.py: "labeled_image_base64" (base64 PNG).
    const annotatedImage = result.labeled_image_base64 || null;
    // Đúng tên field theo api_server.py: "coordinates" là DICT (không phải
    // list), key là chuỗi số thứ tự khung, value là [x_ratio,y_ratio,w_ratio,h_ratio] (xywh).
    const coordinates = result.coordinates && typeof result.coordinates === "object" ? result.coordinates : {};

    const ids = Object.keys(coordinates).sort((a, b) => Number(a) - Number(b));
    const elementLines = ids.map((id) => {
      const box = coordinates[id];
      if (!Array.isArray(box) || box.length !== 4) return `[${id}] (toạ độ không hợp lệ)`;
      const [xRatio, yRatio, wRatio, hRatio] = box;
      const x1 = Math.round(xRatio * width);
      const y1 = Math.round(yRatio * height);
      const w = Math.round(wRatio * width);
      const h = Math.round(hRatio * height);
      const cx = Math.round(x1 + w / 2);
      const cy = Math.round(y1 + h / 2);
      return `[${id}] center=(${cx},${cy}) box=[${x1},${y1},${x1 + w},${y1 + h}]`;
    });

    const elementsText =
      elementLines.length > 0
        ? `Ảnh trên đã được OmniParser vẽ khung đỏ + đánh số [0][1][2]... cho từng phần tử UI phát hiện được. Danh sách bên dưới ánh xạ số thứ tự trên ảnh sang toạ độ pixel THẬT trên màn hình ${width}x${height} — hãy dùng đúng toạ độ "center=(x,y)" tương ứng khi thực hiện left_click/mouse_move thay vì tự ước lượng bằng mắt:\n${elementLines.join("\n")}`
        : "";

    if (annotatedImage) {
      return { base64: annotatedImage, elementsText, annotated: true };
    }
    // OmniParser phản hồi hợp lệ nhưng thiếu ảnh đã đánh khung (không nên
    // xảy ra với server thật, nhưng phòng hờ) — vẫn dùng ảnh gốc kèm danh sách text.
    return { base64: screenshotBase64, elementsText, annotated: elementsText.length > 0 };
  } catch (err) {
    const reason = err?.name === "AbortError" ? `timed out after ${OMNIPARSER_TIMEOUT_MS}ms` : err.message;
    onStream?.({ text: `*(OmniParser không khả dụng, dùng ảnh gốc: ${reason})*` });
    return { base64: screenshotBase64, elementsText: "", annotated: false };
  } finally {
    clearTimeout(timeout);
  }
}

// Dò định dạng ảnh từ vài ký tự đầu của chuỗi base64 (magic bytes): ảnh do
// OmniParser trả về (labeled_image_base64) luôn là PNG (server encode bằng
// `pil_img.save(buffered, format="PNG")`), trong khi ảnh chụp màn hình gốc
// là JPEG — gửi sai media_type sẽ khiến model đọc ảnh lỗi.
function sniffImageMediaType(base64) {
  if (typeof base64 === "string") {
    if (base64.startsWith("iVBORw0KGgo")) return "image/png"; // PNG magic bytes
    if (base64.startsWith("/9j/")) return "image/jpeg"; // JPEG magic bytes
    if (base64.startsWith("R0lGOD")) return "image/gif"; // GIF magic bytes
  }
  return "image/jpeg"; // mặc định giữ hành vi cũ nếu không nhận diện được
}

export async function captureScreenBase64() {
  const primaryDisplay = electronScreen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;
  // Increase thumbnail size to get full resolution
  const sources = await desktopCapturer.getSources({ 
    types: ['screen'],
    thumbnailSize: { width, height }
  });
  
  // Use the primary screen (usually first)
  const primarySource = sources[0];
  
  // We return base64 jpeg
  const base64Image = primarySource.thumbnail.toJPEG(80).toString("base64");
  return { base64: base64Image, width, height };
}

let hasReportedMissingApiKey = false;

export async function runComputerSession(taskDescription, onStream, shouldCancel) {
  // Use ANTHROPIC_API_KEY explicitly for Computer Use (requires Claude 3.5 Sonnet)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    if (!hasReportedMissingApiKey) {
      hasReportedMissingApiKey = true;
      onStream({ text: "Error: ANTHROPIC_API_KEY is not set in .env. Computer Use requires a direct Anthropic API key. This error will be suppressed for subsequent attempts in this session." });
    } else {
      onStream({ text: "Error: API key still missing (suppressed)." });
    }
    return;
  }

  const client = new Anthropic({ apiKey });

  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: `Please perform this task on my computer: ${taskDescription}` }
      ]
    }
  ];

  let isComplete = false;
  let loops = 0;

  while (!isComplete && loops < 15) { // max 15 steps per task
    loops++;
    if (shouldCancel?.()) {
      onStream({ text: "*Task stopped by user request.*" });
      return { status: "cancelled" };
    }
    const { base64: screenshotBase64, width, height } = await captureScreenBase64();

    // Gửi ảnh gốc qua OmniParser để lấy ảnh đã đánh Set-of-Marks (khung đỏ +
    // số thứ tự) và danh sách phần tử UI trước khi đưa cho model — giúp
    // model chỉ đúng toạ độ thay vì tự đoán từ ảnh thô.
    const { base64: finalImageBase64, elementsText } = await annotateWithOmniParser(
      screenshotBase64,
      width,
      height,
      onStream,
    );

    const turnContent = [
       {
         type: "image",
         source: {
           type: "base64",
           // Ảnh do OmniParser trả về (som_image_base64) thường được PIL mã
           // hoá dạng PNG, khác với ảnh chụp màn hình gốc (JPEG) — dò theo
           // magic bytes của base64 để không gửi sai media_type cho model.
           media_type: sniffImageMediaType(finalImageBase64),
           data: finalImageBase64,
         }
       }
    ];

    if (elementsText) {
      turnContent.push({ type: "text", text: elementsText });
    }

    if (messages[messages.length - 1].role === "user") {
        messages[messages.length - 1].content.push(...turnContent);
    } else {
        messages.push({ role: "user", content: turnContent });
    }

    try {
        const response = await client.beta.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1024,
            system: "You are an AI assistant controlling the user's computer. Important rule: Whenever you open a new application (like Notepad, Chrome, etc.), your first action should be to resize the window to be smaller or snap it to a corner so it doesn't take up the entire screen, unless explicitly asked otherwise. This helps keep the workspace clean. " +
              "Each screenshot may be pre-processed by OmniParser: UI elements are outlined with red bounding boxes and numbered [0], [1], [2]... and a text list follows the image describing each numbered element along with its exact pixel center coordinate on this screen. When this list is present, treat it as ground truth for where things are — click the 'center=(x,y)' pixel coordinate of the matching numbered element instead of estimating coordinates yourself from the raw pixels. If no such list is present (OmniParser unavailable for this turn), fall back to your own visual judgement as before.",
            betas: ["computer-use-2024-10-22"],
            messages,
            tools: [
                {
                    type: "computer_20241022",
                    name: "computer",
                    display_width_px: width,
                    display_height_px: height,
                    display_number: 1,
                }
            ]
        });

        messages.push({ role: "assistant", content: response.content });

        const textBlocks = response.content.filter(block => block.type === "text");
        for (const block of textBlocks) {
          onStream({ text: block.text });
        }

        const toolCalls = response.content.filter(block => block.type === "tool_use");
        if (toolCalls.length === 0) {
            isComplete = true; 
            break;
        }

        const toolResults = [];

        for (const tool of toolCalls) {
            if (tool.name === "computer") {
                const action = tool.input.action;
                let resultText = "Executed successfully.";
                try {
                    onStream({ text: `*Executing: ${action}*` });
                    // Một số action đi kèm "coordinate" ngay trong cùng lệnh
                    // (không cần mouse_move riêng) — di chuyển chuột tới đó trước khi bấm.
                    if (Array.isArray(tool.input.coordinate) &&
                        ["left_click", "right_click", "middle_click", "double_click", "triple_click"].includes(action)) {
                        const [cx, cy] = tool.input.coordinate;
                        await mouse.setPosition(new Point(cx, cy));
                    }

                    switch (action) {
                        case "mouse_move": {
                            const [x, y] = tool.input.coordinate;
                            await mouse.setPosition(new Point(x, y));
                            break;
                        }
                        case "left_click":
                            await mouse.leftClick();
                            break;
                        case "left_click_drag": {
                            const [dx, dy] = tool.input.coordinate;
                            await mouse.pressButton(Button.LEFT);
                            await mouse.setPosition(new Point(dx, dy));
                            await mouse.releaseButton(Button.LEFT);
                            break;
                        }
                        case "right_click":
                            await mouse.rightClick();
                            break;
                        case "middle_click":
                            await mouse.click(Button.MIDDLE);
                            break;
                        case "double_click":
                            await mouse.doubleClick(Button.LEFT);
                            break;
                        case "triple_click":
                            await mouse.doubleClick(Button.LEFT);
                            await mouse.leftClick();
                            break;
                        case "left_mouse_down":
                            await mouse.pressButton(Button.LEFT);
                            break;
                        case "left_mouse_up":
                            await mouse.releaseButton(Button.LEFT);
                            break;
                        case "scroll": {
                            // tool.input: { coordinate?: [x,y], scroll_direction: "up"|"down"|"left"|"right", scroll_amount: number }
                            if (Array.isArray(tool.input.coordinate)) {
                                const [sx, sy] = tool.input.coordinate;
                                await mouse.setPosition(new Point(sx, sy));
                            }
                            const amount = tool.input.scroll_amount ?? 3;
                            const direction = tool.input.scroll_direction;
                            if (direction === "up") await mouse.scrollUp(amount);
                            else if (direction === "down") await mouse.scrollDown(amount);
                            else if (direction === "left") await mouse.scrollLeft(amount);
                            else if (direction === "right") await mouse.scrollRight(amount);
                            else resultText = `Unknown scroll_direction: ${direction}`;
                            break;
                        }
                        case "type":
                            await keyboard.type(tool.input.text);
                            break;
                        case "key":
                            // Hỗ trợ tổ hợp phím đầy đủ: "ctrl+a", "ctrl+c", "ctrl+v", "super+d" (Win+D), v.v.
                            await pressKeyCombo(tool.input.text);
                            break;
                        case "hold_key": {
                            // tool.input: { text: "ctrl", duration: 2 } — giữ phím trong N giây rồi nhả
                            const keys = String(tool.input.text)
                                .toLowerCase()
                                .split("+")
                                .map((p) => p.trim())
                                .map((p) => KEY_MAP[p])
                                .filter(Boolean);
                            for (const k of keys) await keyboard.pressKey(k);
                            await new Promise((r) => setTimeout(r, (tool.input.duration ?? 1) * 1000));
                            for (const k of [...keys].reverse()) await keyboard.releaseKey(k);
                            break;
                        }
                        case "cursor_position":
                            resultText = JSON.stringify(await mouse.getPosition());
                            break;
                        case "screenshot":
                            resultText = "Screenshot will be taken on the next turn.";
                            break;
                        default:
                            resultText = `Unknown action: ${action}`;
                    }
                } catch (e) {
                    resultText = `Error executing ${action}: ${e.message}`;
                    console.error("Action error", e);
                }
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: tool.id,
                    content: resultText
                });
            }
        }
        
        if (toolResults.length > 0) {
          messages.push({ role: "user", content: toolResults });
        } else {
          isComplete = true; // Edge case
        }
        
    } catch (err) {
        console.error("Computer Use Error", err);
        onStream({ text: `*API Error: ${err.message}*` });
        isComplete = true;
    }
  }

  onStream({ text: "*Task Completed.*" });
  return { status: "completed" };
}
