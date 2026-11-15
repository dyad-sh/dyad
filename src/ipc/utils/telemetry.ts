import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { BrowserWindow } from "electron";
import log from "electron-log";
import {
  DyadError,
  isDyadErrorKindFilteredFromTelemetry,
} from "@/errors/dyad_error";
import { isGenericFetchFailedError } from "@/lib/posthogTelemetry";
import { TelemetryEventPayload } from "@/ipc/types";
import { sshFailureOf } from "@/shared/ssh_failure";
import {
  COOLIFY_REQUEST_ERROR_NAME,
  COOLIFY_TRANSPORT_ERROR_NAME,
} from "@/shared/coolify_error_names";
import {
  GITLAB_REQUEST_ERROR_NAME,
  GITLAB_TRANSPORT_ERROR_NAME,
} from "@/shared/gitlab_error_names";
import {
  POSTHOG_CHUNK_IDS_PROPERTY,
  type PostHogChunkIdRegistry,
  readPostHogChunkIds,
} from "@/shared/posthog_chunk_ids";

const logger = log.scope("telemetry");
const FILTERED_EXCEPTION_MESSAGES = new Set([
  "Supabase access token not found. Please authenticate first.",
]);

/**
 * Sends a telemetry event from the main process to the renderer,
 * where PostHog can capture it.
 */
export function sendTelemetryEvent(
  eventName: string,
  properties?: Record<string, unknown>,
): void {
  try {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      sendTelemetryEventToWindow(windows[0], eventName, properties);
    }
  } catch (error) {
    logger.warn("Error sending telemetry event:", error);
  }
}

export function sendTelemetryEventToWindow(
  target: BrowserWindow,
  eventName: string,
  properties?: Record<string, unknown>,
): void {
  try {
    target.webContents.send("telemetry:event", {
      eventName,
      properties,
    } satisfies TelemetryEventPayload);
  } catch (error) {
    logger.warn("Error sending telemetry event:", error);
  }
}

/**
 * Sends an exception from the main process to the renderer as a PostHog $exception event.
 */
export function sendTelemetryException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  const err =
    error instanceof Error
      ? error
      : new Error(String(error ?? "Unknown error"));

  if (shouldFilterTelemetryException(err)) {
    return;
  }

  // Vercel diagnostics are shown locally, but can echo private project data
  // in both messages and validation stacks. Send only fixed classification
  // fields; even frame-looking lines can originate in a provider message.
  if (context?.ipc_channel === "vercel:create-project") {
    sendTelemetryEvent("$exception", {
      exception_name: "VercelProjectSetupError",
      exception_message: "Vercel project setup failed.",
      ipc_channel: "vercel:create-project",
    });
    return;
  }

  // For a server the user runs, the message is the one field built from
  // arbitrary strings: the machine's address, its certificate, whatever it
  // chose to say back. Decided per channel rather than per message, so a throw
  // site added later cannot opt back in by accident.
  const selfHosted = isSelfHostedChannel(context);

  // posthog-js runs in the renderer, so main-process chunk IDs must travel
  // with the exception for PostHog to find this stack's source maps.
  const registry = readPostHogChunkIds();
  const chunkIds = registry && withReducedChunkKeys(registry);

  sendTelemetryEvent("$exception", {
    exception_name: err.name,
    ...(selfHosted ? {} : { exception_message: err.message }),
    exception_stack_trace: selfHosted ? framesOnly(err) : err.stack,
    ...context,
    ...(chunkIds ? { [POSTHOG_CHUNK_IDS_PROPERTY]: chunkIds } : {}),
  });
}

/**
 * Channels that talk to a server the user runs, rather than to Dyad's own.
 *
 * Every prefix a self-hosted surface uses has to be listed. Setting a server up
 * is the same class as deploying to one and carries more: its failures quote
 * the installer's own output, the address, and the address the user signs in
 * with.
 */
const SELF_HOSTED_CHANNEL_PREFIXES = [
  "coolify:",
  "coolify-setup:",
  // A GitLab instance is the user's own server too: these channels carry its
  // address, and the errors they raise quote whatever it answered.
  "gitlab:",
];

function isSelfHostedChannel(context?: Record<string, unknown>): boolean {
  const channel = context?.ipc_channel;
  if (typeof channel !== "string") return false;
  return SELF_HOSTED_CHANNEL_PREFIXES.some((prefix) =>
    channel.startsWith(prefix),
  );
}

/**
 * The stack without its header, which repeats the message verbatim.
 *
 * Dropping `exception_message` alone leaves the message in the trace, since a
 * stack starts "Name: message". The frames are what identify the throw site,
 * so they are all that is kept.
 */
export function framesOnly(err: Error): string | undefined {
  if (!err.stack) return undefined;
  return [err.name, ...stackFrames(err)].join("\n");
}

/**
 * The frame lines of an error's stack, without its header.
 *
 * The header is the name and message, and a line of either can look like a
 * frame, so it is skipped by its exact text. V8 writes it from the name and
 * message as they are when the stack is first read. If the stack doesn't start
 * with it, because one of them changed since, no frames are kept.
 *
 * A message shortened after the stack was read still matches as a prefix, and
 * leaves the rest of the old message after it. So every line after the header
 * has to have the shape of a frame, or no frames are kept. This cannot catch
 * a leftover message line that has that exact shape.
 */
export function stackFrames(err: Error): string[] {
  const stack = err.stack;
  if (typeof stack !== "string") return [];
  const header = stackHeaders(err).find((candidate) =>
    stack.startsWith(candidate),
  );
  if (header === undefined) return [];
  const rest = stack.slice(header.length);
  if (rest === "") return [];
  // Anything else on the header's own line is message the header lacks.
  if (!rest.startsWith("\n")) return [];
  const lines = rest
    .slice(1)
    .split("\n")
    .filter((line) => line.trim() !== "");
  return lines.every(isFrameLine) ? lines : [];
}

// Longer than any real frame, and short enough to bound the frame patterns.
const MAX_FRAME_LINE_CHARS = 1000;

// How V8 ends a frame: a position, or a marker for code that has none.
const FRAME_LINE =
  /^\s+at .*(?::\d+:\d+\)?|:0x[0-9a-f]+\)?|\(<anonymous>\)|\(native\)|\(index \d+\)|<anonymous>)$/;

function isFrameLine(line: string): boolean {
  return line.length <= MAX_FRAME_LINE_CHARS && FRAME_LINE.test(line);
}

/**
 * The headers a stack can start with: the name and message, built as
 * `Error.prototype.toString` does, and Node's form for its own errors, which
 * puts the code after the name, as in "TypeError [ERR_INVALID_ARG_TYPE]: ...".
 */
function stackHeaders(err: Error): string[] {
  const name = err.name === undefined ? "Error" : String(err.name);
  const message = err.message === undefined ? "" : String(err.message);
  const headers = [joinHeader(name, message)];
  const code = (err as { code?: unknown }).code;
  if (name && typeof code === "string") {
    headers.push(joinHeader(`${name} [${code}]`, message));
  }
  return headers;
}

function joinHeader(name: string, message: string): string {
  if (!name) return message;
  if (!message) return name;
  return `${name}: ${message}`;
}

/**
 * Error names that `reportableErrorName` sends as they are. A name is a
 * writable string that code can build from anything, so any other name is
 * replaced.
 */
const REPORTABLE_ERROR_NAMES = new Set<unknown>([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "DyadError",
  "ActorAdmissionError",
  "KeyedAdmissionGateError",
  "PreparedRequestIdentityConflictError",
  "OperationIdentityConflictError",
  "OperationCapacityError",
  "OperationRouteIdentityConflictError",
  "OperationRouteCapacityError",
  "AbortError",
  "TimeoutError",
  "SqliteError",
]);

const UNLISTED_ERROR_NAME = "UnlistedError";

/** The error's name if it is listed, otherwise `UNLISTED_ERROR_NAME`. */
export function reportableErrorName(err: Error): string {
  return REPORTABLE_ERROR_NAMES.has(err.name) ? err.name : UNLISTED_ERROR_NAME;
}

/**
 * The places a reportable frame can point. Paths use forward slashes.
 */
export interface FrameSources {
  /** The directory holding the main-process bundle. */
  readonly buildDir: string;
  /** The files in `buildDir`. */
  readonly buildFiles: ReadonlySet<string>;
  /** Directories whose `node_modules` hold the shipped packages. */
  readonly packageRoots: readonly string[];
  /** The shipped package names, including scoped ones such as `@a/b`. */
  readonly packages: ReadonlySet<string>;
}

/**
 * The error as a stack holding only values from fixed sets: a listed name,
 * then frames that each name a shipped file, a shipped package or a Node
 * module. Function names, paths and any frame that names something else are
 * dropped. Always a string, even when the error has no stack.
 */
export function reportableStack(
  err: Error,
  sources: FrameSources = shippedFrameSources(),
): string {
  const frames = stackFrames(err)
    .map((line) => reportableFrame(line, sources))
    .filter((frame) => frame !== undefined);
  return [reportableErrorName(err), ...frames].join("\n");
}

// A frame's location is the last `path:line:column`, inside the last
// parentheses when there are any. A path that itself holds "(" is cut at it
// and then matches no source, so that frame is dropped.
const FRAME_LOCATION =
  /^\s+at (?:async )?(?:.*\()?(.+):(\d{1,7}):(\d{1,7})\)?$/;

const BUNDLE_FRAME_PREFIX = "    at .vite/build/";

function reportableFrame(
  line: string,
  sources: FrameSources,
): string | undefined {
  const match = FRAME_LOCATION.exec(line);
  if (!match) return undefined;
  const [, rawPath, lineNumber, column] = match;

  if (rawPath.startsWith("node:")) {
    const moduleName = rawPath.slice("node:".length);
    return BUILTIN_MODULES.has(moduleName)
      ? `    at node:${moduleName}:${lineNumber}:${column}`
      : "    at node:internal";
  }

  const filePath = normalizeFramePath(rawPath);
  if (filePath === undefined) return undefined;

  const buildPrefix = `${sources.buildDir}/`;
  if (filePath.startsWith(buildPrefix)) {
    const file = filePath.slice(buildPrefix.length);
    return sources.buildFiles.has(file)
      ? `${BUNDLE_FRAME_PREFIX}${file}:${lineNumber}:${column}`
      : undefined;
  }

  for (const root of sources.packageRoots) {
    const modulesPrefix = `${root}/node_modules/`;
    if (!filePath.startsWith(modulesPrefix)) continue;
    const [first, second] = filePath.slice(modulesPrefix.length).split("/");
    const name = first.startsWith("@") ? `${first}/${second}` : first;
    return sources.packages.has(name)
      ? `    at node_modules/${name}`
      : undefined;
  }
  return undefined;
}

/**
 * The registry with a second key for each bundle file, written the way
 * `reportableStack` writes that file's frames.
 *
 * posthog-js finds a frame's chunk ID by the file name in the frame. A key
 * holds the file's full path, which a reduced frame no longer has, so without
 * the second key PostHog cannot find the source map for a reduced stack.
 */
export function withReducedChunkKeys(
  registry: PostHogChunkIdRegistry,
  sources: FrameSources = shippedFrameSources(),
): PostHogChunkIdRegistry {
  const reduced: PostHogChunkIdRegistry = {};
  for (const [stack, chunkId] of Object.entries(registry)) {
    // The key is a stack captured in the file, so its first frame names it.
    const first = stack.split("\n").find(isFrameLine);
    const frame = first && reportableFrame(first, sources);
    if (frame?.startsWith(BUNDLE_FRAME_PREFIX)) {
      reduced[`Error\n${frame}`] = chunkId;
    }
  }
  return { ...reduced, ...registry };
}

const BUILTIN_MODULES = new Set(
  builtinModules.map((name) => name.replace(/^node:/, "")),
);

/** A frame path or file URL as a path with forward slashes. */
function normalizeFramePath(rawPath: string): string | undefined {
  let filePath = rawPath;
  if (filePath.startsWith("file://")) {
    try {
      filePath = decodeURIComponent(filePath.slice("file://".length));
    } catch {
      return undefined;
    }
    // file:///C:/x is the Windows path C:/x.
    if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1);
  }
  return filePath.replace(/\\/g, "/");
}

let shippedSources: FrameSources | undefined;

/**
 * Where the running app's code lives. The bundle sits in `.vite/build` under
 * the app root, which is `app.asar` when packaged. Native packages are
 * unpacked next to it.
 */
function shippedFrameSources(): FrameSources {
  if (shippedSources) return shippedSources;
  const buildDir = __dirname;
  const appRoot = path.resolve(buildDir, "..", "..");
  const packageRoots = [appRoot, `${appRoot}.unpacked`];
  shippedSources = {
    buildDir: buildDir.replace(/\\/g, "/"),
    buildFiles: new Set(readDirectory(buildDir)),
    packageRoots: packageRoots.map((root) => root.replace(/\\/g, "/")),
    packages: new Set(
      packageRoots.flatMap((root) =>
        packageNames(path.join(root, "node_modules")),
      ),
    ),
  };
  return shippedSources;
}

function packageNames(modulesDir: string): string[] {
  return readDirectory(modulesDir).flatMap((entry) =>
    entry.startsWith("@")
      ? readDirectory(path.join(modulesDir, entry)).map(
          (name) => `${entry}/${name}`,
        )
      : [entry],
  );
}

function readDirectory(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export function shouldFilterTelemetryException(error: unknown): boolean {
  // Ahead of the kind check, which returns for every DyadError: this one is a
  // DyadError too. A non-2xx from a self-hosted Coolify is that instance
  // rejecting a request rather than a fault here, and its message carries
  // whatever that machine chose to say — which can name a host, a path or a
  // connection string. The user still sees it; nothing reports it.
  if (error instanceof Error && error.name === COOLIFY_REQUEST_ERROR_NAME) {
    return true;
  }

  // Same reasoning one layer down: a request that never reached the instance
  // fails with the host in its message — "getaddrinfo ENOTFOUND <their box>" —
  // and its kind is External, which is not otherwise filtered.
  if (error instanceof Error && error.name === COOLIFY_TRANSPORT_ERROR_NAME) {
    return true;
  }

  // A self-hosted GitLab is the same surface: a non-2xx quotes the body that
  // instance chose to return, and a failed connection carries its address.
  // The Coolify deploy reaches GitLab on a `coolify:` channel, so the channel
  // prefix alone would not have covered every path there either.
  if (
    error instanceof Error &&
    (error.name === GITLAB_REQUEST_ERROR_NAME ||
      error.name === GITLAB_TRANSPORT_ERROR_NAME)
  ) {
    return true;
  }

  // The same thing again over SSH rather than HTTP: an address that does not
  // answer, or a port nobody is listening on, is the user's own network being
  // reported as a fault here — and the message carries whatever they typed.
  // Only the two that say what went wrong. "unknown" is the bucket for a
  // failure nothing here recognised, which is what telemetry is for.
  const sshFailure = sshFailureOf(error);
  if (sshFailure === "unreachable" || sshFailure === "timeout") {
    return true;
  }

  if (error instanceof DyadError) {
    return isDyadErrorKindFilteredFromTelemetry(error.kind);
  }

  if (
    error instanceof Error &&
    error.name === "RateLimitError" &&
    error.message.includes("(429)")
  ) {
    return true;
  }

  if (
    error instanceof Error &&
    isGenericFetchFailedError(error.name, error.message)
  ) {
    return true;
  }

  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  return FILTERED_EXCEPTION_MESSAGES.has(message);
}
