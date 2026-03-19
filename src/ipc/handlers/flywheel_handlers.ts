/**
 * Flywheel Handlers — IPC handlers for the Data Flywheel system
 * Captures training pairs, manages feedback, and triggers training cycles.
 */

import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import {
  captureTrainingPair,
  rateMessage,
  correctMessage,
  getFlywheelStats,
  getFlywheelRuns,
  runFlywheelCycle,
  runScheduledFlywheels,
  registerFlywheelN8nWorkflow,
  removeFlywheelN8nWorkflow,
  type CaptureParams,
} from "@/lib/data_flywheel";

const logger = log.scope("flywheel_handlers");
const handle = createLoggedHandler(logger);

export function registerFlywheelHandlers() {
  // Capture a training pair (usually called internally, but also from renderer)
  handle(
    "flywheel:capture-pair",
    async (_event, params: CaptureParams) => {
      if (!params.userInput || !params.assistantOutput) {
        throw new Error("Missing required fields: userInput, assistantOutput");
      }
      return captureTrainingPair(params);
    },
  );

  // Rate a message (thumbs up/down) and capture the training pair
  handle(
    "flywheel:rate-message",
    async (
      _event,
      args: { messageId: number; rating: "positive" | "negative" },
    ) => {
      if (!args.messageId || !args.rating) {
        throw new Error("Missing required fields: messageId, rating");
      }
      await rateMessage(args.messageId, args.rating);
    },
  );

  // Correct a message and capture the correction as a training pair
  handle(
    "flywheel:correct-message",
    async (
      _event,
      args: { messageId: number; correctedOutput: string },
    ) => {
      if (!args.messageId || !args.correctedOutput) {
        throw new Error(
          "Missing required fields: messageId, correctedOutput",
        );
      }
      await correctMessage(args.messageId, args.correctedOutput);
    },
  );

  // Get flywheel stats (total pairs, pending, runs, etc.)
  handle(
    "flywheel:get-stats",
    async (_event, args?: { agentId?: number }) => {
      return getFlywheelStats(args?.agentId);
    },
  );

  // Get flywheel run history
  handle(
    "flywheel:get-runs",
    async (_event, args?: { agentId?: number; limit?: number }) => {
      return getFlywheelRuns(args?.agentId, args?.limit);
    },
  );

  // Manually trigger a flywheel cycle (build dataset + start training)
  handle(
    "flywheel:run-cycle",
    async (_event, args?: { agentId?: number }) => {
      return runFlywheelCycle(args?.agentId);
    },
  );

  // Run scheduled flywheel for all eligible agents
  handle(
    "flywheel:run-scheduled",
    async () => {
      return runScheduledFlywheels();
    },
  );

  // Register/update the n8n flywheel workflow
  handle(
    "flywheel:register-n8n-workflow",
    async (_event, args: { schedule: "daily" | "weekly" }) => {
      if (!args.schedule) {
        throw new Error("Missing required field: schedule");
      }
      return registerFlywheelN8nWorkflow(args.schedule);
    },
  );

  // Remove the n8n flywheel workflow
  handle(
    "flywheel:remove-n8n-workflow",
    async () => {
      await removeFlywheelN8nWorkflow();
    },
  );
}
