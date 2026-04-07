import { db } from "../../db";
import { messages } from "../../db/schema";
import { eq } from "drizzle-orm";
import { Message } from "@/ipc/types";
import { readSettings } from "@/main/settings";
import {
  buildAddDependencyCommands,
  ensureSocketFirewallInstalled,
  getCommandExecutionDisplayDetails,
  runCommand,
} from "@/ipc/utils/socket_firewall";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ExecuteAddDependencyResult {
  installResults: string;
  warningMessages: string[];
}

function getFirstNonEmptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

export class ExecuteAddDependencyError extends Error {
  warningMessages: string[];
  originalError: unknown;
  displayDetails: string;
  displaySummary: string;

  constructor({
    error,
    warningMessages,
  }: {
    error: unknown;
    warningMessages: string[];
  }) {
    const message = error instanceof Error ? error.message : String(error);
    const displayDetails = getCommandExecutionDisplayDetails(error) ?? message;

    super(message);
    this.name = "ExecuteAddDependencyError";
    this.warningMessages = warningMessages;
    this.originalError = error;
    this.displayDetails = displayDetails;
    this.displaySummary = getFirstNonEmptyLine(displayDetails) ?? message;
  }
}

export async function executeAddDependency({
  packages,
  message,
  appPath,
}: {
  packages: string[];
  message: Message;
  appPath: string;
}): Promise<ExecuteAddDependencyResult> {
  const settings = readSettings();
  const warningMessages: string[] = [];

  let useSocketFirewall = settings.blockUnsafeNpmPackages !== false;
  if (useSocketFirewall) {
    const socketFirewall = await ensureSocketFirewallInstalled();
    if (!socketFirewall.available) {
      useSocketFirewall = false;
      if (socketFirewall.warningMessage) {
        warningMessages.push(socketFirewall.warningMessage);
      }
    }
  }

  const commands = buildAddDependencyCommands(packages, useSocketFirewall);
  let installResults = "";
  let lastError: unknown;

  for (const command of commands) {
    try {
      const { stdout, stderr } = await runCommand(
        command.command,
        command.args,
        {
          cwd: appPath,
        },
      );
      installResults = stdout + (stderr ? `\n${stderr}` : "");
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw new ExecuteAddDependencyError({
      error: lastError,
      warningMessages,
    });
  }

  // Update the message content with the installation results
  const updatedContent = message.content.replace(
    new RegExp(
      `<dyad-add-dependency packages="${escapeRegExp(packages.join(" "))}">[^<]*</dyad-add-dependency>`,
      "g",
    ),
    `<dyad-add-dependency packages="${packages.join(" ")}">${installResults}</dyad-add-dependency>`,
  );

  // Save the updated message back to the database
  await db
    .update(messages)
    .set({ content: updatedContent })
    .where(eq(messages.id, message.id));

  return {
    installResults,
    warningMessages,
  };
}
