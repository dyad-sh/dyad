import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getUserDataPath } from "@/paths/paths";
import {
  PlanHandoffIntentSchema,
  PlanHandoffRemoteSnapshotSchema,
} from "./transport";
import type { PlanHandoffHostState } from "./host_state";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const schema = z.object({
  intent: PlanHandoffIntentSchema.nullable(),
  targetChatId: z.number().int().nullable(),
  phase: PlanHandoffRemoteSnapshotSchema.shape.phase,
  failure: z.string().nullable(),
});
const file = (chatId: number) => {
  if (!Number.isSafeInteger(chatId) || chatId <= 0)
    throw new DyadError("Invalid handoff chat", DyadErrorKind.Validation);
  return path.join(getUserDataPath(), "plan-handoffs", `${chatId}.json`);
};

/** Command-side checkpoint, written before starting the next external effect. */
export function persistPlanHandoff(
  chatId: number,
  state: PlanHandoffHostState,
) {
  const destination = file(chatId);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination + ".tmp", JSON.stringify(schema.parse(state)), {
    mode: 0o600,
  });
  renameSync(destination + ".tmp", destination);
}

export function hydratePlanHandoff(
  chatId: number,
  admitted: (intentId: string) => boolean,
): PlanHandoffHostState {
  let state: PlanHandoffHostState;
  try {
    state = schema.parse(JSON.parse(readFileSync(file(chatId), "utf8")));
    if (!state.intent || state.intent.sourceChatId !== chatId)
      throw new DyadError(
        "Invalid saved handoff identity",
        DyadErrorKind.Validation,
      );
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    // A broken journal is never replayed and must not prevent actor creation.
    // A renewed acceptance writes a replacement; durable turn intent admission
    // still provides the exactly-once boundary for an existing handoff ID.
    return {
      intent: null,
      targetChatId: null,
      phase: missing ? "idle" : "failed",
      failure: missing
        ? null
        : "Saved plan handoff could not be read. Review the plan and accept again.",
    };
  }
  if (
    state.phase === "started" ||
    admitted(`${state.intent!.handoffId}:implementation`)
  )
    return { ...state, phase: "started", failure: null };
  if (state.phase === "failed" || state.phase === "cancelled") return state;
  // Never blindly replay a process-dead user decision or operation. A new
  // explicit acceptance is safe only when no durable implementation exists.
  return {
    ...state,
    phase: "failed",
    failure:
      "Plan handoff was interrupted by restart. Review the plan and accept again to continue.",
  };
}
