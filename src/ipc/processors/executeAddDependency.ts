import { db } from "../../db";
import { messages } from "../../db/schema";
import { eq } from "drizzle-orm";
import { Message } from "@/ipc/types";
import { readEffectiveSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  ADD_DEPENDENCY_INSTALL_TIMEOUT_MS,
  buildAddDependencyCommand,
  detectPreferredPackageManager,
  ensureSocketFirewallInstalled,
  getCommandExecutionDisplayDetails,
  runCommand,
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

const NPM_PACKAGE_NAME_PATTERN = /^(@[a-z0-9-_.]+\/)?[a-z0-9-_.]+$/;

const DISPLAY_SUMMARY_PATTERNS = [
  /\bblocked\b/i,
  /\bfailed\b/i,
  /\berror\b/i,
  /\bdenied\b/i,
  /\btimed out\b/i,
  /\btimeout\b/i,
  /\betimedout\b/i,
  /\bnpm err!/i,
  /\berr_pnpm_[a-z0-9_]+\b/i,
  /\bE[A-Z][A-Z0-9_]{2,}\b/,
];

const DISPLAY_SUMMARY_NOISE_PATTERNS = [
  /^progress:/i,
  /^packages:\s*[+-]?\d+/i,
  /^npm (?:notice|warn)\b/i,
  /^npm err!\s*(?:a complete log of this run can be found in:|this is probably not a problem with npm\.)/i,
  /^npm err!\s*(?:[A-Za-z]:\\|\/).+/i,
];

function isDisplaySummaryNoise(line: string): boolean {
  return DISPLAY_SUMMARY_NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

function getDisplayLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getFilteredDisplayDetails(value: string): string | undefined {
  const lines = getDisplayLines(value).filter(
    (line) => !isDisplaySummaryNoise(line),
  );

  if (lines.length === 0) {
    return undefined;
  }

  return lines.join("\n");
}

function getDisplaySummary(value: string): string | undefined {
  const lines = getDisplayLines(value);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (
      !isDisplaySummaryNoise(line) &&
      DISPLAY_SUMMARY_PATTERNS.some((pattern) => pattern.test(line))
    ) {
      return line;
    }
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!isDisplaySummaryNoise(line)) {
      return line;
    }
  }

  return lines.at(-1);
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
    const commandDisplayDetails = getCommandExecutionDisplayDetails(error);
    const displayDetails = commandDisplayDetails
      ? (getFilteredDisplayDetails(commandDisplayDetails) ?? message)
      : message;

    super(message);
    this.name = "ExecuteAddDependencyError";
    this.warningMessages = warningMessages;
    this.originalError = error;
    this.displayDetails = displayDetails;
    this.displaySummary = getDisplaySummary(displayDetails) ?? message;
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
      timeoutMs: ADD_DEPENDENCY_INSTALL_TIMEOUT_MS,
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
  const invalidPackage = packages.find(
    (pkg) => !NPM_PACKAGE_NAME_PATTERN.test(pkg),
  );
  if (invalidPackage) {
    throw new ExecuteAddDependencyError({
      error: new DyadError(
        `Invalid npm package name: ${invalidPackage}`,
        DyadErrorKind.Validation,
      ),
      warningMessages: [],
    });
  }

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
