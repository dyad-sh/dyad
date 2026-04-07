import { db } from "../../db";
import { messages } from "../../db/schema";
import { eq } from "drizzle-orm";
import { Message } from "@/ipc/types";
import { readEffectiveSettings } from "@/main/settings";
import {
  buildAddDependencyCommand,
  detectPreferredPackageManager,
  ensureSocketFirewallInstalled,
  getCommandExecutionDisplayDetails,
  isSocketFirewallPolicyBlock,
  runCommand,
  SOCKET_FIREWALL_FALLBACK_WARNING_MESSAGE,
} from "@/ipc/utils/socket_firewall";
import { escapeXmlAttr, escapeXmlContent } from "../../../shared/xmlEscape";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPackagesAttrPattern(packages: string[]): string {
  const rawPackages = packages.join(" ");
  const escapedPackages = escapeXmlAttr(rawPackages);
  const packageVariants = new Set([rawPackages, escapedPackages]);

  return Array.from(packageVariants).map(escapeRegExp).join("|");
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

async function runAddDependencyCommand(
  command: { command: string; args: string[] },
  appPath: string,
): Promise<{
  succeeded: boolean;
  installResults: string;
  lastError: unknown;
}> {
  try {
    const { stdout, stderr } = await runCommand(command.command, command.args, {
      cwd: appPath,
    });
    return {
      succeeded: true,
      installResults: stdout + (stderr ? `\n${stderr}` : ""),
      lastError: null,
    };
  } catch (error) {
    return {
      succeeded: false,
      installResults: "",
      lastError: error,
    };
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
  const settings = await readEffectiveSettings();
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

  const packageManager = await detectPreferredPackageManager();
  let { succeeded, installResults, lastError } = await runAddDependencyCommand(
    buildAddDependencyCommand(packages, packageManager, useSocketFirewall),
    appPath,
  );

  if (
    !succeeded &&
    useSocketFirewall &&
    lastError &&
    !isSocketFirewallPolicyBlock(lastError)
  ) {
    warningMessages.push(SOCKET_FIREWALL_FALLBACK_WARNING_MESSAGE);
    ({ succeeded, installResults, lastError } = await runAddDependencyCommand(
      buildAddDependencyCommand(packages, packageManager, false),
      appPath,
    ));
  }

  if (!succeeded && lastError) {
    throw new ExecuteAddDependencyError({
      error: lastError,
      warningMessages,
    });
  }

  // Update the message content with the installation results
  const escapedPackages = escapeXmlAttr(packages.join(" "));
  const updatedContent = message.content.replace(
    new RegExp(
      `<dyad-add-dependency packages="(?:${buildPackagesAttrPattern(packages)})">[\\s\\S]*?</dyad-add-dependency>`,
      "g",
    ),
    `<dyad-add-dependency packages="${escapedPackages}">${escapeXmlContent(installResults)}</dyad-add-dependency>`,
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
