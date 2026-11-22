import { randomBytes } from "node:crypto";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  connectSsh,
  expectFingerprint,
  SshError,
  trustOnFirstUse,
  type SshResult,
  type SshSession,
} from "@/ipc/utils/ssh_client";
import type { SupabaseSelfHostedSsh } from "./supabase_self_hosted_store";
import { supabaseSelfHostedAuthHeaders } from "./supabase_self_hosted_client";
import { SUPABASE_SELF_HOSTED_COMMAND_ERROR_NAME } from "@/shared/supabase_self_hosted_error_names";

const logger = log.scope("supabase_self_hosted_functions");

/**
 * Where the edge runtime reads functions from, in both the upstream Docker
 * Compose install and the Coolify template. `main` there is the router that
 * serves every other function.
 */
const FUNCTIONS_DIR = "/home/deno/functions";
const ROUTER_FUNCTION = "main";
const SHARED_DIR = "_shared";

const COMMAND_TIMEOUT_MS = 60_000;
const PROBE_REQUEST_TIMEOUT_MS = 30_000;
/** A pooled connection is closed after this long without a command. */
const SESSION_IDLE_MS = 30_000;
const LOG_LINE_LIMIT = 5_000;

const FUNCTION_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const EDGE_RUNTIME_IMAGE = /(^|\/)edge-runtime(:|@|$)/;

export interface SupabaseSelfHostedFunctionFile {
  /** `<function>/...` or `_shared/...`, with forward slashes. */
  relativePath: string;
  content: Uint8Array;
}

export interface SupabaseSelfHostedFunctionLog {
  timestamp: number;
  level: "info" | "warn" | "error";
  message: string;
}

interface InstanceWithSsh {
  id: string;
  ssh: SupabaseSelfHostedSsh;
}

// ─────────────────────────────────────────────────────────────────────
// Connections
// ─────────────────────────────────────────────────────────────────────

interface PooledSession {
  session: Promise<SshSession>;
  users: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

/**
 * One SSH connection per instance, shared by deploys and the preview's log
 * polling, so a poll every few seconds does not open a connection each time.
 */
const sessions = new Map<string, PooledSession>();

function dropSession(instanceId: string, entry: PooledSession) {
  if (sessions.get(instanceId) === entry) sessions.delete(instanceId);
  clearTimeout(entry.idleTimer);
  entry.session.then((session) => session.end()).catch(() => {});
}

async function openSession(ssh: SupabaseSelfHostedSsh): Promise<SshSession> {
  try {
    return await connectSsh(
      {
        host: ssh.host,
        port: ssh.port,
        username: ssh.username,
        privateKey: ssh.privateKey,
      },
      expectFingerprint(ssh.hostKeyFingerprint),
    );
  } catch (error) {
    if (error instanceof SshError && error.failure === "host-key-rejected") {
      throw new DyadError(
        "This server's SSH host key changed since the instance was added, so Dyad did not send it anything. If you rebuilt the server, remove the instance and add it again.",
        DyadErrorKind.Precondition,
      );
    }
    throw error;
  }
}

/** A failure that leaves the connection unusable, rather than one command. */
function isConnectionFailure(error: unknown): boolean {
  return error instanceof SshError && error.failure !== "command-timeout";
}

async function withSession<T>(
  instance: InstanceWithSsh,
  operation: (session: SshSession) => Promise<T>,
): Promise<T> {
  let entry = sessions.get(instance.id);
  const reused = entry !== undefined;
  if (!entry) {
    entry = { session: openSession(instance.ssh), users: 0 };
    sessions.set(instance.id, entry);
  }
  const current = entry;
  current.users++;
  clearTimeout(current.idleTimer);
  try {
    let session: SshSession;
    try {
      session = await current.session;
    } catch (error) {
      // A connection that never opened is not kept for the next caller.
      dropSession(instance.id, current);
      throw error;
    }
    return await operation(session);
  } catch (error) {
    if (!isConnectionFailure(error)) throw error;
    dropSession(instance.id, current);
    // A pooled connection the server has since closed fails on first use.
    // Every operation here is safe to repeat, so try once on a fresh one.
    if (!reused) throw error;
    return withSession(instance, operation);
  } finally {
    current.users--;
    if (current.users === 0 && sessions.get(instance.id) === current) {
      current.idleTimer = setTimeout(
        () => dropSession(instance.id, current),
        SESSION_IDLE_MS,
      );
      current.idleTimer.unref?.();
    }
  }
}

/** A server command that failed. Its output can name the user's paths and hosts. */
export class SupabaseSelfHostedCommandError extends DyadError {
  constructor(message: string, kind: DyadErrorKind) {
    super(message, kind);
    this.name = SUPABASE_SELF_HOSTED_COMMAND_ERROR_NAME;
  }
}

function commandError(action: string, result: SshResult): DyadError {
  const output = `${result.stderr}\n${result.stdout}`.trim().slice(-600);
  if (/permission denied.*docker/i.test(output)) {
    return new DyadError(
      `Could not ${action}: the SSH user isn't allowed to run docker. Connect as root, or add the user to the docker group (usermod -aG docker <user>).`,
      DyadErrorKind.Precondition,
    );
  }
  if (/docker: (command )?not found/i.test(output)) {
    return new DyadError(
      `Could not ${action}: docker isn't installed for the SSH user.`,
      DyadErrorKind.Precondition,
    );
  }
  if (/no such container/i.test(output)) {
    return new DyadError(
      `Could not ${action}: the edge functions container Dyad found when the instance was added no longer exists. Remove the instance and add it again.`,
      DyadErrorKind.Precondition,
    );
  }
  return new SupabaseSelfHostedCommandError(
    `Could not ${action} (exit ${result.code ?? result.signal}): ${output || "no output"}`,
    DyadErrorKind.External,
  );
}

async function run(
  session: SshSession,
  action: string,
  command: string,
  options: { input?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const result = await session.run(command, {
    ...options,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  if (result.code !== 0) throw commandError(action, result);
  return result.stdout;
}

// ─────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────

function assertFunctionName(name: string): void {
  if (!FUNCTION_NAME.test(name) || name === ROUTER_FUNCTION) {
    throw new DyadError(
      name === ROUTER_FUNCTION
        ? `A function can't be named "${ROUTER_FUNCTION}" on a self-hosted instance: that name is the router that serves every other function.`
        : `"${name}" isn't a valid edge function name.`,
      DyadErrorKind.Validation,
    );
  }
}

function assertContainerName(name: string): void {
  if (!CONTAINER_NAME.test(name)) {
    throw new DyadError(
      `"${name}" isn't a valid container name.`,
      DyadErrorKind.Validation,
    );
  }
}

/**
 * Where each deployed version lives, inside the function's own directory:
 * `<function>/.dyad/<version>/<function>/...` and
 * `<function>/.dyad/<version>/_shared/...`, so the function's `../_shared`
 * imports resolve to the copy deployed with it.
 */
const VERSIONS_DIR = ".dyad";
/**
 * How long a replaced version stays on disk. A worker started on it can keep
 * running for the router's worker lifetime (400s upstream) and may still read
 * its files, so this is well past that.
 */
const VERSION_RETENTION_MS = 15 * 60_000;
/** Upstream's router value, used when the router can't be read. */
export const DEFAULT_WORKER_LIFETIME_MS = 400_000;
const WORKER_LIFETIME_MARKER = "dyad-worker-lifetime:";
const EXISTED_MARKER = "dyad-existed:";

/** Prints the router's worker lifetime line after its marker, if it has one. */
const printWorkerLifetime = `echo "${WORKER_LIFETIME_MARKER}$(grep -m 1 "workerTimeoutMs *=" ${ROUTER_FUNCTION}/index.ts 2>/dev/null || true)"`;

/**
 * `<milliseconds>-<hex>`. Sorts by deploy time as text while timestamps have
 * 13 digits (until the year 2286). Not zero-padded: the shell reads a leading
 * zero as octal.
 */
function newVersionId(nowMs: number): string {
  return `${Math.floor(nowMs)}-${randomBytes(6).toString("hex")}`;
}

/**
 * The shell command that deploys one function from the tar archive on stdin
 * without a moment where a request can fail or see a mix of versions.
 *
 * The edge runtime's router looks up `/home/deno/functions/<name>` on every
 * request, and a starting worker reads its files over time, so neither the
 * function's directory nor any file a worker might be reading is ever changed
 * in place. Each deploy unpacks into a new version directory that is never
 * modified afterwards, then points the function at it by replacing its
 * one-line `index.ts` with a rename, which is atomic. A function that does
 * not exist yet is assembled beside its final path and renamed into place.
 * A directory deployed some other way is converted the same way as an
 * update: its old files stay until the retention period has passed.
 *
 * The entry re-exports the version's default export, so both function styles
 * work: `export default { fetch }`, and `Deno.serve`, which has no default
 * export and gets an empty object that the runtime ignores.
 *
 * Replaced versions are removed once they have been replaced for
 * `VERSION_RETENTION_MS`. Times come from Dyad's clock, not the server's, so
 * one clock decides both when a version was made and how old it is.
 *
 * Names are validated before they get here and the script has no single
 * quotes, so it can sit inside one quoted argument.
 */
export function deployCommand(
  container: string,
  functionName: string,
  { nowMs = Date.now() }: { nowMs?: number } = {},
): string {
  const suffix = randomBytes(6).toString("hex");
  const stage = `.dyad-stage-${suffix}`;
  const assembled = `.dyad-new-${suffix}`;
  const version = newVersionId(nowMs);
  const name = functionName;
  const versions = `${name}/${VERSIONS_DIR}`;
  const entryTemp = `${name}/.index.ts.${suffix}`;
  const writeEntry = (target: string) =>
    `printf "%s\\n" "import * as entry from \\"./${VERSIONS_DIR}/${version}/${name}/index.ts\\";" "export default entry.default ?? {};" > ${target}`;
  const script = [
    "set -eu",
    `cd ${FUNCTIONS_DIR}`,
    `trap "rm -rf ${stage} ${assembled} ${entryTemp}" EXIT`,
    `mkdir ${stage}`,
    `tar -x -C ${stage}`,
    `existed=0`,
    `if [ -e ${name} ]; then existed=1; fi`,
    `if [ -d ${name} ]; then`,
    `  mkdir -p ${versions}`,
    `  mv ${stage} ${versions}/${version}`,
    `  ${writeEntry(entryTemp)}`,
    `  mv -f ${entryTemp} ${name}/index.ts`,
    `elif [ -e ${name} ]; then`,
    `  echo "${name} exists and is not a directory" >&2`,
    `  exit 1`,
    `else`,
    `  mkdir -p ${assembled}/${VERSIONS_DIR}`,
    `  mv ${stage} ${assembled}/${VERSIONS_DIR}/${version}`,
    `  ${writeEntry(`${assembled}/index.ts`)}`,
    `  mv -T ${assembled} ${name}`,
    `fi`,
    // Remove each version whose successor has been current long enough.
    `previous=""`,
    `for current in $(ls ${versions} | sort); do`,
    `  case "$current" in [0-9]*-*) ;; *) continue ;; esac`,
    `  if [ -n "$previous" ] && [ $((${nowMs} - \${current%%-*})) -gt ${VERSION_RETENTION_MS} ]; then rm -rf "${versions}/$previous"; fi`,
    `  previous="$current"`,
    `done`,
    // Files from before the first versioned deploy, once that has aged out.
    `oldest=$(ls ${versions} | sort | head -n 1)`,
    `case "$oldest" in [0-9]*-*)`,
    `  if [ $((${nowMs} - \${oldest%%-*})) -gt ${VERSION_RETENTION_MS} ]; then find ${name} -mindepth 1 -maxdepth 1 ! -name index.ts ! -name ${VERSIONS_DIR} ! -name ".index.ts.*" -exec rm -rf {} +; fi ;;`,
    `esac`,
    `echo "${EXISTED_MARKER}$existed"`,
    printWorkerLifetime,
  ].join("\n");
  return `base64 -d | docker exec -i ${container} sh -c '${script}'`;
}

/**
 * The router's worker lifetime from its `const workerTimeoutMs = ...` line,
 * which upstream writes as `400_000` and Coolify as `1 * 60 * 1000`.
 */
export function parseWorkerLifetimeMs(line: string): number {
  const expression = /workerTimeoutMs\s*=\s*([\d_*\s]+)/.exec(line)?.[1];
  if (!expression) return DEFAULT_WORKER_LIFETIME_MS;
  const factors = expression
    .split("*")
    .map((factor) => factor.replace(/[_\s]/g, ""));
  if (factors.some((factor) => !/^\d+$/.test(factor))) {
    return DEFAULT_WORKER_LIFETIME_MS;
  }
  const value = factors.reduce(
    (product, factor) => product * Number(factor),
    1,
  );
  // Anything outside a second to an hour is not a lifetime Dyad understands.
  return value >= 1_000 && value <= 3_600_000
    ? value
    : DEFAULT_WORKER_LIFETIME_MS;
}

export interface SupabaseSelfHostedDeployResult {
  /** Whether the function already existed, so a worker may still run its old code. */
  replacedExisting: boolean;
  /** The longest a worker started before this deploy keeps serving. */
  workerLifetimeMs: number;
}

function parseDeployOutput(output: string): SupabaseSelfHostedDeployResult {
  let replacedExisting = true;
  let workerLifetimeMs = DEFAULT_WORKER_LIFETIME_MS;
  for (const line of output.split("\n")) {
    if (line.startsWith(EXISTED_MARKER)) {
      replacedExisting = line.slice(EXISTED_MARKER.length).trim() !== "0";
    } else if (line.startsWith(WORKER_LIFETIME_MARKER)) {
      workerLifetimeMs = parseWorkerLifetimeMs(
        line.slice(WORKER_LIFETIME_MARKER.length),
      );
    }
  }
  return { replacedExisting, workerLifetimeMs };
}

export async function deploySupabaseSelfHostedFunction({
  instance,
  functionName,
  files,
  signal,
}: {
  instance: InstanceWithSsh;
  functionName: string;
  files: readonly SupabaseSelfHostedFunctionFile[];
  signal?: AbortSignal;
}): Promise<SupabaseSelfHostedDeployResult> {
  assertFunctionName(functionName);
  const container = instance.ssh.functionsContainer;
  assertContainerName(container);
  for (const file of files) {
    const segments = file.relativePath.split("/");
    const root = segments[0];
    if (
      (root !== functionName && root !== SHARED_DIR) ||
      segments.length < 2 ||
      segments.some((segment) => segment === "" || segment === "..")
    ) {
      throw new DyadError(
        `Refusing to upload ${file.relativePath} outside the function's directory.`,
        DyadErrorKind.Validation,
      );
    }
  }
  if (!files.some((file) => file.relativePath.startsWith(`${functionName}/`))) {
    throw new DyadError(
      `Supabase function ${functionName} has no files to deploy.`,
      DyadErrorKind.Validation,
    );
  }
  const archive = Buffer.from(createTarArchive(files)).toString("base64");
  const output = await withSession(instance, (session) =>
    run(
      session,
      `deploy ${functionName}`,
      deployCommand(container, functionName),
      { input: archive, signal },
    ),
  );
  logger.info(
    `Deployed ${functionName} to self-hosted instance ${instance.id} (${container})`,
  );
  return parseDeployOutput(output);
}

function deleteCommand(container: string, functionName: string): string {
  return `docker exec ${container} sh -c 'cd ${FUNCTIONS_DIR} && rm -rf -- ${functionName} && ${printWorkerLifetime}'`;
}

export async function deleteSupabaseSelfHostedFunction({
  instance,
  functionName,
  signal,
}: {
  instance: InstanceWithSsh;
  functionName: string;
  signal?: AbortSignal;
}): Promise<{ workerLifetimeMs: number }> {
  assertFunctionName(functionName);
  const container = instance.ssh.functionsContainer;
  assertContainerName(container);
  const output = await withSession(instance, (session) =>
    run(
      session,
      `delete ${functionName}`,
      deleteCommand(container, functionName),
      { signal },
    ),
  );
  return { workerLifetimeMs: parseDeployOutput(output).workerLifetimeMs };
}

/** Function log entries the edge runtime printed at or after `sinceMs`. */
export async function readSupabaseSelfHostedFunctionLogs({
  instance,
  sinceMs,
}: {
  instance: InstanceWithSsh;
  sinceMs: number;
}): Promise<SupabaseSelfHostedFunctionLog[]> {
  const container = instance.ssh.functionsContainer;
  assertContainerName(container);
  const since = (Math.max(0, sinceMs) / 1000).toFixed(3);
  const output = await withSession(instance, (session) =>
    run(
      session,
      "read function logs",
      `docker logs --timestamps --since ${since} --tail ${LOG_LINE_LIMIT} ${container} 2>&1`,
    ),
  );
  return parseEdgeRuntimeLogs(output);
}

// ─────────────────────────────────────────────────────────────────────
// Mail settings
// ─────────────────────────────────────────────────────────────────────

const CONTAINER_MARKER = "dyad-container:";
const AUTH_MARKER = "dyad-auth:";

export interface SupabaseSelfHostedMailSettings {
  /** The auth service's SMTP host; empty means it discards every email. */
  smtpHost: string;
  autoconfirm: boolean;
  /** The public URL auth builds email links from; empty when unset. */
  apiExternalUrl: string;
  /** Names and Compose service names of the instance's running containers. */
  runningNames: string[];
}

/**
 * Finds the auth container in the same Compose project as the functions
 * container, since a server can run several Supabase stacks, and prints its
 * mail settings. Only those three variables leave the server: the container's
 * environment also holds its secrets.
 */
export function mailSettingsCommand(container: string): string {
  const project = `{{index .Config.Labels "com.docker.compose.project"}}`;
  const inProject = `--filter "label=com.docker.compose.project=$p"`;
  return [
    `p=$(docker inspect -f '${project}' ${container})`,
    `[ -n "$p" ] || exit 0`,
    `docker ps ${inProject} --format '${CONTAINER_MARKER}{{.Names}}\t{{.Image}}\t{{.Label "com.docker.compose.service"}}'`,
    `auth=$(docker ps ${inProject} --format '{{.Names}}\t{{.Image}}' | awk -F '\t' '$2 ~ /gotrue/ { print $1; exit }')`,
    `[ -n "$auth" ] || exit 0`,
    `echo "${AUTH_MARKER}$auth"`,
    `docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$auth" | grep -E '^(GOTRUE_SMTP_HOST|GOTRUE_MAILER_AUTOCONFIRM|API_EXTERNAL_URL)=' || true`,
  ].join("\n");
}

/** Null when the output names no auth container. */
export function parseMailSettingsOutput(
  output: string,
): SupabaseSelfHostedMailSettings | null {
  let foundAuth = false;
  let smtpHost = "";
  let autoconfirm = false;
  let apiExternalUrl = "";
  const runningNames: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith(CONTAINER_MARKER)) {
      const [name, , service] = line.slice(CONTAINER_MARKER.length).split("\t");
      for (const value of [name, service]) {
        if (value) runningNames.push(value);
      }
    } else if (line.startsWith(AUTH_MARKER)) {
      foundAuth = true;
    } else if (line.startsWith("GOTRUE_SMTP_HOST=")) {
      smtpHost = line.slice("GOTRUE_SMTP_HOST=".length).trim();
    } else if (line.startsWith("GOTRUE_MAILER_AUTOCONFIRM=")) {
      autoconfirm =
        line.slice("GOTRUE_MAILER_AUTOCONFIRM=".length).trim() === "true";
    } else if (line.startsWith("API_EXTERNAL_URL=")) {
      apiExternalUrl = line.slice("API_EXTERNAL_URL=".length).trim();
    }
  }
  return foundAuth
    ? { smtpHost, autoconfirm, apiExternalUrl, runningNames }
    : null;
}

export async function readSupabaseSelfHostedMailSettings({
  instance,
}: {
  instance: InstanceWithSsh;
}): Promise<SupabaseSelfHostedMailSettings | null> {
  const container = instance.ssh.functionsContainer;
  assertContainerName(container);
  const output = await withSession(instance, (session) =>
    run(session, "read the mail settings", mailSettingsCommand(container)),
  );
  return parseMailSettingsOutput(output);
}

// ─────────────────────────────────────────────────────────────────────
// Log parsing
// ─────────────────────────────────────────────────────────────────────

const TIMESTAMPED_LINE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) ?(.*)$/;
const LEVEL_PREFIX = /^\[(Debug|Info|Warning|Error)\] ?(.*)$/;
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;
// Printed by Deno.serve each time a function's worker starts.
const RUNTIME_STARTUP_LINE = /^Listening on http:\/\/localhost:9999\/$/;
const STACK_FUNCTION = /\/functions\/([A-Za-z][A-Za-z0-9_-]*)\/[^\s:)]+:\d+/;

function parseDockerTimestamp(value: string): number {
  // Docker prints nanoseconds; Date.parse wants at most milliseconds.
  return Date.parse(value.replace(/(\.\d{3})\d*Z$/, "$1Z"));
}

/**
 * Turns `docker logs --timestamps` output from the edge runtime into entries.
 *
 * The runtime prints what a function logs as `[Info] message`, `[Warning]`
 * or `[Error]`, then a blank line; a multi-line message continues until that
 * blank line. Lines without a level are the router's and the runtime's own
 * and are skipped. The runtime does not name the function, so an entry that
 * lacks the `[function-name]` prefix Dyad's prompt asks for is attributed
 * from a stack frame when it has one.
 */
export function parseEdgeRuntimeLogs(
  output: string,
): SupabaseSelfHostedFunctionLog[] {
  const entries: SupabaseSelfHostedFunctionLog[] = [];
  let current: { timestamp: number; level: string; lines: string[] } | null =
    null;
  const finish = () => {
    if (!current) return;
    let message = current.lines.join("\n").replace(ANSI_ESCAPE, "").trimEnd();
    if (!message.startsWith("[")) {
      const owner = STACK_FUNCTION.exec(message)?.[1];
      if (owner && owner !== ROUTER_FUNCTION) message = `[${owner}] ${message}`;
    }
    entries.push({
      timestamp: current.timestamp,
      level:
        current.level === "Error"
          ? "error"
          : current.level === "Warning"
            ? "warn"
            : "info",
      message,
    });
    current = null;
  };

  for (const rawLine of output.split(/\r?\n/)) {
    const line = TIMESTAMPED_LINE.exec(rawLine);
    if (!line) continue;
    const [, timestamp, text] = line;
    const level = LEVEL_PREFIX.exec(text);
    if (level) {
      finish();
      if (RUNTIME_STARTUP_LINE.test(level[2])) continue;
      const parsed = parseDockerTimestamp(timestamp);
      if (!Number.isFinite(parsed)) continue;
      current = { timestamp: parsed, level: level[1], lines: [level[2]] };
    } else if (current) {
      if (text === "") finish();
      else current.lines.push(text);
    }
  }
  finish();
  return entries;
}

// ─────────────────────────────────────────────────────────────────────
// Connect-time check
// ─────────────────────────────────────────────────────────────────────

export interface SupabaseSelfHostedSshInput {
  host: string;
  port: number;
  username: string;
  privateKey: string;
}

/**
 * Connects, finds the edge runtime container that serves `url`, and returns
 * what to store. Each candidate container gets a throwaway function that
 * answers with a random token; the one whose token comes back through
 * `<url>/functions/v1/` is this instance's, which also proves deploys will
 * be served. The throwaway function is always removed again.
 */
export async function checkSupabaseSelfHostedSsh({
  url,
  anonKey,
  ssh,
}: {
  url: string;
  anonKey: string;
  ssh: SupabaseSelfHostedSshInput;
}): Promise<
  Pick<SupabaseSelfHostedSsh, "hostKeyFingerprint" | "functionsContainer">
> {
  let fingerprint = "";
  const session = await connectSsh(
    {
      host: ssh.host,
      port: ssh.port,
      username: ssh.username,
      privateKey: ssh.privateKey,
    },
    trustOnFirstUse((seen) => {
      fingerprint = seen;
    }),
  );
  try {
    const listing = await run(
      session,
      "list containers",
      `docker ps --format '{{.Names}}\t{{.Image}}'`,
    );
    const candidates = listing
      .split("\n")
      .map((line) => line.trim().split("\t"))
      .filter(
        ([name, image]) =>
          name &&
          image &&
          EDGE_RUNTIME_IMAGE.test(image) &&
          CONTAINER_NAME.test(name),
      )
      .map(([name]) => name);
    if (candidates.length === 0) {
      throw new DyadError(
        "Connected over SSH, but no Supabase edge functions container is running on this server.",
        DyadErrorKind.Precondition,
      );
    }

    for (const container of candidates) {
      if (await servesUrl({ session, container, url, anonKey })) {
        return {
          hostKeyFingerprint: fingerprint,
          functionsContainer: container,
        };
      }
    }
    throw new DyadError(
      `Found ${candidates.join(", ")} on this server, but a test function deployed there wasn't served at ${url}/functions/v1/. Check that the SSH server is the one hosting this instance.`,
      DyadErrorKind.Precondition,
    );
  } finally {
    session.end();
  }
}

async function servesUrl({
  session,
  container,
  url,
  anonKey,
}: {
  session: SshSession;
  container: string;
  url: string;
  anonKey: string;
}): Promise<boolean> {
  const token = randomBytes(16).toString("hex");
  const functionName = `dyad-check-${token.slice(0, 12)}`;
  const files = [
    {
      relativePath: `${functionName}/index.ts`,
      content: new TextEncoder().encode(
        `Deno.serve(() => new Response("${token}"));\n`,
      ),
    },
  ];
  await run(
    session,
    "deploy a test function",
    deployCommand(container, functionName),
    { input: Buffer.from(createTarArchive(files)).toString("base64") },
  );
  try {
    const response = await fetch(`${url}/functions/v1/${functionName}`, {
      headers: supabaseSelfHostedAuthHeaders(anonKey),
      credentials: "omit",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_REQUEST_TIMEOUT_MS),
    });
    const body = await response.text();
    return response.ok && body.trim() === token;
  } catch (error) {
    logger.warn(`Test function on ${container} did not answer`, error);
    return false;
  } finally {
    await run(
      session,
      "remove the test function",
      deleteCommand(container, functionName),
    ).catch((error) =>
      logger.warn(`Could not remove test function from ${container}`, error),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Archive
// ─────────────────────────────────────────────────────────────────────

const BLOCK = 512;

function writeField(
  header: Uint8Array,
  offset: number,
  length: number,
  value: string,
) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > length) {
    throw new DyadError(
      `Path too long for upload: ${value}`,
      DyadErrorKind.Validation,
    );
  }
  header.set(bytes, offset);
}

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0");
}

/** Splits a path into ustar's 155-byte prefix and 100-byte name. */
function splitPath(path: string): [prefix: string, name: string] {
  if (new TextEncoder().encode(path).length <= 100) return ["", path];
  const slash = path.lastIndexOf("/", 155);
  if (slash <= 0) return ["", path];
  return [path.slice(0, slash), path.slice(slash + 1)];
}

/**
 * A minimal ustar archive of regular files. Parent directories are implied;
 * tar creates them on extract.
 */
export function createTarArchive(
  files: readonly SupabaseSelfHostedFunctionFile[],
): Uint8Array {
  const parts: Uint8Array[] = [];
  const mtime = Math.floor(Date.now() / 1000);
  for (const file of files) {
    const header = new Uint8Array(BLOCK);
    const [prefix, name] = splitPath(file.relativePath);
    writeField(header, 0, 100, name);
    writeField(header, 100, 8, octal(0o644, 8));
    writeField(header, 108, 8, octal(0, 8));
    writeField(header, 116, 8, octal(0, 8));
    writeField(header, 124, 12, octal(file.content.length, 12));
    writeField(header, 136, 12, octal(mtime, 12));
    header.fill(0x20, 148, 156);
    header[156] = 0x30; // regular file
    writeField(header, 257, 6, "ustar");
    writeField(header, 263, 2, "00");
    writeField(header, 345, 155, prefix);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeField(header, 148, 8, `${octal(checksum, 7)}\0 `);
    parts.push(header, file.content);
    const padding = (BLOCK - (file.content.length % BLOCK)) % BLOCK;
    if (padding) parts.push(new Uint8Array(padding));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const archive = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    archive.set(part, offset);
    offset += part.length;
  }
  return archive;
}

/** Test seam: closes every pooled connection. */
export function closeSupabaseSelfHostedSessions(): void {
  for (const [id, entry] of sessions) dropSession(id, entry);
}
