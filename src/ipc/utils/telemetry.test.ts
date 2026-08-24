import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
}));
vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: {
          send: (_channel: string, payload: { properties: unknown }) => {
            sent.calls.push(payload.properties as Record<string, unknown>);
          },
        },
      },
    ],
  },
}));
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  sendTelemetryEventToWindow,
  sendTelemetryException,
  shouldFilterTelemetryException,
} from "@/ipc/utils/telemetry";

describe("shouldFilterTelemetryException", () => {
  it("filters the known Supabase auth noise message", () => {
    expect(
      shouldFilterTelemetryException(
        new Error(
          "Supabase access token not found. Please authenticate first.",
        ),
      ),
    ).toBe(true);
  });

  it("does not report a server that could not be reached over SSH", async () => {
    // A mistyped address or a firewalled port 22 is the user's own network,
    // and the message carries whatever they typed.
    const { SshError } = await import("@/ipc/utils/ssh_client");
    expect(
      shouldFilterTelemetryException(
        new SshError(
          "unreachable",
          "Could not reach the server (ENOTFOUND).",
          DyadErrorKind.External,
        ),
      ),
    ).toBe(true);
    expect(
      shouldFilterTelemetryException(
        new SshError(
          "timeout",
          "The server did not answer in time.",
          DyadErrorKind.External,
        ),
      ),
    ).toBe(true);
  });

  it("still reports an SSH failure nothing here recognised", async () => {
    // The bucket for what was not classified is the one worth hearing about.
    const { SshError } = await import("@/ipc/utils/ssh_client");
    expect(
      shouldFilterTelemetryException(
        new SshError(
          "unknown",
          "Could not connect over SSH: something new",
          DyadErrorKind.External,
        ),
      ),
    ).toBe(false);
  });

  it("filters RateLimitError 429s from retryWithRateLimit", () => {
    const error = new Error("Rate limited (429): Too Many Requests");
    error.name = "RateLimitError";

    expect(shouldFilterTelemetryException(error)).toBe(true);
  });

  it("filters generic TypeError fetch failed network noise", () => {
    const error = new TypeError("fetch failed");

    expect(shouldFilterTelemetryException(error)).toBe(true);
  });

  it("does not filter non-429 RateLimitError variants", () => {
    const error = new Error("Rate limited (503): Service Unavailable");
    error.name = "RateLimitError";

    expect(shouldFilterTelemetryException(error)).toBe(false);
  });

  it("does not filter different Supabase auth failures", () => {
    expect(
      shouldFilterTelemetryException(
        new Error(
          "Supabase access token not found for organization acme. Please authenticate first.",
        ),
      ),
    ).toBe(false);
  });

  it("filters DyadError kinds that are non-actionable for telemetry", () => {
    expect(
      shouldFilterTelemetryException(
        new DyadError("bad input", DyadErrorKind.Validation),
      ),
    ).toBe(true);
    expect(
      shouldFilterTelemetryException(
        new DyadError("missing", DyadErrorKind.NotFound),
      ),
    ).toBe(true);
  });

  it("does not filter DyadError Internal, External, or Unknown", () => {
    expect(
      shouldFilterTelemetryException(
        new DyadError("bug", DyadErrorKind.Internal),
      ),
    ).toBe(false);
    expect(
      shouldFilterTelemetryException(
        new DyadError("upstream", DyadErrorKind.External),
      ),
    ).toBe(false);
    expect(
      shouldFilterTelemetryException(new DyadError("?", DyadErrorKind.Unknown)),
    ).toBe(false);
  });
});

describe("sendTelemetryEventToWindow", () => {
  it("sends through the selected product window", () => {
    const send = vi.fn();
    const target = { webContents: { send } } as unknown as BrowserWindow;

    sendTelemetryEventToWindow(target, "app:crash_detected", { error: true });

    expect(send).toHaveBeenCalledWith("telemetry:event", {
      eventName: "app:crash_detected",
      properties: { error: true },
    });
  });
});

/**
 * The exception payload carries four fields, and only the message is built
 * from arbitrary strings. For a server the user runs, that message can hold
 * the machine's address or whatever it chose to say back, so it is dropped
 * rather than audited throw site by throw site.
 */
describe("exceptions from a self-hosted instance", () => {
  beforeEach(() => {
    sent.calls.length = 0;
  });

  it("reports the error without its message", () => {
    sendTelemetryException(
      new Error("getaddrinfo ENOTFOUND coolify.internal.example.com"),
      { ipc_channel: "coolify:discover" },
    );

    expect(sent.calls).toHaveLength(1);
    const payload = sent.calls[0];
    expect(JSON.stringify(payload)).not.toContain("coolify.internal");
    expect(payload.exception_message).toBeUndefined();
    // Still identifiable: the name, the stack and the channel all survive.
    expect(payload.exception_name).toBe("Error");
    // The frames survive, so the throw site is still identifiable.
    expect(String(payload.exception_stack_trace)).toContain("telemetry.test");
    expect(payload.ipc_channel).toBe("coolify:discover");
  });

  it("redacts setting a server up, not only deploying to one", () => {
    // Its failures quote the installer's own output, the server's address, and
    // the address the user signs in with. The prefix differs from the deploy
    // channels by one word, which is all it took to miss the filter.
    sendTelemetryException(
      new Error(
        "Installing Coolify failed. The server said: connect ECONNRESET " +
          "203.0.113.5:22 for someone@theirdomain.com",
      ),
      { ipc_channel: "coolify-setup:run" },
    );

    const payload = sent.calls[0];
    // The stack header repeats the message, so the whole payload is checked
    // rather than the message field alone.
    expect(JSON.stringify(payload)).not.toContain("203.0.113.5");
    expect(JSON.stringify(payload)).not.toContain("theirdomain.com");
    expect(payload.exception_message).toBeUndefined();
    expect(payload.ipc_channel).toBe("coolify-setup:run");
  });

  it("keeps the message for every other channel", () => {
    sendTelemetryException(new Error("something broke"), {
      ipc_channel: "apps:list",
    });

    expect(sent.calls[0].exception_message).toBe("something broke");
  });
});
