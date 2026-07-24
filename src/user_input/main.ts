/** Main-process composition root for the user-input registry. */
import { BrowserWindow, type WebContents } from "electron";
import { and, eq } from "drizzle-orm";
import log from "electron-log";
import { db } from "../db";
import { mcpToolConsents } from "../db/schema";
import { readSettings, writeSettings } from "../main/settings";
import { systemClock, uuidIdSource } from "../state_machines/clock";
import { safeSend } from "../ipc/utils/safe_sender";
import { createUserInputRegistry } from "./registry";
import {
  createUserInputFollowUpHandoffStore,
  type UserInputFollowUpHandoffPayload,
} from "./follow_up_handoff";

const subscribers = new Set<WebContents>();
const logger = log.scope("user_input");
const ownerSessionId = uuidIdSource.next("user-input-owner");
const followUpHandoffs = createUserInputFollowUpHandoffStore(
  db,
  ownerSessionId,
);
let handoffsRecovered = false;

export function prepareUserInputHandoffs(): void {
  if (handoffsRecovered) return;
  followUpHandoffs.recoverOwnerSession();
  handoffsRecovered = true;
}

export function acceptUserInputFollowUp(
  payload: UserInputFollowUpHandoffPayload,
): void {
  prepareUserInputHandoffs();
  followUpHandoffs.accept(payload);
}

export function beginUserInputFollowUpExecution(requestId: string): void {
  prepareUserInputHandoffs();
  followUpHandoffs.beginExecution(requestId);
}

export function retryUserInputFollowUp(requestId: string, error: string): void {
  prepareUserInputHandoffs();
  followUpHandoffs.retry(requestId, error);
}

export function rejectUserInputFollowUp(
  requestId: string,
  reason: string,
): void {
  prepareUserInputHandoffs();
  followUpHandoffs.reject(requestId, reason);
}

export function rememberUserInputSubscriber(sender: WebContents): void {
  if (subscribers.has(sender)) return;
  subscribers.add(sender);
  sender.once?.("destroyed", () => subscribers.delete(sender));
}

function broadcast(channel: string, payload: unknown): void {
  const targets = new Set<WebContents>(subscribers);
  const windows = BrowserWindow?.getAllWindows?.() ?? [];
  for (const window of windows) {
    if (!window.isDestroyed()) targets.add(window.webContents);
  }
  for (const target of targets) safeSend(target, channel, payload);
}

export const userInputRegistry = createUserInputRegistry({
  clock: systemClock,
  idSource: uuidIdSource,
  broadcast,
  persistFollowUpCreated(input) {
    prepareUserInputHandoffs();
    followUpHandoffs.create(input);
  },
  rejectFollowUpHandoff(requestId, reason) {
    rejectUserInputFollowUp(requestId, reason);
  },
  async persistAlways(descriptor, response) {
    if (
      descriptor.kind === "mcp-consent" &&
      response.kind === "mcp-consent" &&
      response.decision === "accept-always"
    ) {
      const rows = await db
        .select()
        .from(mcpToolConsents)
        .where(
          and(
            eq(mcpToolConsents.serverId, descriptor.serverId),
            eq(mcpToolConsents.toolName, descriptor.toolName),
          ),
        );
      if (rows.length > 0) {
        await db
          .update(mcpToolConsents)
          .set({ consent: "always" })
          .where(
            and(
              eq(mcpToolConsents.serverId, descriptor.serverId),
              eq(mcpToolConsents.toolName, descriptor.toolName),
            ),
          );
      } else {
        await db.insert(mcpToolConsents).values({
          serverId: descriptor.serverId,
          toolName: descriptor.toolName,
          consent: "always",
        });
      }
      return;
    }
    if (
      descriptor.kind === "agent-consent" &&
      response.kind === "agent-consent" &&
      response.decision === "accept-always"
    ) {
      const settings = readSettings();
      writeSettings({
        agentToolConsents: {
          ...settings.agentToolConsents,
          [descriptor.toolName]: "always",
        },
      });
    }
  },
  onCommandError(command, error) {
    logger.error(`User-input command failed: ${command.type}`, error);
  },
});
