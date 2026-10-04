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
import { emitToRenderer, emitEvent } from "./events.mjs";
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
import { triggerRobotActionTimed } from "./robot-actions.mjs";
import { createConfirmGate } from "./dangerous-tools.mjs";
import { triggerSmartHome } from "./robot-actions.mjs";
import {
  toggleScreenVision,
  toggleRobotVision,
  toggleCameraStreamVision,
  toggleSmartHomeVision,
  requestDeskSnapshot,
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
  mouseControlTool,
  activeWindowInfoTool,
  ocrRegionTool,
  colorPickerTool,
  idleTimeTool,
  clipboardHistoryTool,
  quickReminderTool,
  wifiManagerTool,
  multiMonitorInfoTool,
  processManagerTool,
  focusAssistTool,
  lockScreenTool,
  viewImageTool,
  moveWindowPreciseTool,
  powerManagerTool,
  mediaControlTool,
  desktopManagerTool,
  searchEverythingTool,
  readNotificationsTool,
  sysMonitorTool,
} from "./local-tools.mjs";

// S-11: xác nhận hai bước cho tool nguy hiểm (shutdown/kill/tắt wifi...). Hiện cảnh báo lên HUD/log.
const confirmGate = createConfirmGate({
  onPending: ({ what }) =>
    emitEvent({ type: "log", level: "warn", message: `⚠ Đang chờ xác nhận thao tác nguy hiểm: ${what}` }),
});

export async function executeClaudeTool(name, args = {}) {
  const blocked = confirmGate.check(name, args);
  if (blocked) return blocked;
  if (args && "confirm_token" in args) {
    const { confirm_token: _t, ...rest } = args;
    args = rest;
  }
  switch (name) {
    case "search_local_files":
      return searchEverythingTool(args);
    case "read_system_notifications":
      return readNotificationsTool(args);
    case "display_hud_message":
      enterHud();
      if (mainWindow) {
        mainWindow.webContents.send("hud:message", { title: args.title, content: args.content });
      }
      return { status: "success", message: "HUD message displayed." };
    case "take_desk_snapshot":
      // V-12: chỉ báo success khi frame thật sự đã tới Gemini (hoặc lỗi/timeout rõ ràng).
      return requestDeskSnapshot();
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
      return triggerRobotActionTimed(args);
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
      return await takeAiScreenshotTool(args);
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
    case "wifi_manager":
      return await wifiManagerTool(args);
    case "multi_monitor_info":
      return await multiMonitorInfoTool();
    case "process_manager":
      return await processManagerTool(args);
    case "focus_assist":
      return await focusAssistTool();
    case "lock_screen":
      return await lockScreenTool();
    case "view_image":
      return await viewImageTool(args);
    case "move_window_precise":
      return await moveWindowPreciseTool(args);
    
    case "get_system_stats":
      return sysMonitorTool();
    case "power_manager":
      return powerManagerTool(args.action);
    case "media_control":
      return mediaControlTool(args.action);
    case "desktop_manager":
      return desktopManagerTool(args.action);
    default:
      return { status: "error", error: `Unknown tool: ${name}` };
  }
}


