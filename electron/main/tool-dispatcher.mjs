/**
 * electron/main/tool-dispatcher.mjs
 *
 * The single dispatch point for every tool Gemini Live can call by name
 * (see electron/main/claude-tools-catalog.mjs for the schemas). Necessarily
 * touches almost every other domain module — this is the intended "glue"
 * layer, kept separate from gemini-live.mjs so the session-lifecycle code
 * stays readable on its own.
 */
import { saveToMemory, queryMemory } from "../memory-session.mjs";
import { emitToRenderer } from "./events.mjs";
import { mainWindow } from "./window-manager.mjs";
import { enterHud } from "./window-manager.mjs";
import { checkClaudeStatus } from "./claude-cli.mjs";
import { sleepDelayMs } from "./env-config.mjs";
import { workspaceInfo } from "./session-store.mjs";
import { resolvePendingPoQuestion } from "./po-questions.mjs";
import { respondToTaskReview } from "./task-review-flow.mjs";
import {
  submitClaudeTask,
  getClaudeTaskStatus,
  stopClaudeTask,
  startNewClaudeSession,
  setAgentModelTool,
} from "./claude-runner.mjs";
import { getRobotsConfig, getSmartHomeCamerasConfig } from "./device-config.mjs";
import { triggerRobotAction } from "./robot-actions.mjs";
import { triggerSmartHome } from "./robot-actions.mjs";
import {
  toggleScreenVision,
  toggleRobotVision,
  toggleCameraStreamVision,
  toggleSmartHomeVision,
} from "./vision.mjs";
import { toggleMeetingRecording } from "./meeting-recording.mjs";
import { toggleLiveTranscriber } from "./teleprompter.mjs";
import {
  getUiContext,
  controlUi,
  startComputerUseType,
  submitLocalChat,
  openUrlOrApp,
  getIrisStatusTool,
  getActionStatusTool,
  stopActionTool,
  startComputerUseTaskLaned,
  startOmniParserTask,
  setSilentModeTool,
  browserOpenTool,
  browserClickTool,
  browserTypeTool,
  browserExtractTextTool,
  browserScreenshotTool,
  browserCloseTool,
  closeAppTool,
  hideAppTool,
  minimizeAppTool,
  restoreAppTool,
  writeNoteTool,
} from "./computer-use-tools.mjs";
import {
  createSmarthomeRuleTool,
  listSmarthomeRulesTool,
  deleteSmarthomeRuleTool,
  setSmarthomeRuleEnabledTool,
} from "./smarthome-tools.mjs";
import {
  takeAiScreenshotTool,
  readClipboardTool,
  writeClipboardTool,
  moveWindowMagicTool,
  sendDesktopNotificationTool,
  systemControlTool,
  systemMonitorTool,
  mouseControlTool,
  activeWindowInfoTool,
  ocrRegionTool,
  colorPickerTool,
  idleTimeTool,
  clipboardHistoryTool,
  quickReminderTool,
  ttsSpeakTool,
  wifiManagerTool,
  multiMonitorInfoTool,
  processManagerTool,
  powerPlanTool,
  focusAssistTool,
  lockScreenTool,
  viewImageTool,
  viewVideoTool,
  recordScreenTool,
} from "./local-tools.mjs";

// -----------------------------------------------------------------------
// Claude fallback on local /tools script failure
// -----------------------------------------------------------------------
// These are exactly the Gemini-callable tool names backed by a script under
// tools/*.py (the "LOCAL /tools SCRIPTS" lane described in gemini-live.mjs's
// system prompt — see local-tools.mjs). When one of these errors out AND
// Claude is enabled, we do NOT hand the raw error back to Gemini to read
// aloud; instead we silently dispatch a fix-it/do-it-instead task to Claude
// (which has full bash access to tools/*.py via `claude --permission-mode
// bypassPermissions`, see claude-runner.mjs) and tell Gemini to say one short
// line instead. If Claude is disabled (IRIS_CLAUDE_ENABLED=false), or the
// tool isn't one of these local scripts, behavior is unchanged: the raw
// error goes back to Gemini as before.
// Tool name -> actual Python filename under tools/. Most match the tool
// name 1:1, but several don't (e.g. take_ai_screenshot -> ai_vision.py,
// read_clipboard/write_clipboard -> clipboard_manager.py, move_window_magic
// -> magic_move.py) — see the runPythonTool()/_runJsonTool() calls in
// local-tools.mjs, which is the source of truth this is kept in sync with.
// Also doubles as the fallback-eligible tool list (its keys), so we don't
// have to maintain the set and the mapping separately.
const LOCAL_SCRIPT_FILENAMES = {
  take_ai_screenshot: "ai_vision.py",
  read_clipboard: "clipboard_manager.py",
  write_clipboard: "clipboard_manager.py",
  move_window_magic: "magic_move.py",
  send_desktop_notification: "notifier.py",
  system_control: "sys_control.py",
  system_monitor: "sys_monitor.py",
  mouse_control: "mouse_control.py",
  active_window_info: "active_window_info.py",
  ocr_region: "ocr_region.py",
  color_picker: "color_picker.py",
  idle_time: "idle_time.py",
  clipboard_history: "clipboard_history.py",
  quick_reminder: "quick_reminder.py",
  tts_speak: "tts_speak.py",
  wifi_manager: "wifi_manager.py",
  multi_monitor_info: "multi_monitor_info.py",
  process_manager: "process_manager.py",
  power_plan: "power_plan.py",
  focus_assist: "focus_assist.py",
  lock_screen: "lock_screen.py",
  view_image: "image_viewer.py",
  view_video: "video_player.py",
  record_screen: "screen_recorder.py",
};
const LOCAL_SCRIPT_TOOL_NAMES = new Set(Object.keys(LOCAL_SCRIPT_FILENAMES));

function isClaudeEnabled() {
  return process.env.IRIS_CLAUDE_ENABLED !== "false";
}

const FALLBACK_SPOKEN_LINE = "Đã xảy ra lỗi, tôi đang chuyển cho Claude xử lý giúp bạn.";

async function fallbackToClaude(name, args, errorMessage) {
  const scriptFile = LOCAL_SCRIPT_FILENAMES[name] || `${name}.py`;
  const brief = [
    `Gemini vừa gọi công cụ local "${name}" (thư mục tools/, script tools/${scriptFile}) với tham số ${JSON.stringify(args)} nhưng bị lỗi: ${errorMessage}.`,
    `Hãy dùng bash để tự chạy/sửa tools/${scriptFile} (ví dụ: python tools/${scriptFile} --help để xem cú pháp), hoặc dùng bất kỳ công cụ nào khác trong danh mục của bạn, để tự sửa lỗi này hoặc hoàn thành tác vụ mà công cụ đó lẽ ra phải làm thay cho người dùng. Bạn chạy ở permission-mode bypassPermissions nên có toàn quyền bash để làm việc này.`,
    "Báo cáo ngắn gọn kết quả khi xong.",
  ].join(" ");
  try {
    const dispatch = await submitClaudeTask({ task: brief });
    return {
      status: "fallback_to_claude",
      tool: name,
      original_error: errorMessage,
      claude_dispatch: dispatch,
      instructions:
        `Do NOT read the original tool error aloud and do NOT describe what went wrong. Say ONLY this short line to the user, then stop talking about it: "${FALLBACK_SPOKEN_LINE}". Claude is already working on it in the background and will report back via SYSTEM_EVENT_CLAUDE_COMPLETE when done.`,
    };
  } catch (dispatchError) {
    // Dispatching to Claude itself failed — fall back to the plain error so
    // the user isn't left with silence and no explanation at all.
    return {
      status: "error",
      error: errorMessage,
      claude_dispatch_error: dispatchError.message,
    };
  }
}

export async function executeClaudeTool(name, args = {}) {
  try {
    const result = await dispatchTool(name, args);
    if (
      result &&
      result.status === "error" &&
      LOCAL_SCRIPT_TOOL_NAMES.has(name) &&
      isClaudeEnabled()
    ) {
      return await fallbackToClaude(name, args, result.error || "Unknown error");
    }
    return result;
  } catch (error) {
    if (LOCAL_SCRIPT_TOOL_NAMES.has(name) && isClaudeEnabled()) {
      return await fallbackToClaude(name, args, error.message);
    }
    return { status: "error", error: error.message };
  }
}

async function dispatchTool(name, args = {}) {
  switch (name) {
    case "display_hud_message":
      enterHud();
      if (mainWindow) {
        mainWindow.webContents.send("hud:message", { title: args.title, content: args.content });
      }
      return { status: "success", message: "HUD message displayed." };
    case "take_desk_snapshot":
      if (mainWindow) {
        mainWindow.webContents.send("vision:snap-desk");
      }
      return { status: "success", message: "Requested a single snapshot of the desk from the frontend." };
    case "trigger_smart_home":
      return triggerSmartHome(args);
    case "list_robots":
      return { status: "success", robots: getRobotsConfig() };
    case "list_smarthome_cameras":
      return { status: "success", cameras: getSmartHomeCamerasConfig() };
    case "toggle_screen_vision":
      return toggleScreenVision();
    case "toggle_robot_vision":
      return toggleRobotVision(args);
    case "toggle_camera_stream_vision":
      return toggleCameraStreamVision();
    case "toggle_smarthome_vision":
      return toggleSmartHomeVision(args);
    case "open_companion_live_view":
      if (mainWindow) mainWindow.webContents.send("companion:open-live-view");
      return { status: "success", message: "Requested to open the Companion Live View window." };
    case "trigger_robot_action":
      return triggerRobotAction(args);
    case "toggle_meeting_recorder":
      return toggleMeetingRecording();
    case "toggle_live_transcriber":
      return toggleLiveTranscriber();
    case "start_computer_use_task":
      return startComputerUseTaskLaned(args);
    case "computer_use_omniparser":
      return startOmniParserTask(args);
    case "computer_use_type":
      return startComputerUseType(args);
    case "get_iris_status":
      return getIrisStatusTool();
    case "get_action_status":
      return getActionStatusTool(args);
    case "stop_action":
      return stopActionTool(args);
    case "browser_open":
      return browserOpenTool(args);
    case "browser_click":
      return browserClickTool(args);
    case "browser_type":
      return browserTypeTool(args);
    case "browser_extract_text":
      return browserExtractTextTool(args);
    case "browser_screenshot":
      return browserScreenshotTool(args);
    case "browser_close":
      return browserCloseTool(args);
    case "create_smarthome_rule":
      return createSmarthomeRuleTool(args);
    case "list_smarthome_rules":
      return listSmarthomeRulesTool();
    case "delete_smarthome_rule":
      return deleteSmarthomeRuleTool(args);
    case "set_smarthome_rule_enabled":
      return setSmarthomeRuleEnabledTool(args);
    case "set_silent_mode":
      return setSilentModeTool(args);
    case "check_claude_status":
      return checkClaudeStatus();
    case "submit_claude_task":
      if (process.env.IRIS_CLAUDE_ENABLED === "false") {
        return {
          status: "error",
          error: "Claude is disabled in Settings. Apologize to the user and kindly ask them to enable Claude in the Settings if they want to do this task.",
        };
      }
      return submitClaudeTask(args);
    case "get_claude_task_status":
      return getClaudeTaskStatus(args);
    case "stop_claude_task":
      return stopClaudeTask(args);
    case "start_new_claude_session":
      return startNewClaudeSession(args);
    case "submit_local_chat":
      return submitLocalChat(args);
    case "save_to_memory":
      return saveToMemory(args.text);
    case "query_memory":
      return queryMemory(args.query);
    case "get_workspace_info":
      return workspaceInfo();
    case "answer_po_question":
      return resolvePendingPoQuestion(args.answers);
    case "respond_to_task_review":
      return respondToTaskReview(args);
    case "set_agent_model":
      return setAgentModelTool(args);
    case "get_ui_context":
      return getUiContext();
    case "control_ui":
      return controlUi(args);
    case "go_to_sleep":
      // Give the goodbye a moment to play before the renderer tears down
      // audio (its stop() flushes playback immediately).
      setTimeout(() => emitToRenderer("iris:sleep", {}), sleepDelayMs());
      return {
        status: "sleeping",
        instructions: `Say a one-line goodbye right now (nothing else, no new topics). Iris goes to sleep in about ${Math.round(sleepDelayMs() / 1000)} seconds.`,
      };
    case "open_url_or_app":
      return await openUrlOrApp(args);
    case "close_app":
      return await closeAppTool(args);
    case "hide_app":
      return await hideAppTool(args);
    case "minimize_app":
      return await minimizeAppTool(args);
    case "restore_app":
      return await restoreAppTool(args);
    case "write_note":
      return await writeNoteTool(args);
    case "take_ai_screenshot":
      return await takeAiScreenshotTool();
    case "read_clipboard":
      return await readClipboardTool();
    case "write_clipboard":
      return await writeClipboardTool(args);
    case "move_window_magic":
      return await moveWindowMagicTool(args);
    case "send_desktop_notification":
      return await sendDesktopNotificationTool(args);
    case "system_control":
      return await systemControlTool(args);
    case "system_monitor":
      return await systemMonitorTool();
    case "mouse_control":
      return await mouseControlTool(args);
    case "active_window_info":
      return await activeWindowInfoTool();
    case "ocr_region":
      return await ocrRegionTool(args);
    case "color_picker":
      return await colorPickerTool(args);
    case "idle_time":
      return await idleTimeTool();
    case "clipboard_history":
      return await clipboardHistoryTool(args);
    case "quick_reminder":
      return await quickReminderTool(args);
    case "tts_speak":
      return await ttsSpeakTool(args);
    case "wifi_manager":
      return await wifiManagerTool(args);
    case "multi_monitor_info":
      return await multiMonitorInfoTool();
    case "process_manager":
      return await processManagerTool(args);
    case "power_plan":
      return await powerPlanTool(args);
    case "focus_assist":
      return await focusAssistTool();
    case "lock_screen":
      return await lockScreenTool();
    case "view_image":
      return await viewImageTool(args);
    case "view_video":
      return await viewVideoTool(args);
    case "record_screen":
      return await recordScreenTool(args);
    default:
      return { status: "error", error: `Unknown tool: ${name}` };
  }
}
