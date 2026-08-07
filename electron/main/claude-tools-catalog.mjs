/**
 * electron/main/claude-tools-catalog.mjs
 *
 * The Gemini Live "function calling" tool catalog: declarative schemas for
 * every tool Iris can invoke (start a Claude run, control smart-home
 * devices, drive the browser/computer, ...). Pure data — the actual
 * handlers live in electron/main/tool-dispatcher.mjs.
 */
import { MODEL_CHOICES } from "./agent-roster.mjs";

export function buildClaudeTools() {
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
                description: "The name of a specific key to press (e.g. 'enter', 'esc', 'tab', 'backspace')."
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
          description: "Minimize an open local application on Windows to the taskbar. Invoke this when the user asks you to hide or minimize an app without closing it. Provide the executable name (e.g., 'calc.exe', 'notepad.exe', 'Code.exe').",
          parameters: {
            type: "object",
            properties: {
              target: { type: "string", description: "The executable name to minimize (e.g. 'Discord.exe')." }
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
              action: { type: "string", description: "The action to perform (e.g., 'move_forward', 'turn_left', 'grab')" },
              params: { type: "object", description: "Optional parameters for the action (e.g., distance, speed)" }
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
                  "One of: open_task, open_task_by_query, open_current_claude_result, open_latest_claude_result, open_claude_history, close_reader, close_history, close_all_overlays, show_task_steps, hide_task_steps, toggle_teleprompter, toggle_copilot, toggle_meeting_recorder, toggle_robot_pip, toggle_companion_pip, toggle_smarthome_pip, toggle_screen_vision, toggle_desk_vision, toggle_camera_stream_vision, open_companion_live_view. Use toggle_* to turn features on/off when requested by the user.",
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
          name: "go_to_sleep",
          description:
            "Put Iris to sleep (end this voice session). Call ONLY when the user explicitly asks — e.g. 'go to sleep', 'sleep now', 'goodnight Iris', 'that's all for today'. Say a very short goodbye BEFORE calling this; the session ends a few seconds later. The wake word (if enabled) keeps working, so they can wake Iris again by voice.",
          parameters: { type: "object", properties: {} },
        },
      ],
    },
  ];
}
