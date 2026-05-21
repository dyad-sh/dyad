import {
  DEFAULT_PTY_COMMAND_TIMEOUT_MS,
  PtyCommandExecutionError,
  runPtyCommand,
} from "@/ipc/utils/pty_command_runner";
import fs from "node:fs/promises";
import path from "node:path";
import log from "electron-log";
import defaultApproveBuildsText from "@/data/default-approve-builds.txt?raw";
import { gitAdd, gitCommit } from "@/ipc/utils/git_utils";
import { PNPM_MINIMUM_RELEASE_AGE_WARNING_PREFIX } from "@/shared/packageManagerWarnings";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";

export const SOCKET_FIREWALL_WARNING_MESSAGE =
  "the npm firewall could not be installed. Warning: can not check if npm packages are safe";
export const PNPM_MINIMUM_RELEASE_AGE_VERSION = "10.16.0";
export const PNPM_GLOBAL_INSTALL_PACKAGE = "pnpm@latest-11";
const MINIMUM_PACKAGE_RELEASE_AGE_DAYS = 1;
export const MINIMUM_PACKAGE_RELEASE_AGE_MINUTES =
  MINIMUM_PACKAGE_RELEASE_AGE_DAYS * 24 * 60;
export const PNPM_INSTALL_POLICY_ARGS = [
  "--config.confirmModulesPurge=false",
  "--config.strictDepBuilds=false",
];
export const NPM_INSTALL_POLICY_ARGS = [
  `--min-release-age=${MINIMUM_PACKAGE_RELEASE_AGE_DAYS}`,
];
export const PNPM_MINIMUM_RELEASE_AGE_WARNING_MESSAGE = `${PNPM_MINIMUM_RELEASE_AGE_WARNING_PREFIX}${PNPM_MINIMUM_RELEASE_AGE_VERSION} or newer. Dyad uses npm fallback when pnpm cannot enforce the 1-day package release age gate, but pnpm ${PNPM_MINIMUM_RELEASE_AGE_VERSION}+ gives the best protection for app installs.`;
const SOCKET_FIREWALL_PACKAGE = "sfw@2.0.4";
const SOCKET_FIREWALL_NPX_ARGS = [
  "--prefer-offline",
  "--yes",
  SOCKET_FIREWALL_PACKAGE,
];
const WINDOWS_BATCH_COMMAND_PATTERN = /\.(cmd|bat)$/i;
const WINDOWS_CMD_NEEDS_QUOTING_PATTERN = /[\s"&|<>^%!()]/u;
export const SOCKET_FIREWALL_PROBE_TIMEOUT_MS = 30 * 1000;
export const PACKAGE_MANAGER_PROBE_TIMEOUT_MS = 30 * 1000;
export const ADD_DEPENDENCY_INSTALL_TIMEOUT_MS = DEFAULT_PTY_COMMAND_TIMEOUT_MS;
const logger = log.scope("socket_firewall");
const DYAD_ALLOW_BUILDS_SCHEMA = "v1";
const DYAD_ALLOW_BUILDS_SCHEMA_KEY = "dyad-default-allow-builds-schema";
const DYAD_ALLOW_BUILDS_DATA_VERSION_KEY =
  "dyad-default-allow-builds-data-version";
const DYAD_ALLOW_BUILDS_CHANNEL_KEY = "dyad-default-allow-builds-channel";
const DYAD_ALLOW_BUILDS_BEGIN = "# dyad-default-allow-builds begin";
const DYAD_ALLOW_BUILDS_END = "# dyad-default-allow-builds end";
const LEGACY_DYAD_ALLOW_BUILDS_BEGIN = "# dyad-default-allow-builds=v1 begin";
const LEGACY_DYAD_ALLOW_BUILDS_END = "# dyad-default-allow-builds=v1 end";
const DYAD_ALLOW_BUILDS_METADATA_PATTERN =
  /^#\s*(dyad-default-allow-builds-(?:schema|data-version|channel))=(.+)$/;
const DYAD_ALLOW_BUILDS_REMOTE_URL =
  process.env.DYAD_DEFAULT_APPROVE_BUILDS_URL ??
  "https://api.dyad.sh/v1/default-approve-builds.txt";
const DYAD_ALLOW_BUILDS_FETCH_TIMEOUT_MS = 2_000;
const DYAD_ALLOW_BUILDS_MAX_BYTES = 256 * 1024;

export interface CommandExecutionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface CommandExecutionResult {
  stdout: string;
  stderr: string;
}

function buildCommandDisplay(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

export class CommandExecutionError extends Error {
  stdout: string;
  stderr: string;
  exitCode: number | null;

  constructor({
    message,
    stdout = "",
    stderr = "",
    exitCode = null,
  }: {
    message: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
  }) {
    super(message);
    this.name = "CommandExecutionError";
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandExecutionOptions,
) => Promise<CommandExecutionResult>;

export type PackageManager = "pnpm" | "npm";
type AllowBuildsChannel = "local" | "remote";

type AllowBuildsSource = {
  schema: typeof DYAD_ALLOW_BUILDS_SCHEMA;
  dataVersion: string;
  channel: AllowBuildsChannel;
  packages: string[];
};
type AllowBuildsMetadataKey =
  | typeof DYAD_ALLOW_BUILDS_SCHEMA_KEY
  | typeof DYAD_ALLOW_BUILDS_DATA_VERSION_KEY
  | typeof DYAD_ALLOW_BUILDS_CHANNEL_KEY;

type AllowBuildsTextFetcher = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{
  ok: boolean;
  text: () => Promise<string>;
}>;

function parseAllowBuildsMetadata(
  lines: string[],
): Partial<Record<AllowBuildsMetadataKey, string>> {
  const metadata: Partial<Record<AllowBuildsMetadataKey, string>> = {};
  for (const line of lines) {
    const match = line.trim().match(DYAD_ALLOW_BUILDS_METADATA_PATTERN);
    if (!match) {
      continue;
    }
    metadata[match[1] as AllowBuildsMetadataKey] = match[2].trim();
  }
  return metadata;
}

function parseDefaultAllowBuilds(
  text = defaultApproveBuildsText,
): AllowBuildsSource {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const metadata = parseAllowBuildsMetadata(lines);
  if (metadata[DYAD_ALLOW_BUILDS_SCHEMA_KEY] !== DYAD_ALLOW_BUILDS_SCHEMA) {
    throw new Error(
      `Invalid default pnpm allow-builds list. Expected "${DYAD_ALLOW_BUILDS_SCHEMA_KEY}=${DYAD_ALLOW_BUILDS_SCHEMA}".`,
    );
  }
  const dataVersion = metadata[DYAD_ALLOW_BUILDS_DATA_VERSION_KEY];
  if (!dataVersion) {
    throw new Error(
      `Invalid default pnpm allow-builds list. Expected "${DYAD_ALLOW_BUILDS_DATA_VERSION_KEY}".`,
    );
  }
  const channel = metadata[DYAD_ALLOW_BUILDS_CHANNEL_KEY];
  if (channel !== "local" && channel !== "remote") {
    throw new Error(
      `Invalid default pnpm allow-builds list. Expected "${DYAD_ALLOW_BUILDS_CHANNEL_KEY}" to be local or remote.`,
    );
  }

  return {
    schema: DYAD_ALLOW_BUILDS_SCHEMA,
    dataVersion,
    channel,
    packages: Array.from(
      new Set(lines.filter((line) => line && !line.startsWith("#"))),
    ).sort((a, b) => a.localeCompare(b)),
  };
}

function quoteYamlMapKey(key: string): string {
  if (/^[A-Za-z0-9._/-]+$/.test(key)) {
    return key;
  }

  return JSON.stringify(key);
}

function buildAllowBuildsManagedBlock(
  source: AllowBuildsSource,
  indent: string,
): string[] {
  return [
    `${indent}${DYAD_ALLOW_BUILDS_BEGIN}`,
    `${indent}# ${DYAD_ALLOW_BUILDS_SCHEMA_KEY}=${source.schema}`,
    `${indent}# ${DYAD_ALLOW_BUILDS_DATA_VERSION_KEY}=${source.dataVersion}`,
    `${indent}# ${DYAD_ALLOW_BUILDS_CHANNEL_KEY}=${source.channel}`,
    ...source.packages.map((pkg) => `${indent}${quoteYamlMapKey(pkg)}: true`),
    `${indent}${DYAD_ALLOW_BUILDS_END}`,
  ];
}

function findAllowBuildsManagedBlock(lines: string[]): {
  beginIndex: number;
  endIndex: number;
} | null {
  const beginIndexes = lines
    .map((line, index) =>
      line.trim() === DYAD_ALLOW_BUILDS_BEGIN ||
      line.trim() === LEGACY_DYAD_ALLOW_BUILDS_BEGIN
        ? index
        : -1,
    )
    .filter((index) => index !== -1);
  const endIndexes = lines
    .map((line, index) =>
      line.trim() === DYAD_ALLOW_BUILDS_END ||
      line.trim() === LEGACY_DYAD_ALLOW_BUILDS_END
        ? index
        : -1,
    )
    .filter((index) => index !== -1);

  if (beginIndexes.length === 1 && endIndexes.length === 1) {
    const beginIndex = beginIndexes[0];
    const endIndex = endIndexes[0];
    if (beginIndex >= endIndex) {
      throw new Error("Malformed Dyad pnpm allow-builds markers.");
    }
    return { beginIndex, endIndex };
  }

  if (beginIndexes.length !== endIndexes.length || beginIndexes.length > 1) {
    throw new Error("Malformed Dyad pnpm allow-builds markers.");
  }

  if (
    lines.some((line) => {
      const trimmedLine = line.trim();
      return (
        trimmedLine.startsWith("# dyad-default-allow-builds=") &&
        trimmedLine !== LEGACY_DYAD_ALLOW_BUILDS_BEGIN &&
        trimmedLine !== LEGACY_DYAD_ALLOW_BUILDS_END
      );
    })
  ) {
    throw new Error("Unsupported Dyad pnpm allow-builds marker version.");
  }

  return null;
}

function getExistingManagedAllowBuildsMetadata(
  existingContent: string,
): Partial<
  Pick<AllowBuildsSource, "schema" | "dataVersion" | "channel">
> | null {
  const lines = existingContent ? existingContent.split(/\r?\n/) : [];
  if (lines.at(-1) === "") {
    lines.pop();
  }

  const range = findAllowBuildsManagedBlock(lines);
  if (!range) {
    return null;
  }

  const metadata = parseAllowBuildsMetadata(
    lines.slice(range.beginIndex + 1, range.endIndex),
  );
  return {
    schema:
      metadata[DYAD_ALLOW_BUILDS_SCHEMA_KEY] === DYAD_ALLOW_BUILDS_SCHEMA
        ? DYAD_ALLOW_BUILDS_SCHEMA
        : undefined,
    dataVersion: metadata[DYAD_ALLOW_BUILDS_DATA_VERSION_KEY],
    channel:
      metadata[DYAD_ALLOW_BUILDS_CHANNEL_KEY] === "local" ||
      metadata[DYAD_ALLOW_BUILDS_CHANNEL_KEY] === "remote"
        ? metadata[DYAD_ALLOW_BUILDS_CHANNEL_KEY]
        : undefined,
  };
}

function getTopLevelAllowBuildsRange(lines: string[]): {
  start: number;
  end: number;
} | null {
  const start = lines.findIndex((line) =>
    /^allowBuilds:\s*(?:#.*)?$/.test(line),
  );
  if (start === -1) {
    return null;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && !/^\s/.test(line)) {
      end = index;
      break;
    }
  }

  return { start, end };
}

function parseAllowBuildsExistingKeys(lines: string[]): Set<string> {
  const keys = new Set<string>();
  for (const line of lines) {
    const match = line.match(
      /^\s{2}((?:"(?:[^"\\]|\\.)+"|'[^']+'|[^:#]+)):\s*/,
    );
    if (!match) {
      continue;
    }

    const rawKey = match[1].trim();
    try {
      keys.add(
        rawKey.startsWith('"')
          ? JSON.parse(rawKey)
          : rawKey.replace(/^'|'$/g, ""),
      );
    } catch {
      keys.add(rawKey);
    }
  }
  return keys;
}

function hasTopLevelConfigKey(lines: string[], key: string): boolean {
  return lines.some((line) =>
    new RegExp(`^${key}:\\s*(?:#.*)?$|^${key}:\\s+`).test(line),
  );
}

function formatPnpmWorkspaceConfigContent(lines: string[]): string {
  if (!hasTopLevelConfigKey(lines, "minimumReleaseAge")) {
    lines.push(`minimumReleaseAge: ${MINIMUM_PACKAGE_RELEASE_AGE_MINUTES}`);
  }

  return `${lines.join("\n")}\n`;
}

export function updatePnpmAllowBuildsConfigContent(
  existingContent: string,
  allowBuildsText = defaultApproveBuildsText,
): string {
  return updatePnpmAllowBuildsConfigContentWithSource(
    existingContent,
    parseDefaultAllowBuilds(allowBuildsText),
  );
}

function updatePnpmAllowBuildsConfigContentWithSource(
  existingContent: string,
  source: AllowBuildsSource,
): string {
  const lines = existingContent ? existingContent.split(/\r?\n/) : [];
  if (lines.at(-1) === "") {
    lines.pop();
  }

  const managedBlock = findAllowBuildsManagedBlock(lines);
  if (managedBlock) {
    const { beginIndex, endIndex } = managedBlock;
    const indent = lines[beginIndex].match(/^\s*/)?.[0] ?? "  ";
    const range = getTopLevelAllowBuildsRange(lines);
    const existingKeys = range
      ? parseAllowBuildsExistingKeys([
          ...lines.slice(range.start + 1, beginIndex),
          ...lines.slice(endIndex + 1, range.end),
        ])
      : new Set<string>();
    const filteredSource = {
      ...source,
      packages: source.packages.filter((pkg) => !existingKeys.has(pkg)),
    };

    lines.splice(
      beginIndex,
      endIndex - beginIndex + 1,
      ...buildAllowBuildsManagedBlock(filteredSource, indent),
    );
    return formatPnpmWorkspaceConfigContent(lines);
  }

  const range = getTopLevelAllowBuildsRange(lines);
  if (range) {
    const existingKeys = parseAllowBuildsExistingKeys(
      lines.slice(range.start + 1, range.end),
    );
    const filteredSource = {
      ...source,
      packages: source.packages.filter((pkg) => !existingKeys.has(pkg)),
    };
    lines.splice(
      range.start + 1,
      0,
      ...buildAllowBuildsManagedBlock(filteredSource, "  "),
    );
    return formatPnpmWorkspaceConfigContent(lines);
  }

  const prefix = lines.length > 0 ? [...lines, ""] : [];
  return formatPnpmWorkspaceConfigContent([
    ...prefix,
    "allowBuilds:",
    ...buildAllowBuildsManagedBlock(source, "  "),
  ]);
}

async function fetchRemoteAllowBuildsSource(
  fetcher: AllowBuildsTextFetcher = fetch,
): Promise<AllowBuildsSource | null> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    DYAD_ALLOW_BUILDS_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetcher(DYAD_ALLOW_BUILDS_REMOTE_URL, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    if (text.length > DYAD_ALLOW_BUILDS_MAX_BYTES) {
      return null;
    }

    const source = parseDefaultAllowBuilds(text);
    if (source.channel !== "remote") {
      return null;
    }
    return source;
  } catch (error) {
    logger.debug("Failed to fetch remote pnpm allowBuilds list:", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveAllowBuildsSource({
  existingContent,
  allowBuildsText,
  remoteAllowBuildsTextFetcher,
}: {
  existingContent: string;
  allowBuildsText?: string;
  remoteAllowBuildsTextFetcher?: AllowBuildsTextFetcher;
}): Promise<AllowBuildsSource | null> {
  if (allowBuildsText !== undefined) {
    return parseDefaultAllowBuilds(allowBuildsText);
  }

  const remoteSource = await fetchRemoteAllowBuildsSource(
    remoteAllowBuildsTextFetcher,
  );
  if (remoteSource) {
    return remoteSource;
  }

  const existingMetadata =
    getExistingManagedAllowBuildsMetadata(existingContent);
  if (
    existingMetadata?.schema === DYAD_ALLOW_BUILDS_SCHEMA &&
    existingMetadata.channel === "remote"
  ) {
    return null;
  }

  return parseDefaultAllowBuilds(defaultApproveBuildsText);
}

export async function ensurePnpmAllowBuildsConfigured({
  appPath,
  allowBuildsText,
  remoteAllowBuildsTextFetcher,
}: {
  appPath: string;
  allowBuildsText?: string;
  remoteAllowBuildsTextFetcher?: AllowBuildsTextFetcher;
}): Promise<{ changed: boolean }> {
  const configPath = path.join(appPath, "pnpm-workspace.yaml");
  try {
    let existingContent = "";
    try {
      existingContent = await fs.readFile(configPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const allowBuildsSource = await resolveAllowBuildsSource({
      existingContent,
      allowBuildsText,
      remoteAllowBuildsTextFetcher,
    });
    const nextContent = allowBuildsSource
      ? updatePnpmAllowBuildsConfigContentWithSource(
          existingContent,
          allowBuildsSource,
        )
      : formatPnpmWorkspaceConfigContent(
          existingContent
            ? existingContent.split(/\r?\n/).filter((_, index, lines) => {
                return index !== lines.length - 1 || lines[index] !== "";
              })
            : [],
        );
    if (nextContent === existingContent) {
      return { changed: false };
    }

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const tempPath = `${configPath}.tmp`;
    await fs.writeFile(tempPath, nextContent);
    await fs.rename(tempPath, configPath);
    return { changed: true };
  } catch (error) {
    logger.warn("Failed to update pnpm allowBuilds config:", error);
    return { changed: false };
  }
}

export async function commitPnpmAllowBuildsConfigIfChanged(
  appPath: string,
): Promise<void> {
  const result = await ensurePnpmAllowBuildsConfigured({ appPath });
  if (!result.changed) {
    return;
  }

  try {
    await gitAdd({ path: appPath, filepath: "pnpm-workspace.yaml" });
    await gitCommit({
      path: appPath,
      message: "[dyad] approve pnpm dependency builds",
    });
  } catch (error) {
    logger.warn("Failed to commit pnpm allowBuilds config:", error);
  }
}

function parseVersionParts(version: string): {
  parts: [number, number, number];
  hasPrerelease: boolean;
} | null {
  const match = version
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) {
    return null;
  }

  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    hasPrerelease: match[4] !== undefined,
  };
}

export function isVersionAtLeast(version: string, minimum: string): boolean {
  const parsedVersion = parseVersionParts(version);
  const parsedMinimum = parseVersionParts(minimum);
  if (!parsedVersion || !parsedMinimum) {
    return false;
  }

  for (let index = 0; index < parsedVersion.parts.length; index += 1) {
    if (parsedVersion.parts[index] > parsedMinimum.parts[index]) {
      return true;
    }
    if (parsedVersion.parts[index] < parsedMinimum.parts[index]) {
      return false;
    }
  }

  return !parsedVersion.hasPrerelease || parsedMinimum.hasPrerelease;
}

export function resolveExecutableName(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32" && !command.includes(".")) {
    return `${command}.cmd`;
  }
  return command;
}

function quoteWindowsCmdArg(value: string): string {
  // `cmd.exe /d /s /c` strips an outer quoted command string, so simple args
  // stay unquoted while empty or shell-significant values are quoted/escaped.
  if (value !== "" && !WINDOWS_CMD_NEEDS_QUOTING_PATTERN.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

export function buildPtyInvocation(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comSpec = process.env.ComSpec ?? "cmd.exe",
): { command: string; args: string[] } {
  const resolvedCommand = resolveExecutableName(command, platform);

  if (
    platform === "win32" &&
    WINDOWS_BATCH_COMMAND_PATTERN.test(resolvedCommand)
  ) {
    return {
      command: comSpec,
      args: [
        "/d",
        "/s",
        "/c",
        [resolvedCommand, ...args].map(quoteWindowsCmdArg).join(" "),
      ],
    };
  }

  return {
    command: resolvedCommand,
    args,
  };
}

export async function runCommand(
  command: string,
  args: string[],
  options: CommandExecutionOptions = {},
): Promise<CommandExecutionResult> {
  try {
    const invocation = buildPtyInvocation(command, args);
    const { output } = await runPtyCommand(
      invocation.command,
      invocation.args,
      {
        cwd: options.cwd,
        displayCommand: buildCommandDisplay(command, args),
        env: options.env,
        timeoutMs: options.timeoutMs,
      },
    );

    return {
      stdout: output,
      stderr: "",
    };
  } catch (error) {
    if (error instanceof PtyCommandExecutionError) {
      throw new CommandExecutionError({
        message: error.message,
        stdout: error.output,
        exitCode: error.exitCode,
      });
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new CommandExecutionError({
      message: `Failed to run command '${buildCommandDisplay(command, args)}': ${message}`,
    });
  }
}

export function getCommandExecutionDisplayDetails(
  error: unknown,
): string | undefined {
  if (!(error instanceof CommandExecutionError)) {
    return undefined;
  }

  const stderr = error.stderr.trim();
  if (stderr) {
    return stderr;
  }

  const stdout = error.stdout.trim();
  if (stdout) {
    return stdout;
  }

  return undefined;
}

export async function ensureSocketFirewallInstalled(
  runner: CommandRunner = runCommand,
): Promise<{
  available: boolean;
  warningMessage?: string;
}> {
  try {
    await runner("npx", [...SOCKET_FIREWALL_NPX_ARGS, "--help"], {
      timeoutMs: SOCKET_FIREWALL_PROBE_TIMEOUT_MS,
    });
    return { available: true };
  } catch {
    return {
      available: false,
      warningMessage: SOCKET_FIREWALL_WARNING_MESSAGE,
    };
  }
}

export async function detectPreferredPackageManager(
  runner: CommandRunner = runCommand,
): Promise<PackageManager> {
  const pnpmSupport = await getPnpmMinimumReleaseAgeSupport(runner);
  return pnpmSupport.supported ? "pnpm" : "npm";
}

export async function getPnpmMinimumReleaseAgeSupport(
  runner: CommandRunner = runCommand,
): Promise<{
  supported: boolean;
  version?: string;
  warningMessage?: string;
}> {
  const testPnpmVersion = IS_TEST_BUILD
    ? process.env.DYAD_TEST_PNPM_VERSION
    : undefined;
  if (testPnpmVersion) {
    if (isVersionAtLeast(testPnpmVersion, PNPM_MINIMUM_RELEASE_AGE_VERSION)) {
      return { supported: true, version: testPnpmVersion };
    }
    return {
      supported: false,
      version: testPnpmVersion,
      warningMessage: PNPM_MINIMUM_RELEASE_AGE_WARNING_MESSAGE,
    };
  }

  try {
    const result = await runner("pnpm", ["--version"], {
      timeoutMs: PACKAGE_MANAGER_PROBE_TIMEOUT_MS,
    });
    const version = result.stdout.trim();
    if (isVersionAtLeast(version, PNPM_MINIMUM_RELEASE_AGE_VERSION)) {
      return { supported: true, version };
    }
    return {
      supported: false,
      version,
      warningMessage: PNPM_MINIMUM_RELEASE_AGE_WARNING_MESSAGE,
    };
  } catch {
    return {
      supported: false,
      warningMessage: PNPM_MINIMUM_RELEASE_AGE_WARNING_MESSAGE,
    };
  }
}

export function buildAddDependencyCommand(
  packages: string[],
  packageManager: PackageManager,
  useSocketFirewall: boolean,
  options: { dev?: boolean } = {},
): { command: string; args: string[] } {
  const { dev = false } = options;
  const packageManagerArgs =
    packageManager === "pnpm"
      ? [
          ...PNPM_INSTALL_POLICY_ARGS,
          "add",
          ...(dev ? ["-D"] : []),
          ...packages,
        ]
      : [
          "install",
          ...NPM_INSTALL_POLICY_ARGS,
          "--legacy-peer-deps",
          ...(dev ? ["--save-dev"] : []),
          ...packages,
        ];

  if (useSocketFirewall) {
    return {
      // Use a pinned npx package so sfw stays reproducible and avoids global path issues on Windows.
      command: "npx",
      args: [
        ...SOCKET_FIREWALL_NPX_ARGS,
        packageManager,
        ...packageManagerArgs,
      ],
    };
  }

  return {
    command: packageManager,
    args: packageManagerArgs,
  };
}
