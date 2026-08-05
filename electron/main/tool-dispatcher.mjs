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
} from "./computer-use-tools.mjs";
import {
  createSmarthomeRuleTool,
  listSmarthomeRulesTool,
  deleteSmarthomeRuleTool,
  setSmarthomeRuleEnabledTool,
} from "./smarthome-tools.mjs";

export async function executeClaudeTool(name, args = {}) {
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
    default:
      return { status: "error", error: `Unknown tool: ${name}` };
  }
}
