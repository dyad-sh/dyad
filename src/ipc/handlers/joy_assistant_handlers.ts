/**
 * Joy Assistant IPC Handlers
 *
 * Streaming chat + action execution for the AI platform assistant.
 * Follows the same streaming pattern as help_bot_handlers.ts:
 *   invoke → async stream → safeSend chunks → safeSend end/error
 */

import { ipcMain } from "electron";
import log from "electron-log";
import { safeSend } from "../utils/safe_sender";
import type {
  AssistantChatRequest,
  AssistantSuggestionsRequest,
  AssistantAction,
  AssistantMode,
} from "@/types/joy_assistant_types";

const logger = log.scope("joy-assistant-handlers");

// Active stream tracking for cancellation
const activeStreams = new Map<string, AbortController>();

export function registerJoyAssistantHandlers() {
  // ==========================================================================
  // joy-assistant:chat — Streaming conversation with the assistant
  // ==========================================================================
  ipcMain.handle(
    "joy-assistant:chat",
    async (event, params: AssistantChatRequest) => {
      const { sessionId, message, pageContext, mode } = params;

      if (!sessionId || !message?.trim()) {
        throw new Error("Missing sessionId or message");
      }

      // Cancel any existing stream for this session
      const existing = activeStreams.get(sessionId);
      if (existing) {
        existing.abort();
        activeStreams.delete(sessionId);
      }

      const abortController = new AbortController();
      activeStreams.set(sessionId, abortController);

      // Lazy import to avoid loading the service + smart router at startup
      const { chat } = await import("@/lib/joy_assistant_service");

      // Fire-and-forget the streaming loop
      (async () => {
        try {
          await chat(sessionId, message, pageContext, mode, {
            onDelta: (delta) => {
              safeSend(event.sender, "joy-assistant:response:chunk", {
                sessionId,
                delta,
                done: false,
              });
            },
            onActions: (actions) => {
              safeSend(event.sender, "joy-assistant:response:chunk", {
                sessionId,
                actions,
                done: false,
              });
            },
            onEnd: () => {
              safeSend(event.sender, "joy-assistant:response:end", {
                sessionId,
              });
            },
            onError: (error) => {
              safeSend(event.sender, "joy-assistant:response:error", {
                sessionId,
                error,
              });
            },
          }, abortController.signal);
        } catch (err) {
          if ((err as any)?.name === "AbortError") return;
          logger.error("joy-assistant:chat stream error", err);
          safeSend(event.sender, "joy-assistant:response:error", {
            sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          activeStreams.delete(sessionId);
        }
      })();

      return { ok: true } as const;
    },
  );

  // ==========================================================================
  // joy-assistant:cancel — Abort an active stream
  // ==========================================================================
  ipcMain.handle(
    "joy-assistant:cancel",
    async (_event, sessionId: string) => {
      const controller = activeStreams.get(sessionId);
      if (controller) {
        controller.abort();
        activeStreams.delete(sessionId);
      }
      return { ok: true } as const;
    },
  );

  // ==========================================================================
  // joy-assistant:suggestions — Get contextual suggestions for the current page
  // ==========================================================================
  ipcMain.handle(
    "joy-assistant:suggestions",
    async (_event, params: AssistantSuggestionsRequest) => {
      const { getPageSuggestions } = await import("@/lib/joy_assistant_service");
      return getPageSuggestions(params.pageContext);
    },
  );

  // ==========================================================================
  // joy-assistant:history — Get session message history
  // ==========================================================================
  ipcMain.handle(
    "joy-assistant:history",
    async (_event, sessionId: string) => {
      if (!sessionId) throw new Error("Missing sessionId");
      const { getSessionHistory } = await import("@/lib/joy_assistant_service");
      return getSessionHistory(sessionId);
    },
  );

  // ==========================================================================
  // joy-assistant:clear — Clear session history
  // ==========================================================================
  ipcMain.handle(
    "joy-assistant:clear",
    async (_event, sessionId: string) => {
      if (!sessionId) throw new Error("Missing sessionId");
      const { clearSession } = await import("@/lib/joy_assistant_service");
      clearSession(sessionId);
      return { ok: true } as const;
    },
  );

  // ==========================================================================
  // joy-assistant:set-mode — Change interaction mode
  // ==========================================================================
  ipcMain.handle(
    "joy-assistant:set-mode",
    async (_event, sessionId: string, mode: AssistantMode) => {
      if (!sessionId) throw new Error("Missing sessionId");
      const validModes = ["auto", "do-it-for-me", "guide-me"];
      if (!validModes.includes(mode)) {
        throw new Error(`Invalid mode: ${mode}. Must be one of: ${validModes.join(", ")}`);
      }
      const { setSessionMode } = await import("@/lib/joy_assistant_service");
      setSessionMode(sessionId, mode);
      return { ok: true } as const;
    },
  );

  // ==========================================================================
  // joy-assistant:execute-action — Validate and confirm an action before execution
  // ==========================================================================
  ipcMain.handle(
    "joy-assistant:execute-action",
    async (_event, sessionId: string, action: AssistantAction) => {
      if (!sessionId) throw new Error("Missing sessionId");
      if (!action || !action.type) throw new Error("Invalid action");

      // Validate action shape
      const validTypes = [
        "navigate", "fill", "click", "highlight", "tooltip",
        "create-document", "search", "open-dialog",
        "run-command", "read-file", "write-file", "list-directory",
        "open-app", "open-url", "system-info",
      ];
      if (!validTypes.includes(action.type)) {
        throw new Error(`Invalid action type: ${action.type}`);
      }

      // For fill/click/highlight/tooltip actions, validate the target uses data-joy-assist IDs
      if ("fieldId" in action && typeof action.fieldId === "string") {
        if (action.fieldId.includes("<") || action.fieldId.includes(">")) {
          throw new Error("Invalid fieldId — no HTML allowed");
        }
      }
      if ("targetId" in action && typeof action.targetId === "string") {
        if (action.targetId.includes("<") || action.targetId.includes(">")) {
          throw new Error("Invalid targetId — no HTML allowed");
        }
      }

      // For system-level actions, execute them on the main process side
      if (action.type === "run-command" || action.type === "read-file" ||
          action.type === "write-file" || action.type === "list-directory" ||
          action.type === "open-app" || action.type === "open-url" ||
          action.type === "system-info") {
        const tools = await import("@/lib/joy_assistant_tools");
        let result: unknown;

        switch (action.type) {
          case "run-command":
            result = await tools.runCommand(action.command, action.cwd);
            break;
          case "read-file":
            result = await tools.readFileContent(action.filePath);
            break;
          case "write-file":
            await tools.writeFileContent(action.filePath, action.content);
            result = { success: true, filePath: action.filePath };
            break;
          case "list-directory":
            result = await tools.listDirectory(action.dirPath);
            break;
          case "open-app":
            await tools.openApp(action.appName, action.args);
            result = { success: true, appName: action.appName };
            break;
          case "open-url":
            await tools.openUrl(action.url);
            result = { success: true, url: action.url };
            break;
          case "system-info":
            result = await tools.getSystemInfo(action.infoType);
            break;
        }

        logger.info("System action executed", {
          sessionId,
          actionType: action.type,
        });

        return { approved: true, action, result } as const;
      }

      logger.info("Action approved for execution", {
        sessionId,
        actionType: action.type,
      });

      return { approved: true, action } as const;
    },
  );

  logger.info("Joy Assistant handlers registered");
}
