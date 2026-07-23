import { db } from "../../db";
import { messages } from "../../db/schema";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Message } from "@/ipc/types";
import { readEffectiveSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  ADD_DEPENDENCY_INSTALL_TIMEOUT_MS,
  buildAddDependencyCommand,
  buildUpdateDependencyCommand,
  commitPnpmAllowBuildsConfigIfChanged,
  ensureSocketFirewallInstalled,
  getCommandExecutionDisplayDetails,
  getPackageManagerCommandEnv,
  getPnpmMinimumReleaseAgeSupport,
  runCommand,
} from "@/ipc/utils/socket_firewall";
import {
  recordAndReportDeniedPnpmBuilds,
  resolvePnpmIgnoredBuilds,
} from "@/ipc/utils/pnpm_denied_builds";
import {
  choosePackageManagerFromSignal,
  getPackageManagerSignal,
  signalPrefersPnpm,
} from "@/ipc/utils/package_manager_selection";
import { shouldShowPnpmMinimumReleaseAgeWarning } from "@/lib/schemas";
import { escapeXmlAttr, escapeXmlContent } from "../../../shared/xmlEscape";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildPackagesAttrPattern(packages: string[]): string {
  const rawPackages = packages.map(escapeRegExp).join("\\s+");
  const escapedPackages = packages
    .map((packageSpec) => escapeRegExp(escapeXmlAttr(packageSpec)))
    .join("\\s+");
  const packageVariants = new Set([rawPackages, escapedPackages]);

  return `\\s*(?:${Array.from(packageVariants).join("|")})\\s*`;
}

export interface ExecuteAddDependencyResult {
  installResults: string;
  warningMessages: string[];
}

const NPM_PACKAGE_NAME_SEGMENT = "[a-z0-9][a-z0-9-_.]*";
const NPM_PACKAGE_NAME_PATTERN = new RegExp(
  `^(?:@${NPM_PACKAGE_NAME_SEGMENT}/)?${NPM_PACKAGE_NAME_SEGMENT}$`,
);
const SEMVER_IDENTIFIER = "[0-9A-Za-z-]+";
const EXACT_VERSION_PATTERN = new RegExp(
  `^\\d+\\.\\d+\\.\\d+(?:-${SEMVER_IDENTIFIER}(?:\\.${SEMVER_IDENTIFIER})*)?(?:\\+${SEMVER_IDENTIFIER}(?:\\.${SEMVER_IDENTIFIER})*)?$`,
);
const PARTIAL_VERSION_PATTERN =
  /^(?:[xX*]|\d+|\d+\.(?:\d+|[xX*])|\d+\.(?:\d+|[xX*])\.[xX*])$/;
const RANGE_VERSION_PATTERN = new RegExp(
  `^[~^](?:\\d+|\\d+\\.\\d+|\\d+\\.\\d+\\.\\d+(?:-${SEMVER_IDENTIFIER}(?:\\.${SEMVER_IDENTIFIER})*)?(?:\\+${SEMVER_IDENTIFIER}(?:\\.${SEMVER_IDENTIFIER})*)?)$`,
);
const DIST_TAG_PATTERN = /^[a-z][a-z0-9._-]*$/i;
const LOCAL_TARBALL_NAME_PATTERN = /\.(?:tgz|tar(?:\.gz)?)$/i;
const INSTALLED_DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
] as const;

interface ParsedPackageSpec {
  name: string;
  raw: string;
  selector: string | undefined;
  exact: boolean;
}

function parsePackageSpec(raw: string): ParsedPackageSpec | null {
  let name = raw;
  let selector: string | undefined;

  if (raw.startsWith("@")) {
    const slashIndex = raw.indexOf("/");
    if (slashIndex === -1) {
      return null;
    }
    const selectorIndex = raw.indexOf("@", slashIndex);
    if (selectorIndex !== -1) {
      name = raw.slice(0, selectorIndex);
      selector = raw.slice(selectorIndex + 1);
    }
  } else {
    const selectorIndex = raw.indexOf("@");
    if (selectorIndex !== -1) {
      name = raw.slice(0, selectorIndex);
      selector = raw.slice(selectorIndex + 1);
    }
  }

  if (
    name.startsWith("-") ||
    !NPM_PACKAGE_NAME_PATTERN.test(name) ||
    (!name.startsWith("@") &&
      selector === undefined &&
      LOCAL_TARBALL_NAME_PATTERN.test(name))
  ) {
    return null;
  }

  if (
    selector !== undefined &&
    !EXACT_VERSION_PATTERN.test(selector) &&
    !PARTIAL_VERSION_PATTERN.test(selector) &&
    !RANGE_VERSION_PATTERN.test(selector) &&
    !DIST_TAG_PATTERN.test(selector)
  ) {
    return null;
  }

  return {
    name,
    raw,
    selector,
    exact: selector !== undefined && EXACT_VERSION_PATTERN.test(selector),
  };
}

function parsePackageSpecs(packages: string[]): ParsedPackageSpec[] {
  if (packages.length === 0) {
    throw new DyadError(
      "At least one npm package is required",
      DyadErrorKind.Validation,
    );
  }

  const parsedSpecs: ParsedPackageSpec[] = [];
  const seenNames = new Set<string>();
  for (const raw of packages) {
    const parsed = parsePackageSpec(raw);
    if (!parsed) {
      throw new DyadError(
        `Invalid npm package spec: ${raw}`,
        DyadErrorKind.Validation,
      );
    }
    if (seenNames.has(parsed.name)) {
      throw new DyadError(
        `Duplicate npm package: ${parsed.name}`,
        DyadErrorKind.Validation,
      );
    }
    seenNames.add(parsed.name);
    parsedSpecs.push(parsed);
  }
  return parsedSpecs;
}

async function readInstalledDependencyNames(
  appPath: string,
): Promise<Set<string>> {
  let packageJsonText: string;
  try {
    packageJsonText = await readFile(
      path.join(appPath, "package.json"),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Set();
    }
    throw error;
  }

  const packageJson = JSON.parse(packageJsonText) as Record<string, unknown>;
  const installedNames = new Set<string>();
  for (const sectionName of INSTALLED_DEPENDENCY_SECTIONS) {
    const section = packageJson[sectionName];
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }
    for (const packageName of Object.keys(section)) {
      installedNames.add(packageName);
    }
  }
  return installedNames;
}

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
  completedPackages: string[];
  installResults: string;

  constructor({
    error,
    warningMessages,
    completedPackages = [],
    installResults = "",
  }: {
    error: unknown;
    warningMessages: string[];
    completedPackages?: string[];
    installResults?: string;
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
    const partialSuccessDetails =
      completedPackages.length > 0
        ? `Installed or updated ${completedPackages.join(", ")} before a later dependency command failed.${installResults ? `\n\n${installResults}` : ""}\n\n`
        : "";
    this.displayDetails = partialSuccessDetails + displayDetails;
    this.displaySummary = getDisplaySummary(displayDetails) ?? message;
    this.completedPackages = completedPackages;
    this.installResults = installResults;
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
    const options = {
      cwd: appPath,
      env: getPackageManagerCommandEnv(),
      timeoutMs: ADD_DEPENDENCY_INSTALL_TIMEOUT_MS,
    };
    const { stdout, stderr } = await runCommand(
      command.command,
      command.args,
      options,
    );
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

function formatDeniedBuildsNote(packageNames: string[]): string {
  if (packageNames.length === 0) {
    return "";
  }

  const packageList = packageNames.join(", ");
  return `\n\nNote: build scripts for ${packageList} were not run (Dyad security policy).`;
}

async function rebuildPromotedPnpmBuilds(
  appPath: string,
  packageNames: string[],
): Promise<void> {
  if (packageNames.length === 0) {
    return;
  }

  try {
    await runCommand("pnpm", ["rebuild", ...packageNames], {
      cwd: appPath,
      env: getPackageManagerCommandEnv(),
      timeoutMs: ADD_DEPENDENCY_INSTALL_TIMEOUT_MS,
    });
  } catch {
    // Best effort: if the build is still broken, the install should not regress.
  }
}

export async function installPackages({
  packages,
  appPath,
  dev = false,
}: {
  packages: string[];
  appPath: string;
  dev?: boolean;
}): Promise<ExecuteAddDependencyResult> {
  let parsedSpecs: ParsedPackageSpec[];
  let installedDependencyNames: Set<string>;
  try {
    parsedSpecs = parsePackageSpecs(packages);
    installedDependencyNames = await readInstalledDependencyNames(appPath);
  } catch (error) {
    throw new ExecuteAddDependencyError({
      error,
      warningMessages: [],
    });
  }
  const updatePackages = parsedSpecs
    .filter(
      ({ name, selector }) =>
        selector === undefined && installedDependencyNames.has(name),
    )
    .map(({ name }) => name);
  const exactPackages = parsedSpecs
    .filter(({ exact }) => exact)
    .map(({ raw }) => raw);
  const packagesToInstall = parsedSpecs
    .filter(
      ({ name, selector, exact }) =>
        !exact &&
        (selector !== undefined || !installedDependencyNames.has(name)),
    )
    .map(({ raw }) => raw);

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

  const pnpmSupport = await getPnpmMinimumReleaseAgeSupport();
  // Choose from the app's own signals (packageManager field, lockfiles,
  // node_modules shape) so add-dependency and the run command agree on the
  // package manager — a pnpm add against an npm-shaped app would purge its
  // node_modules and write a lockfile the run command ignores.
  const signal = getPackageManagerSignal(appPath);
  const packageManager = choosePackageManagerFromSignal({
    signal,
    pnpmAvailable: pnpmSupport.available,
  });
  if (
    signalPrefersPnpm(signal) &&
    !pnpmSupport.minimumReleaseAgeSupported &&
    pnpmSupport.warningMessage &&
    shouldShowPnpmMinimumReleaseAgeWarning(settings)
  ) {
    warningMessages.push(pnpmSupport.warningMessage);
  }
  const promotedPackages =
    packageManager === "pnpm"
      ? (await commitPnpmAllowBuildsConfigIfChanged(appPath)).promotedPackages
      : [];

  const commands = [
    ...(packagesToInstall.length > 0
      ? [
          {
            invocation: buildAddDependencyCommand(
              packagesToInstall,
              packageManager,
              useSocketFirewall,
              { dev },
            ),
            packages: packagesToInstall,
          },
        ]
      : []),
    ...(exactPackages.length > 0
      ? [
          {
            invocation: buildAddDependencyCommand(
              exactPackages,
              packageManager,
              useSocketFirewall,
              { dev, saveExact: true },
            ),
            packages: exactPackages,
          },
        ]
      : []),
    ...(updatePackages.length > 0
      ? [
          {
            invocation: buildUpdateDependencyCommand(
              updatePackages,
              packageManager,
              useSocketFirewall,
            ),
            packages: updatePackages,
          },
        ]
      : []),
  ];

  const commandResults: string[] = [];
  const completedPackages: string[] = [];
  for (const command of commands) {
    const { succeeded, installResults, lastError } =
      await runAddDependencyCommand(command.invocation, appPath);
    if (!succeeded && lastError) {
      throw new ExecuteAddDependencyError({
        error: lastError,
        warningMessages,
        completedPackages,
        installResults: commandResults.join("\n"),
      });
    }
    completedPackages.push(...command.packages);
    if (installResults) {
      commandResults.push(installResults);
    }
  }
  const installResults = commandResults.join("\n");

  await rebuildPromotedPnpmBuilds(appPath, promotedPackages);

  let installResultsWithPolicyNotes = installResults;
  if (packageManager === "pnpm") {
    const ignoredBuilds = await resolvePnpmIgnoredBuilds(appPath);
    // Promotions were already applied (and rebuilt) by the pre-install
    // commitPnpmAllowBuildsConfigIfChanged call above, so this record pass
    // only ever adds denials for builds the install just ignored.
    const { deniedBuilds } = await recordAndReportDeniedPnpmBuilds({
      appPath,
      ignoredBuilds,
      source: "add-dependency",
    });
    if (deniedBuilds.length > 0) {
      installResultsWithPolicyNotes += formatDeniedBuildsNote(
        Array.from(
          new Set(deniedBuilds.map((ignoredBuild) => ignoredBuild.packageName)),
        ).sort((left, right) => left.localeCompare(right)),
      );
    }
  }

  return {
    installResults: installResultsWithPolicyNotes,
    warningMessages,
  };
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
  const { installResults, warningMessages } = await installPackages({
    packages,
    appPath,
  });

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
