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

export async function runComputerSession(taskDescription, onStream) {
  // Use ANTHROPIC_API_KEY explicitly for Computer Use (requires Claude 3.5 Sonnet)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    onStream({ text: "Error: ANTHROPIC_API_KEY is not set in .env. Computer Use requires a direct Anthropic API key." });
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
    const { base64: screenshotBase64, width, height } = await captureScreenBase64();
    
    const turnContent = [
       {
         type: "image",
         source: {
           type: "base64",
           media_type: "image/jpeg",
           data: screenshotBase64,
         }
       }
    ];
    
    if (messages[messages.length - 1].role === "user") {
        messages[messages.length - 1].content.push(...turnContent);
    } else {
        messages.push({ role: "user", content: turnContent });
    }

    try {
        const response = await client.beta.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1024,
            system: "You are an AI assistant controlling the user's computer. Important rule: Whenever you open a new application (like Notepad, Chrome, etc.), your first action should be to resize the window to be smaller or snap it to a corner so it doesn't take up the entire screen, unless explicitly asked otherwise. This helps keep the workspace clean.",
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
}
