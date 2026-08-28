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

  // For a server the user runs, the message is the one field built from
  // arbitrary strings: the machine's address, its certificate, whatever it
  // chose to say back. Decided per channel rather than per message, so a throw
  // site added later cannot opt back in by accident.
  const selfHosted = isSelfHostedChannel(context);

  sendTelemetryEvent("$exception", {
    exception_name: err.name,
    ...(selfHosted ? {} : { exception_message: err.message }),
    exception_stack_trace: selfHosted ? framesOnly(err) : err.stack,
    ...context,
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
const SELF_HOSTED_CHANNEL_PREFIXES = ["coolify:", "coolify-setup:"];

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
function framesOnly(err: Error): string | undefined {
  if (!err.stack) return undefined;
  const frames = err.stack.split("\n").filter((line) => /^\s+at /.test(line));
  return [err.name, ...frames].join("\n");
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
