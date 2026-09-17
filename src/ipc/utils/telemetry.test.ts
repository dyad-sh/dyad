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
  GITLAB_REQUEST_ERROR_NAME,
  GITLAB_TRANSPORT_ERROR_NAME,
} from "@/shared/gitlab_error_names";
import { ResponseValidationError } from "@vercel/sdk/models/responsevalidationerror.js";
import { SDKError } from "@vercel/sdk/models/sdkerror.js";
import { getVercelProjectCreationError } from "./vercel_errors";
import { serializeIpcError, deserializeIpcError } from "../contracts/core";
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

describe("Vercel project diagnostics", () => {
  beforeEach(() => {
    sent.calls.length = 0;
  });

  it.each(["validation", "api"])(
    "keeps %s details in IPC while telemetry receives only fixed fields",
    (type) => {
      const detail = "private-customer-repo\n    at private-credential";
      const httpMeta = {
        response: new Response(null, { status: type === "api" ? 500 : 200 }),
        request: new Request("https://api.vercel.com/v10/projects"),
        body:
          type === "api"
            ? JSON.stringify({ error: { message: detail } })
            : "{}",
      };
      const upstream =
        type === "api"
          ? new SDKError("API error occurred", httpMeta)
          : new ResponseValidationError("Response validation failed", {
              ...httpMeta,
              rawValue: {},
              rawMessage: "Response validation failed",
              cause: new Error(detail),
            });
      const error = getVercelProjectCreationError(upstream);

      expect(deserializeIpcError(serializeIpcError(error)).message).toContain(
        detail,
      );
      sendTelemetryException(error, { ipc_channel: "vercel:create-project" });
      expect(sent.calls).toEqual([
        {
          exception_name: "VercelProjectSetupError",
          exception_message: "Vercel project setup failed.",
          ipc_channel: "vercel:create-project",
        },
      ]);
      expect(JSON.stringify(sent.calls)).not.toContain("private-");
    },
  );

  it("continues filtering expected failures before reporting classification", () => {
    sendTelemetryException(
      new DyadError("private-auth-details", DyadErrorKind.Auth),
      {
        ipc_channel: "vercel:create-project",
      },
    );
    expect(sent.calls).toEqual([]);
  });

  it.each([400, 401, 403, 409, 429])(
    "filters mapped HTTP %s API failures",
    (status) => {
      const error = new SDKError("API error occurred", {
        response: new Response(null, { status }),
        request: new Request("https://api.vercel.com/v10/projects"),
        body: JSON.stringify({
          error: { message: "private-provider-details" },
        }),
      });
      sendTelemetryException(getVercelProjectCreationError(error), {
        ipc_channel: "vercel:create-project",
      });
      expect(sent.calls).toEqual([]);
    },
  );
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

  it("redacts a self-hosted GitLab the same way", () => {
    // A GitLab the user runs is the same class of surface as their Coolify:
    // the address is theirs and the body is whatever that machine returned.
    sendTelemetryException(
      new Error(
        "Could not reach GitLab at https://gitlab.acme-internal.example: " +
          "getaddrinfo ENOTFOUND gitlab.acme-internal.example",
      ),
      { ipc_channel: "gitlab:list-projects" },
    );

    const payload = sent.calls[0];
    expect(JSON.stringify(payload)).not.toContain("acme-internal");
    expect(payload.exception_message).toBeUndefined();
    expect(payload.ipc_channel).toBe("gitlab:list-projects");
  });

  it("keeps the message for every other channel", () => {
    sendTelemetryException(new Error("something broke"), {
      ipc_channel: "apps:list",
    });

    expect(sent.calls[0].exception_message).toBe("something broke");
  });
});

describe("GitLab errors are not reported at all", () => {
  it("filters a non-2xx from the instance and a failed connection to it", () => {
    // The Coolify deploy talks to GitLab on a `coolify:` channel, so the
    // channel prefix alone would not have covered every path.
    const requestError = new DyadError(
      "GitLab answered 500: <the instance's own error page>",
      DyadErrorKind.External,
    );
    requestError.name = GITLAB_REQUEST_ERROR_NAME;
    const transportError = new DyadError(
      "Could not reach GitLab at https://gitlab.acme-internal.example: refused",
      DyadErrorKind.External,
    );
    transportError.name = GITLAB_TRANSPORT_ERROR_NAME;

    expect(shouldFilterTelemetryException(requestError)).toBe(true);
    expect(shouldFilterTelemetryException(transportError)).toBe(true);
  });
});
