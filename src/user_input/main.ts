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
import type { UserInputCommand } from "./commands";

const subscribers = new Set<WebContents>();
const logger = log.scope("user_input");

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

async function dispatchDueFollowUpInMain(
  command: Extract<UserInputCommand, { type: "broadcast-follow-up-due" }>,
): Promise<void> {
  const { dispatchUserInputFollowUp, waitForChatActorIdle } =
    await import("@/ipc/services/chat_actor_service");
  const isStillDue = () =>
    userInputRegistry
      .getPending()
      .some(
        (pending) =>
          pending.status === "due" &&
          pending.descriptor.requestId === command.requestId,
      );
  while (isStillDue()) {
    await waitForChatActorIdle(command.chatId);
    // App/chat deletion can settle the owner while this dispatcher waits for
    // the previous turn to drain. Do not create a new actor after that sweep;
    // it could otherwise wait forever behind the deletion admission barrier.
    if (!isStillDue()) return;
    const result = await dispatchUserInputFollowUp({
      requestId: command.requestId,
      chatId: command.chatId,
      prompt: command.prompt,
    });
    if (result === "accepted") {
      if (
        userInputRegistry
          .getPending()
          .some(
            (pending) =>
              pending.status === "due" &&
              pending.descriptor.requestId === command.requestId,
          )
      ) {
        await userInputRegistry.followUpDispatched(command.requestId);
      }
      return;
    }
    await userInputRegistry.followUpRejected(command.requestId);
    return;
  }
}

export const userInputRegistry = createUserInputRegistry({
  clock: systemClock,
  idSource: uuidIdSource,
  broadcast,
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
  commandRunner: {
    run(command) {
      if (command.type !== "broadcast-follow-up-due") return;
      return dispatchDueFollowUpInMain(command);
    },
  },
  onCommandError(command, error) {
    logger.error(`User-input command failed: ${command.type}`, error);
  },
});
