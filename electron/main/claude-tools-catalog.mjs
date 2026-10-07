/**
 * electron/main/claude-tools-catalog.mjs
 *
 * The Gemini Live "function calling" tool catalog: declarative schemas for
 * every tool Iris can invoke (start a Claude run, control smart-home
 * devices, drive the browser/computer, ...). Pure data — the actual
 * handlers live in electron/main/tool-dispatcher.mjs.
 */
import { MODEL_CHOICES } from "./agent-roster.mjs";

import { annotateDangerousDeclarations } from "./dangerous-tools.mjs";

export function buildClaudeTools() {
  const groups = buildClaudeToolsRaw();
  const main = groups.find((g) => Array.isArray(g.functionDeclarations));
  // Một số tool (power_manager, media_control, desktop_manager) từng bị nối nhầm thành phần tử `tools[]`
  // riêng với khoá `input_schema` (định dạng Claude) — không phải khai báo hợp lệ cho Gemini Live nên
  // không gọi được. Gộp chúng vào functionDeclarations với `parameters`.
  const flat = groups.filter((g) => !g.functionDeclarations && g.name && g.input_schema);
  for (const t of flat) {
    main.functionDeclarations.push({ name: t.name, description: t.description, parameters: t.input_schema });
  }
  // Loại khai báo TRÙNG TÊN (giữ bản đầu): tên hàm trùng làm API từ chối cả bộ tool.
  const seen = new Set();
  main.functionDeclarations = main.functionDeclarations.filter((d) => (seen.has(d.name) ? false : (seen.add(d.name), true)));
  // S-11: gắn quy trình xác nhận hai bước vào mô tả/tham số của các tool nguy hiểm.
  annotateDangerousDeclarations(main.functionDeclarations);
  return groups.filter((g) => g === main || (!g.functionDeclarations && !(g.name && g.input_schema)));
}

function buildClaudeToolsRaw() {
  return [
    {
      functionDeclarations: [
        {
          name: "start_computer_use_task",
          description: "Take control of the user's computer screen, mouse, and keyboard to complete a GUI task autonomously using Claude's Computer Use API. Invoke this when the user asks you to open an application, click on something, or interact with the screen.",
          parameters: {
            type: "object",
            properties: {
              task: {
                type: "string",
                description: "The detailed GUI task to perform on the computer."
              }
            },
            required: ["task"]
          }
        },
        {
          name: "computer_use_omniparser",
          description: "Take control of the user's computer screen to click on an element using OmniParser local vision model (FREE, No tokens!). Invoke this when the user asks you to click on something or interact with the screen using OmniParser.",
          parameters: {
            type: "object",
            properties: {
              task: {
                type: "string",
                description: "The description of what to click (e.g. 'the Start button', 'the login button', 'the search bar')."
              }
            },
            required: ["task"]
          }
        },
        {
          name: "computer_use_type",
          description: "Take control of the user's keyboard to type text or press a specific key. Invoke this when the user asks you to type something, press Enter, etc.",
          parameters: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "The text to type out using the keyboard (e.g. 'hello world')."
              },
              key: {
                type: "string",
                description: "The name of a specific key or hotkey to press (e.g. 'enter', 'esc', 'tab', 'backspace', 'ctrl+a', 'ctrl+c')."
              }
            }
          }
        },
        {
          name: "open_url_or_app",
          description: "Open a website in the default browser or open a local application on Windows. IMPORTANT: If the user asks to open a website like YouTube or Facebook, you MUST provide the full valid URL (e.g., 'https://www.youtube.com'). If they ask to open a system app, provide the executable name (e.g., 'calc.exe', 'notepad.exe'). DO NOT use this for complex GUI interaction, only for simply opening things.",
          parameters: {
            type: "object",
            properties: {
              target: { type: "string", description: "The full URL or executable name." },
              is_url: { type: "boolean", description: "True if it's a website URL, false if it's a local app executable." }
            },
            required: ["target", "is_url"]
          }
        },
        {
          name: "close_app",
          description: "Close an open local application on Windows. Invoke this when the user asks you to close an app. Provide the executable name (e.g., 'calc.exe', 'notepad.exe', 'Code.exe').",
          parameters: {
            type: "object",
            properties: {
              target: { type: "string", description: "The executable name to close (e.g. 'Discord.exe')." }
            },
            required: ["target"]
          }
        },
        {
          name: "minimize_app",
          description: "Minimize an open local application on Windows to the taskbar. Invoke this when the user asks you to minimize (in Vietnamese: 'ẩn tab', 'ẩn đi', 'giấu đi', 'dấu trừ') an app. DO NOT use this when the user says 'thu nhỏ' (which means Picture-in-Picture mode). Provide the executable name (e.g., 'calc.exe', 'notepad.exe', 'Irit.exe').",
          parameters: {
            type: "object",
            properties: {
              target: { type: "string", description: "The executable name to minimize (e.g. 'Discord.exe')." }
            },
            required: ["target"]
          }
        },
        {
          name: "hide_app",
          description: "Hide an open local application's window on Windows without minimizing it to the taskbar or closing it (the process keeps running, invisibly). Invoke this when the user specifically asks to 'hide' an app rather than minimize/close it. Provide the executable name (e.g., 'Discord.exe').",
          parameters: {
            type: "object",
            properties: {
              target: { type: "string", description: "The executable name to hide (e.g. 'Discord.exe')." }
            },
            required: ["target"]
          }
        },
        {
          name: "restore_app",
          description: "Restore or maximize a minimized local application on Windows, bringing it back to the screen. Invoke this when the user asks you to open, restore, or maximize an app that is currently hidden or minimized. Provide the executable name (e.g., 'calc.exe', 'notepad.exe', 'Code.exe').",
          parameters: {
            type: "object",
            properties: {
              target: { type: "string", description: "The executable name to restore (e.g. 'Discord.exe')." }
            },
            required: ["target"]
          }
        },
        {
          name: "write_note",
          description: "Write text into a temporary Notepad file and open it for the user to see. Invoke this when the user asks you to take a note, write something down, or display text in Notepad. By default, it appends to the existing note. Set is_new to true if the user asks to start a fresh/new note.",
          parameters: {
            type: "object",
            properties: {
              text: { type: "string", description: "The content to write into the note." },
              is_new: { type: "boolean", description: "If true, clears the previous note and starts a new one. If false, appends to the existing note." }
            },
            required: ["text"]
          }
        },
        {
          name: "search_local_files",
          description: "Search for a file on the user's local Windows filesystem using Everything (es.exe must be installed). Use this when the user asks to find a file, document, or folder. PRIVACY: the returned file paths are sent to the cloud model. The query must not start with '-' or '/'.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "The search query (filename, extension, etc)." },
              max: { type: "integer", description: "Max results to return (default 10)." }
            },
            required: ["query"]
          }
        },
        {
          name: "read_system_notifications",
          description: "Read recent Windows toast notifications (e.g., Zalo, Telegram, Mail). PRIVACY: contents go to the cloud model; one-time/verification codes are MASKED (****) by default. Set reveal_otp=true ONLY if the user explicitly asks to hear the code (requires confirmation).",
          parameters: {
            type: "object",
            properties: {
              limit: { type: "integer", description: "Max number of notifications to read (default 5)." },
              reveal_otp: { type: "boolean", description: "Reveal verification/OTP codes instead of masking them. Only when the user explicitly asks." }
            }
          }
        },
        // ---------------------------------------------------------------
        // Local "/tools" scripts — ported from the Claude-Code skills under
        // .agents/skills/ (ai-vision, clipboard, window-magic, notify,
        // sys-control, sys-monitor) so Iris herself can run them directly
        // over WebRTC, without waiting for a submit_claude_task round-trip.
        // ---------------------------------------------------------------
        {
          name: "take_ai_screenshot",
          description: "Instantly capture a single screenshot of the user's PRIMARY screen (captured inside Iris, downscaled to <=1280x720 and sent to you as an image frame) and look at it right now. The screenshot is NOT saved to disk unless save=true. Use this for one-off questions like 'what am I looking at?', 'what error is this?', 'look at my screen'. Unlike toggle_screen_vision, this does not start a continuous stream — it is a single instant snapshot.",
          parameters: { type: "object", properties: { save: { type: "boolean", description: "Also save the screenshot to disk (only when the user asks to keep it; view_image can show saved ones to the user)." } } },
        },
        {
          name: "read_clipboard",
          description: "Read whatever text is currently on the user's clipboard (via tools/clipboard_manager.py). Use when the user asks 'what did I just copy?' or 'read my clipboard'.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "write_clipboard",
          description: "Copy text onto the user's clipboard so they can paste it elsewhere (via tools/clipboard_manager.py). Use when the user asks you to copy a password, code snippet, or any text for them.",
          parameters: {
            type: "object",
            properties: {
              text: { type: "string", description: "The exact text to copy to the clipboard." },
            },
            required: ["text"],
          },
        },
        {
          name: "move_window_magic",
          description: "Move a window on the user's screen using tools/magic_move.py. Use when the user asks you to move a window. Never targets Iris's own window.",
          parameters: {
            type: "object",
            properties: {
              mode: {
                type: "string",
                description: "'active' — the script REALLY counts down 5 seconds, then moves whichever window the user focused (tell the user right away to click the target window; the call returns after ~6 s); 'name' — move the window whose exe name or title (>=4 chars) matches. (A 'demo' mode exists only when IRIS_DEV_TOOLS=1.)",
              },
              name: { type: "string", description: "Window title (or part of it) to target. Required for mode 'name'." },
              x: { type: "integer", description: "Target X coordinate on screen. Defaults to 0." },
              y: { type: "integer", description: "Target Y coordinate on screen. Defaults to 0." },
            },
            required: ["mode"],
          },
        },
        {
          name: "move_window_precise",
          description: "Move and optionally resize a window on the user's screen via tools/move_window.py (Win32 API, no PowerShell). Use when the user asks you to move a specific window by name to an exact coordinate.",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "Window title (or part of it) to target." },
              x: { type: "integer", description: "Target X coordinate on screen." },
              y: { type: "integer", description: "Target Y coordinate on screen." },
              width: { type: "integer", description: "Optional new width." },
              height: { type: "integer", description: "Optional new height." },
            },
            required: ["name", "x", "y"],
          },
        },
        {
          name: "send_desktop_notification",
          description: "Pop up a native Windows toast notification on the user's screen (via tools/notifier.py). Use when the user asks to be reminded of something or wants an on-screen alert.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Notification title." },
              message: { type: "string", description: "Notification body text." },
            },
            required: ["title", "message"],
          },
        },
        {
          name: "system_control",
          description: "Control the user's hardware/OS settings via tools/sys_control.py: volume (relative, absolute volume_level, or mute toggle), screen brightness (laptop panels only — external monitors are not supported), Wi-Fi off (disconnect), Bluetooth, or camera. Bluetooth/camera changes need a Windows UAC prompt — tell the user to click 'Yes'; the result is only reported after they answer. WARNING: camera off disables EVERY camera device, including the webcam Iris itself uses for hand control/vision. Pass only the field(s) relevant to the request.",
          parameters: {
            type: "object",
            properties: {
              volume: { type: "string", description: "One of: mute (this is a TOGGLE in Windows), unmute, up, down." },
              volume_level: { type: "integer", description: "Set the ABSOLUTE volume, 0-100." },
              brightness: { type: "integer", description: "Screen brightness percentage, 0-100." },
              wifi: { type: "string", description: "One of: on, off." },
              bluetooth: { type: "string", description: "One of: on, off." },
              camera: { type: "string", description: "One of: on, off." },
            },
          },
        },
        {
          name: "mouse_control",
          description: "Control the mouse cursor by screen coordinates via tools/mouse_control.py: move it (optionally clicking on arrival), click (left/right/middle, single/double), drag from one point to another, scroll, or read its current position. Movement is FAST by default (a short curved path, ~0.1 s); set human_like=true only if a slower human-like curve is wanted. Coordinates are PHYSICAL screen pixels (space:'screen'); if you read coordinates off a screenshot/vision frame (which is downscaled), pass space:'frame' and Iris converts them. Out-of-range points are clamped to the virtual desktop (all monitors) and kept away from the corner fail-safe. action 'release' lets go of all mouse buttons (recovery after a failed drag). Use when the user gives explicit x/y coordinates or asks you to move/click/drag the mouse pointer somewhere on screen (e.g. 'di chuyen chuot den toa do 500 300', 'click vao diem 800, 400', 'keo tu diem A den diem B').",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", description: "One of: move, click, drag, scroll, position, release." },
              space: { type: "string", description: "'screen' (default): x/y are physical screen pixels. 'frame': x/y were read from the downscaled vision/screenshot frame." },
              monitor: { type: "integer", description: "Optional: treat x/y as relative to monitor N (0-based order from multi_monitor_info)." },
              human_like: { type: "boolean", description: "Use the slower human-like Bezier motion instead of the default fast move." },
              x: { type: "integer", description: "Target X coordinate (move/click/drag start point)." },
              y: { type: "integer", description: "Target Y coordinate (move/click/drag start point)." },
              x2: { type: "integer", description: "Drag end X coordinate (drag only)." },
              y2: { type: "integer", description: "Drag end Y coordinate (drag only)." },
              button: { type: "string", description: "One of: left, right, middle. Defaults to left. Used for click/drag/move+click." },
              double: { type: "boolean", description: "If true, performs a double-click instead of a single click." },
              click: { type: "boolean", description: "For action 'move' only: click at the destination immediately after arriving, instead of needing a separate 'click' call." },
              linear: { type: "boolean", description: "For move/click: use an instant straight-line move instead of the default smooth curved motion. Only use this if precise, non-human-like positioning is explicitly needed." },
              amount: { type: "integer", description: "Scroll amount: positive scrolls up, negative scrolls down (scroll only)." },
            },
            required: ["action"],
          },
        },
        {
          name: "active_window_info",
          description: "Read-only: reports the title, process name/PID, and screen position/size of whichever window currently has focus, via tools/active_window_info.py. Use to know what app the user is looking at before deciding what to type/click. Does not touch the screen, mouse, or keyboard, so it never conflicts with OmniParser/computer-use or screen vision.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "ocr_region",
          description: "Reads text out of a screen region (or the whole screen) via OCR using tools/ocr_region.py, without needing to send an image frame to you. Requires the separate Tesseract-OCR engine to be installed on the machine (not just a pip package) — report that clearly if the tool returns that error.",
          parameters: {
            type: "object",
            properties: {
              left: { type: "integer", description: "Left edge of the region to OCR. Omit all four region fields to OCR the whole screen." },
              top: { type: "integer", description: "Top edge of the region to OCR." },
              width: { type: "integer", description: "Width of the region to OCR." },
              height: { type: "integer", description: "Height of the region to OCR." },
              lang: { type: "string", description: "Tesseract language code, e.g. 'eng', 'vie' or 'vie+eng'. Omit to auto-pick (IRIS_OCR_LANG, else vie+eng when the Vietnamese pack is installed, else eng with a warning)." },
            },
          },
        },
        {
          name: "color_picker",
          description: "Reads the RGB/hex color of the pixel at given screen coordinates (or under the mouse cursor if omitted), via tools/color_picker.py.",
          parameters: {
            type: "object",
            properties: {
              x: { type: "integer", description: "X coordinate. Omit both x and y to use the current mouse position." },
              y: { type: "integer", description: "Y coordinate." },
            },
          },
        },
        {
          name: "idle_time",
          description: "Reports how many seconds it's been since the user last touched the keyboard or mouse, via tools/idle_time.py. Use for 'am I still there' checks or to decide whether to run something only while the user is away.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "clipboard_history",
          description: "PRIVACY-SENSITIVE and OFF by default (the user must enable IRIS_CLIPBOARD_HISTORY=1). Short-lived clipboard history via tools/clipboard_history.py: 'start' a background watcher (keeps entries ~10 minutes, max 20, skips passwords/OTP/card numbers), 'list'/'use' entries, 'stop' (also wipes), 'clear'. Listed text is sent to the cloud model. Tell the user when you start it.",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", description: "One of: start, stop, list, use, clear." },
              limit: { type: "integer", description: "Max entries to return for 'list'. Defaults to 10." },
              index: { type: "integer", description: "Entry index to re-copy to the clipboard, required for 'use'." },
            },
            required: ["action"],
          },
        },
        {
          name: "quick_reminder",
          description: "Schedules a one-off reminder that fires N minutes from now as a desktop notification, (managed inside Iris, saved to disk, survives restarts; reminders more than 1 hour overdue at startup are dropped) — unlike send_desktop_notification, this doesn't fire immediately. Also lists or cancels pending reminders. Max 7 days.",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", description: "One of: schedule, list, cancel." },
              minutes: { type: "number", description: "Minutes from now the reminder should fire. Required for 'schedule'." },
              title: { type: "string", description: "Notification title. Required for 'schedule'." },
              message: { type: "string", description: "Notification body. Required for 'schedule'." },
              id: { type: "string", description: "Reminder id to cancel, required for 'cancel' (get it from 'list')." },
            },
            required: ["action"],
          },
        },
        {
          name: "wifi_manager",
          description: "Manages Wi-Fi via tools/wifi_manager.py: scan nearby networks, list saved profiles, connect to an already-known SSID, disconnect, or check connection status. Cannot connect to a brand-new network it has no saved profile for (passwords are never accepted here for security) — tell the user to connect once manually first in that case.",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", description: "One of: list, profiles, connect, disconnect, status." },
              ssid: { type: "string", description: "Network name, required for 'connect'." },
            },
            required: ["action"],
          },
        },
        {
          name: "multi_monitor_info",
          description: "Lists every monitor attached to the machine — position, resolution, which one is primary — via tools/multi_monitor_info.py. Useful before choosing coordinates for mouse_control/magic_move on a multi-monitor setup.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "process_manager",
          description: "Lists running processes by top CPU or RAM usage, or CLOSES every instance of one executable by exact name (e.g. 'chrome.exe'), via tools/process_manager.py. Kill is GRACEFUL by default (window-close request; unsaved-data prompts still appear); set force=true only if the user accepts losing unsaved data. Wildcards, paths, system processes and Iris itself are refused. Always list first so you kill the right name.",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", description: "One of: list, kill." },
              sort: { type: "string", description: "For 'list': 'cpu' or 'ram'. Defaults to 'ram'." },
              top: { type: "integer", description: "For 'list': how many processes to return. Defaults to 10." },
              name: { type: "string", description: "Exact process/executable name to close, e.g. 'chrome.exe'. Required for 'kill'. No wildcards." },
              force: { type: "boolean", description: "For 'kill': force-terminate (may lose unsaved data). Only after the user explicitly agrees." },
            },
            required: ["action"],
          },
        },
        {
          name: "focus_assist",
          description: "Opens Windows' Focus Assist (Do Not Disturb) settings page via tools/focus_assist.py. There is no official Windows API to toggle it silently, so this opens the real settings screen for the user to pick a mode — tell them that when you call it.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "lock_screen",
          description: "Locks the Windows session immediately via tools/lock_screen.py. Confirm with the user before calling this, since it will require them to re-enter their password/PIN to get back in.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "check_claude_status",
          description: "Check if the Claude Code CLI is installed and ready. Use this for questions about Claude status.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "toggle_screen_vision",
          description: "Turn on or off the Live Screen Context feature, allowing you to continuously see what is on the user's primary monitor. Invoke this when the user asks you to start or stop looking at their screen.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "list_robots",
          description: "List all available robots in the user's configuration.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "toggle_robot_vision",
          description: "Turn on or off the Live Robot Vision feature for a specific robot, allowing you to continuously see its camera feed. Invoke this when the user asks you to start or stop looking through a robot's eyes/camera.",
          parameters: {
            type: "object",
            properties: {
              robot_id: { type: "string", description: "The ID of the robot to view." }
            }
          },
        },
        {
          name: "toggle_camera_stream_vision",
          description: "Turn on or off Direct Stream Vision: watch the Companion phone camera (WebRTC) feed directly instead of capturing the entire desktop screen. Invoke this when the user asks you to watch/follow/monitor 'the camera' or the phone/companion camera specifically (e.g. 'hãy theo dõi camera', 'nhìn qua camera điện thoại giúp tôi') rather than the computer screen.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "list_smarthome_cameras",
          description: "List all available smart home cameras in the user's configuration (smarthome_cameras.json).",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "toggle_smarthome_vision",
          description: "Turn on or off Live Smart Home Camera Vision for a specific home camera (e.g. an ESPHome esp32_camera device from setupsmarthome/myiris_smarthome_camera.yaml), allowing you to continuously see through it. Invoke this when the user asks you to watch/monitor a smart home camera (e.g. 'nhìn qua camera phòng khách', 'xem camera cửa trước giúp tôi').",
          parameters: {
            type: "object",
            properties: {
              camera_id: { type: "string", description: "The ID of the smart home camera to view (key in smarthome_cameras.json)." }
            }
          },
        },
        {
          name: "open_companion_live_view",
          description: "Open a large, centered live video window showing the connected phone's camera feed in real time (smooth video, not the 3.5s AI vision snapshots). Invoke this when the user asks to see/open/watch the phone camera themselves (e.g. 'mở camera điện thoại lên cho tôi xem', 'cho tôi xem camera điện thoại').",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "trigger_robot_action",
          description: "Send a physical control command to a specific robot (e.g., move, turn, grab). Invoke this when the user asks you to control a physical robot.",
          parameters: {
            type: "object",
            properties: {
              robot_id: { type: "string", description: "The ID of the robot to control." },
              action: { type: "string", description: "Action: 'forward', 'backward', 'left', 'right', 'stop' (aliases like 'move_forward'/'turn_left' are accepted), or 'arm_move'." },
              params: { type: "object", description: "Optional. For drive actions: duration_ms (default 1000, max 5000) — the robot stops by itself afterwards. For arm_move: base/shoulder/elbow/gripper angles 0-180." }
            },
            required: ["robot_id", "action"]
          }
        },
        {
          name: "trigger_smart_home",
          description: "Control smart home devices like lights, AC, or fans. Invoke this when the user asks you to turn on/off or adjust a physical device in their room/house.",
          parameters: {
            type: "object",
            properties: {
              device: { type: "string", description: "The name of the device (e.g., 'studio lights', 'fan')" },
              action: { type: "string", description: "The action to perform (e.g., 'on', 'off', 'red')" }
            },
            required: ["device", "action"]
          }
        },
        {
          name: "get_iris_status",
          description:
            "Report what Iris is currently doing across ALL parallel lanes at once — background computer-use sessions, browser actions, and smart-home automations — plus whether silent mode is on. Use for 'what are you doing right now' / 'what's still running' questions. For Claude Code work specifically, use check_claude_status or get_claude_task_status instead.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "get_action_status",
          description: "Check the status (queued/running/completed/error) of a background action previously started by start_computer_use_task, given its action id.",
          parameters: {
            type: "object",
            properties: { action_id: { type: "string", description: "The id returned when the action was started." } },
            required: ["action_id"],
          },
        },
        {
          name: "stop_action",
          description: "Stop a running or queued background action (e.g. a computer-use session) by its action id.",
          parameters: {
            type: "object",
            properties: { action_id: { type: "string", description: "The id of the action to stop." } },
            required: ["action_id"],
          },
        },
        {
          name: "browser_open",
          description:
            "Open a URL in Iris's own automated browser tab (separate from start_computer_use_task's full-screen control). Fast and precise for simple browsing — use this instead of the computer-use tool whenever the request is purely about a webpage.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "The URL or bare domain to open, e.g. 'https://google.com' or 'wikipedia.org'." },
              headless: { type: "boolean", description: "True (default) to run without a visible window; false to show the browser window." },
            },
            required: ["url"],
          },
        },
        {
          name: "browser_click",
          description: "Click an element on the currently open page in Iris's automated browser tab, by its visible text or a CSS selector.",
          parameters: {
            type: "object",
            properties: {
              text: { type: "string", description: "Visible text of the element to click, e.g. 'Sign in'." },
              selector: { type: "string", description: "A CSS selector, if known, as an alternative to text." },
            },
          },
        },
        {
          name: "browser_type",
          description: "Type text into a field on the currently open page in Iris's automated browser tab (e.g. a search box), optionally pressing Enter after.",
          parameters: {
            type: "object",
            properties: {
              text: { type: "string", description: "The text to type." },
              selector: { type: "string", description: "CSS selector of the input field; if omitted, types into whatever is focused." },
              submit: { type: "boolean", description: "Press Enter after typing (e.g. to submit a search)." },
            },
            required: ["text"],
          },
        },
        {
          name: "browser_extract_text",
          description: "Read back the visible text of the currently open page (or a specific element) in Iris's automated browser tab — use this to answer questions about page content aloud.",
          parameters: {
            type: "object",
            properties: { selector: { type: "string", description: "CSS selector to read from; omit to read the whole page." } },
          },
        },
        {
          name: "browser_screenshot",
          description: "Take a screenshot of the currently open page in Iris's automated browser tab.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "browser_close",
          description: "Close Iris's automated browser tab/session.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "create_smarthome_rule",
          description:
            "Create a standing smart-home automation from a natural-language request, e.g. 'turn off the living room light at 10pm' or 'turn on the fan every 30 minutes'. Translate what the user said into the structured trigger/condition/action fields yourself before calling this — do not ask the user to phrase it in structured form.",
          parameters: {
            type: "object",
            properties: {
              label: { type: "string", description: "Short human label for the rule." },
              trigger: {
                type: "object",
                description:
                  "Either { type: 'time', at: 'HH:MM' } for a specific time each day, or { type: 'interval', every_minutes: N } to repeat every N minutes.",
              },
              condition: {
                type: "object",
                description:
                  "Optional. { type: 'none' } (default) or { type: 'day_of_week', days: ['mon','tue',...] } to restrict which days it can fire.",
              },
              action: {
                type: "object",
                description: "{ device: string, action: string } — same device/action names used by trigger_smart_home.",
              },
            },
            required: ["trigger", "action"],
          },
        },
        {
          name: "list_smarthome_rules",
          description: "List all smart-home automation rules currently configured, with their status (enabled/disabled).",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "delete_smarthome_rule",
          description: "Delete a smart-home automation rule by its id.",
          parameters: {
            type: "object",
            properties: { rule_id: { type: "string", description: "The rule id from list_smarthome_rules." } },
            required: ["rule_id"],
          },
        },
        {
          name: "set_smarthome_rule_enabled",
          description: "Enable or disable a smart-home automation rule without deleting it.",
          parameters: {
            type: "object",
            properties: {
              rule_id: { type: "string", description: "The rule id from list_smarthome_rules." },
              enabled: { type: "boolean", description: "True to enable, false to pause it." },
            },
            required: ["rule_id", "enabled"],
          },
        },
        {
          name: "set_silent_mode",
          description:
            "Turn Iris's spoken voice output on or off. When silent mode is on, Iris keeps listening and keeps responding (in the Comms text panel) but does not play audio out loud — use when the user asks for quiet, whisper mode, 'don't talk out loud', or to be muted, and to turn it back off when they ask to speak normally again.",
          parameters: {
            type: "object",
            properties: { enabled: { type: "boolean", description: "True to go silent, false to resume speaking aloud." } },
            required: ["enabled"],
          },
        },
        {
          name: "display_hud_message",
          description: "Display a large, glowing text message directly on the center of the user's screen in the Iris Glass HUD. Use this for presenting reports, summaries, or alerts directly to the user instead of opening external text editors like notepad.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "The title of the message (e.g., 'Morning Report')." },
              content: { type: "string", description: "The body of the message." }
            },
            required: ["title", "content"]
          }
        },
        {
          name: "take_desk_snapshot",
          description: "Take a single snapshot of the user's physical desk/environment using their external camera (e.g. phone camera). Invoke this ONLY when the user explicitly asks you to look at their desk or physical objects.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "toggle_meeting_recorder",
          description: "Start or stop recording a Zoom/Google Meet meeting. When stopped, it will automatically use Gemini to transcribe and summarize the meeting.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "toggle_live_transcriber",
          description: "Start or stop the Live Teleprompter which transcribes spoken words in real-time and displays them on the HUD.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "submit_local_chat",
          description: "Forward the user's query to the local Ollama AI. Invoke this ONLY when you receive SYSTEM_EVENT_LOCALCHAT_TOGGLE setting it to true.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "The exact words the user just said." }
            },
            required: ["query"]
          }
        },
        {
          name: "save_to_memory",
          description: "Save an important fact or user note to the Second Brain (ChromaDB). Invoke this when the user says 'remember this' or asks you to save something for later.",
          parameters: {
            type: "object",
            properties: {
              text: { type: "string", description: "The information to remember." }
            },
            required: ["text"]
          }
        },
        {
          name: "query_memory",
          description: "Query the Second Brain (ChromaDB) for past context. Invoke this BEFORE answering if the user asks a question about past conversations, previous instructions, or something you were told to remember.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "The search query." }
            },
            required: ["query"]
          }
        },
        {
          name: "submit_claude_task",
          description:
            "Immediately hand actionable work to Claude. Invoke for deals, shopping, research, coding, file work, terminal tasks, summaries, automations, or anything requiring tools. Do not ask the user clarifying questions first. Claude works in ONE continuous session: it remembers previous tasks in the session, and runs tasks one at a time — if it is busy, the new task is queued and starts automatically (the response will say 'queued'). IMPORTANT: Claude cannot hear this voice conversation — the 'task' string is the only new information it gets, so write a complete brief with every concrete detail.",
          parameters: {
            type: "object",
            properties: {
              task: {
                type: "string",
                description:
                  "The task for Claude in clear English, shaped to the role per the BRIEF WRITING rules in your instructions. For the PO role: a SHORT control intent (start-and-grill / propose the change / are there tasks left? / archive) plus the concrete details the user gave — never a PRD. For a plain task or the DEV role: a COMPLETE brief with the goal, every concrete detail the user gave (names, numbers, URLs, dates, budgets, constraints), sensible defaults, and the expected output; DEV is told to implement the open OpenSpec change. Claude remembers earlier tasks in this session, so follow-ups may reference previous work, but never omit new details.",
              },
              urgency: { type: "string", description: "low, normal, or high." },
              agent: {
                type: "string",
                description:
                  "Optional role to run the task as: 'po' (Product Owner — grills, then proposes an OpenSpec change), 'dev' (Developer — implements the open change's remaining tasks and verifies), or 'study' (Study librarian — records the user's synthesized note into their second brain, or fact-checks a note). ONLY set this when the user explicitly names a role (e.g. 'have the PO grill this…', 'cho dev làm…', 'save this to my brain…'). Otherwise OMIT it — the session's active agent from the UI is used.",
              },
            },
            required: ["task"],
          },
        },
        {
          name: "get_workspace_info",
          description:
            "Return the current workspace state: the active Claude session, the project folder it works in, and the active pipeline role. ALWAYS call this (never guess) when the user asks which project/folder/directory Claude is working in, what session or role is active, or before describing where work will happen.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "get_claude_task_status",
          description: "Fetch the latest status for a Claude run.",
          parameters: {
            type: "object",
            properties: { run_id: { type: "string" } },
            required: ["run_id"],
          },
        },
        {
          name: "stop_claude_task",
          description: "Stop an active or queued Claude run.",
          parameters: {
            type: "object",
            properties: { run_id: { type: "string" } },
            required: ["run_id"],
          },
        },
        {
          name: "start_new_claude_session",
          description:
            "Start a fresh Claude session with a clean slate (previous task context is forgotten). Call this ONLY when the user explicitly asks for it — e.g. says 'new session', 'phien moi', 'start over', 'iris new session'. Never call it on your own initiative. The user can also switch sessions from the UI.",
          parameters: {
            type: "object",
            properties: {
              label: { type: "string", description: "Optional short name for the new session, if the user gave one." },
            },
          },
        },
        {
          name: "answer_po_question",
          description:
            "Answer the pending question(s) from a live role (Product Owner or Study librarian — see asking_role) after SYSTEM_EVENT_PO_QUESTION. That role's live session is paused waiting for this — call it only once you have collected every answer by voice, never before.",
          parameters: {
            type: "object",
            properties: {
              answers: {
                type: "array",
                description: "One entry per question from the event, in any order.",
                items: {
                  type: "object",
                  properties: {
                    question: { type: "string", description: "The exact question text, copied verbatim from the event." },
                    choice: { type: "string", description: "The option label the user chose for this question." },
                  },
                  required: ["question", "choice"],
                },
              },
            },
            required: ["answers"],
          },
        },
        {
          name: "respond_to_task_review",
          description:
            "Resolve a brief currently parked by the review gate (SYSTEM_EVENT_TASK_REVIEW_PARKED) after submit_claude_task. Only call this once the user has told you by voice to approve or cancel it — approving here always sends the brief exactly as parked (verbatim); if the user wants to change the wording, tell them to edit it on screen instead.",
          parameters: {
            type: "object",
            properties: {
              decision: { type: "string", description: "\"approve\" or \"cancel\"." },
            },
            required: ["decision"],
          },
        },
        {
          name: "set_agent_model",
          description:
            "Change which Claude model a role (PO, DEV, or STUDY) runs on for the active session — e.g. switch DEV to a stronger model to debug a hard problem, then switch it back afterwards. Only call this when the user EXPLICITLY asks to change or switch a role's model; never on your own initiative.",
          parameters: {
            type: "object",
            properties: {
              role: { type: "string", description: "'po', 'dev', or 'study'." },
              model: {
                type: "string",
                description: `One of: ${MODEL_CHOICES.map((choice) => `${choice.id} (${choice.label})`).join(", ")}.`,
              },
            },
            required: ["role", "model"],
          },
        },
        {
          name: "get_ui_context",
          description:
            "Get the current Iris UI context: visible Claude tasks, latest result task, focused task, expanded task, whether history is open, any pending task-chooser candidates, and whether the Glass HUD overlay is active (uiMode). Use before UI-only voice commands like 'open that', 'show latest result', 'close it', or 'show history'.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "control_ui",
          description:
            "Control the Iris UI directly for UI-only requests — open/close/show a Claude task result, task history, or overlays. Use this instead of submit_claude_task when the request is purely about the interface, not new work.",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                description:
                  "One of: open_task, open_task_by_query, open_current_claude_result, open_latest_claude_result, open_claude_history, close_reader, close_history, close_all_overlays, show_task_steps, hide_task_steps, toggle_teleprompter, toggle_copilot, toggle_meeting_recorder, toggle_robot_pip, toggle_companion_pip, toggle_smarthome_pip, toggle_screen_vision, toggle_desk_vision, toggle_camera_stream_vision, open_companion_live_view. Use toggle_* to turn features on/off when requested by the user. Note: If the user says 'thu nhỏ tab' or 'cho nhỏ lại', they mean Picture-in-Picture, so use toggle_robot_pip. If they say 'ẩn tab' or 'dấu trừ', they mean minimize to taskbar, so use minimize_app tool instead. Note: If the user says 'thu nh? tab' or 'cho nh? l?i', they mean Picture-in-Picture, so use toggle_robot_pip. If they say '?n tab' or 'd?u tr?', they mean minimize to taskbar, so use minimize_app tool instead.",
              },
              target_id: {
                type: "string",
                description: "Optional exact Claude task id for open_task, show_task_steps, or hide_task_steps.",
              },
              query: {
                type: "string",
                description:
                  "Loose words from the user identifying a card, usable with open_task_by_query, show_task_steps, and hide_task_steps — e.g. 'failed one', 'the deals card', 'second one'. The renderer fuzzy-matches this against visible task titles/status. For open_task_by_query, close matches show a chooser overlay instead of guessing.",
              },
            },
            required: ["action"],
          },
        },
        {
          name: "view_image",
          description: "Show the user (NOT you) screenshots that were SAVED to disk (take_ai_screenshot with save=true) in a small floating window. It does not give you the image — use take_ai_screenshot to see the screen yourself. Reports an error if there are no saved screenshots or the viewer cannot start (needs Pillow + tkinter).",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                description: "The action to perform: 'latest' (open the most recent screenshot), 'prev' (show the older screenshot), 'next' (show the newer screenshot), or 'close' (close the image viewer)."
              }
            },
            required: ["action"]
          }
        },
        {
          name: "get_system_stats",
          description: "Read-only system health via tools/sys_monitor.py: CPU %, RAM used/total, system-drive usage and battery (laptops). Use for 'how is my computer doing', 'how much battery is left'. Warn the user if RAM or disk is above 90%.",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "go_to_sleep",
          description:
            "Put Iris to sleep (end this voice session). Call ONLY when the user explicitly asks — e.g. 'go to sleep', 'sleep now', 'goodnight Iris', 'that's all for today'. Say a very short goodbye BEFORE calling this; the session ends a few seconds later. The wake word (if enabled) keeps working, so they can wake Iris again by voice.",
          parameters: { type: "object", properties: {} },
        },
      ],
    },
  
        {
          name: "power_manager",
          description: "Manages system power states via tools/power_manager.py. shutdown/restart start after a 5 s delay (cancelable with `shutdown /a`). sleep may become hibernate if Windows hibernation is enabled (the result says so).",
          input_schema: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["sleep", "shutdown", "restart"], description: "The power action to perform." }
            },
            required: ["action"]
          }
        },
        {
          name: "media_control",
          description: "Controls media playback (play/pause, next, prev) via tools/media_control.py. Works universally for Spotify, YouTube, Apple Music, etc.",
          input_schema: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["playpause", "next", "prev"], description: "The media action to perform." }
            },
            required: ["action"]
          }
        },
        {
          name: "desktop_manager",
          description: "Manages virtual desktops and boss key via tools/desktop_manager.py.",
          input_schema: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["new", "close", "left", "right", "boss"], description: "The desktop action to perform. 'boss' minimizes all windows." }
            },
            required: ["action"]
          }
        },
];
}

