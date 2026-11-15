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
  framesOnly,
  reportableErrorName,
  sendTelemetryEventToWindow,
  sendTelemetryException,
  shouldFilterTelemetryException,
  reportableStack,
  stackFrames,
  withReducedChunkKeys,
  type FrameSources,
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

describe("main-process chunk IDs on forwarded exceptions", () => {
  const host = globalThis as { _posthogChunkIds?: unknown };

  beforeEach(() => {
    sent.calls.length = 0;
    delete host._posthogChunkIds;
  });

  it("forwards the registry so the renderer can tag main-process frames", () => {
    host._posthogChunkIds = { "Error\n    at main-abc.js:1:1": "chunk-main" };
    try {
      sendTelemetryException(new Error("Boom"), { ipc_channel: "app:list" });
    } finally {
      delete host._posthogChunkIds;
    }

    expect(sent.calls[0].posthog_chunk_ids).toEqual({
      "Error\n    at main-abc.js:1:1": "chunk-main",
    });
  });

  it("omits the property in builds without injected chunk IDs", () => {
    sendTelemetryException(new Error("Boom"));
    expect(sent.calls[0]).not.toHaveProperty("posthog_chunk_ids");
  });
});

describe("framesOnly", () => {
  it("keeps a message line that looks like a frame out of the frames", () => {
    const error = new Error("request failed:\n    at Bearer secret-token");

    const frames = framesOnly(error);

    expect(frames).not.toContain("secret-token");
    expect(frames).toMatch(/^Error\n\s+at .*telemetry\.test/);
  });

  it("keeps no frames when the message is not in the stack", () => {
    const error = new Error("original");
    // V8 builds the stack text on first read, so read it before the change.
    void error.stack;
    error.message = "changed:\n    at Bearer secret-token";

    expect(framesOnly(error)).toBe("Error");
  });
});

describe("stackFrames", () => {
  // Vitest writes "name: " for an error with no message, where V8 writes the
  // name alone, so this test writes the stack as V8 does.
  it("keeps a name line that looks like a frame out of the frames", () => {
    const error = new Error("");
    error.name = "Error\n    at Bearer secret-token";
    error.stack = [error.name, "    at run (/app/main.js:1:2)"].join("\n");

    expect(stackFrames(error)).toEqual(["    at run (/app/main.js:1:2)"]);
  });

  it("keeps message lines out when the name contains the message", () => {
    const error = new Error("Q");
    error.name = "Q\n    at Bearer secret-token Q";

    const frames = stackFrames(error);

    expect(frames.join("\n")).not.toContain("secret-token");
    expect(frames[0]).toMatch(/^\s+at .*telemetry\.test/);
  });

  // Node writes its own errors' headers with the code after the name. Vitest
  // formats stacks itself, so these tests write the stack as Node prints it.
  it("keeps the frames of a Node error with its code in the header", () => {
    const message = 'The "path" argument must be of type string';
    const error = Object.assign(new TypeError(message), {
      code: "ERR_INVALID_ARG_TYPE",
    });
    error.stack = [
      `TypeError [ERR_INVALID_ARG_TYPE]: ${message}`,
      "    at Object.join (node:path:1339:7)",
      "    at run (/app/main.js:1:2)",
    ].join("\n");

    expect(stackFrames(error)).toEqual([
      "    at Object.join (node:path:1339:7)",
      "    at run (/app/main.js:1:2)",
    ]);
  });

  it("keeps message lines out of a header with a code", () => {
    const message = "m\n    at Bearer secret-token";
    const error = Object.assign(new Error(message), { code: "ERR_X" });
    error.stack = [
      `Error [ERR_X]: ${message}`,
      "    at run (/app/main.js:1:2)",
    ].join("\n");

    expect(stackFrames(error)).toEqual(["    at run (/app/main.js:1:2)"]);
  });

  // V8 builds the stack text on first read, so these read it, as a logger
  // would, before the message changes.
  it("keeps no frames when the message was cut to its first line", () => {
    const error = new Error("Invalid state\n    at prompt: my secret prompt");
    void error.stack;
    error.message = "Invalid state";

    expect(stackFrames(error)).toEqual([]);
    expect(framesOnly(error)).toBe("Error");
  });

  it("keeps no frames when the message was cut mid-line", () => {
    const error = new Error("token abc123\n    at run (/app/main.js:1:2)");
    void error.stack;
    error.message = "token";

    expect(stackFrames(error)).toEqual([]);
  });

  it("keeps no frames when the message was cleared", () => {
    const error = new Error("secret\n    at Bearer secret-token");
    void error.stack;
    error.message = "";

    expect(stackFrames(error)).toEqual([]);
  });

  it("keeps no frames when a line is too long to be a frame", () => {
    const error = new Error("x");
    error.stack = [
      "Error: x",
      `    at run (/app/${"a".repeat(1000)}.js:1:2)`,
      "    at run (/app/main.js:1:2)",
    ].join("\n");

    expect(stackFrames(error)).toEqual([]);
  });

  it("keeps every form of frame V8 writes", () => {
    const frames = [
      "    at run (/app/main.js:1:2)",
      "    at /app/main.js:1:2",
      "    at async run (file:///C:/app/main.js:1:2)",
      "    at JSON.parse (<anonymous>)",
      "    at new Promise (<anonymous>)",
      "    at <anonymous>",
      "    at async Promise.all (index 0)",
      "    at Array.map (native)",
      "    at eval (eval at <anonymous> (/app/main.js:26:7), <anonymous>:1:6)",
      "    at add (wasm://wasm/9a8b7c:wasm-function[1]:0x1f)",
      "    at node:internal/process/task_queues:95:5",
    ];
    const error = new Error("x");
    error.stack = ["Error: x", ...frames].join("\n");

    expect(stackFrames(error)).toEqual(frames);
  });
});

describe("reportableErrorName", () => {
  it("keeps a listed name", () => {
    expect(reportableErrorName(new TypeError("x"))).toBe("TypeError");
  });

  it("keeps the names of cancelled, timed out and database failures", () => {
    for (const name of ["AbortError", "TimeoutError", "SqliteError"]) {
      const error = new Error("x");
      error.name = name;

      expect(reportableErrorName(error)).toBe(name);
    }
  });

  it("replaces an unlisted name", () => {
    const error = new Error("x");
    error.name = "secret-name";

    expect(reportableErrorName(error)).toBe("UnlistedError");
  });
});

describe("reportableStack", () => {
  const linux: FrameSources = {
    buildDir: "/opt/Dyad/resources/app.asar/.vite/build",
    buildFiles: new Set(["main-ABC.js"]),
    packageRoots: [
      "/opt/Dyad/resources/app.asar",
      "/opt/Dyad/resources/app.asar.unpacked",
    ],
    packages: new Set(["ssh2", "@vscode/ripgrep"]),
  };
  const windowsRoot =
    "C:/Users/Jane Doe/AppData/Local/dyad/app-1.0.0/resources/app.asar";
  const windows: FrameSources = {
    buildDir: `${windowsRoot}/.vite/build`,
    buildFiles: new Set(["main-ABC.js"]),
    packageRoots: [windowsRoot, `${windowsRoot}.unpacked`],
    packages: new Set(["ssh2"]),
  };
  const macRoot = "/Applications/Dyad.app/Contents/Resources/app.asar";
  const mac: FrameSources = {
    buildDir: `${macRoot}/.vite/build`,
    buildFiles: new Set(["main-ABC.js"]),
    packageRoots: [macRoot],
    packages: new Set(),
  };

  function errorWithFrames(frames: string[]): Error {
    const error = new Error("m");
    error.stack = ["Error: m", ...frames].join("\n");
    return error;
  }

  it("reduces bundle frames to a shipped file and position", () => {
    const error = errorWithFrames([
      "    at Object.secretKey (/opt/Dyad/resources/app.asar/.vite/build/main-ABC.js:10:5)",
      "    at async /opt/Dyad/resources/app.asar/.vite/build/main-ABC.js:20:7",
    ]);

    expect(reportableStack(error, linux)).toBe(
      [
        "Error",
        "    at .vite/build/main-ABC.js:10:5",
        "    at .vite/build/main-ABC.js:20:7",
      ].join("\n"),
    );
  });

  it("reduces Windows paths and file URLs, dropping the user's folder", () => {
    const error = errorWithFrames([
      "    at run (C:\\Users\\Jane Doe\\AppData\\Local\\dyad\\app-1.0.0\\resources\\app.asar\\.vite\\build\\main-ABC.js:1:2)",
      "    at file:///C:/Users/Jane%20Doe/AppData/Local/dyad/app-1.0.0/resources/app.asar/.vite/build/main-ABC.js:3:4",
      "    at connect (C:\\Users\\Jane Doe\\AppData\\Local\\dyad\\app-1.0.0\\resources\\app.asar.unpacked\\node_modules\\ssh2\\lib\\client.js:5:6)",
    ]);

    expect(reportableStack(error, windows)).toBe(
      [
        "Error",
        "    at .vite/build/main-ABC.js:1:2",
        "    at .vite/build/main-ABC.js:3:4",
        "    at node_modules/ssh2",
      ].join("\n"),
    );
  });

  it("reduces a macOS frame", () => {
    const error = errorWithFrames([
      "    at /Applications/Dyad.app/Contents/Resources/app.asar/.vite/build/main-ABC.js:8:9",
    ]);

    expect(reportableStack(error, mac)).toBe(
      "Error\n    at .vite/build/main-ABC.js:8:9",
    );
  });

  it("reduces shipped packages and Node modules to their names", () => {
    const error = errorWithFrames([
      "    at Client.connect (/opt/Dyad/resources/app.asar.unpacked/node_modules/ssh2/lib/client.js:1:2)",
      "    at search (/opt/Dyad/resources/app.asar/node_modules/@vscode/ripgrep/lib/index.js:3:4)",
      "    at Object.readFileSync (node:fs:453:20)",
      "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
    ]);

    expect(reportableStack(error, linux)).toBe(
      [
        "Error",
        "    at node_modules/ssh2",
        "    at node_modules/@vscode/ripgrep",
        "    at node:fs:453:20",
        "    at node:internal",
      ].join("\n"),
    );
  });

  it("drops every frame that names nothing shipped", () => {
    const error = errorWithFrames([
      "    at Bearer secret-token",
      "    at secret (/home/jane/notes-secret.txt:1:1)",
      "    at /opt/Dyad/resources/app.asar/.vite/build/secret-file.js:1:1",
      "    at /opt/Dyad/resources/app.asar/.vite/build/../../secret.js:1:1",
      "    at /opt/Dyad/resources/app.asar/node_modules/secret-package/index.js:1:1",
      "    at /opt/Dyad/resources/app.asar/node_modules/../secret.js:1:1",
      "    at x (/opt/Dyad (secret)/resources/app.asar/.vite/build/main-ABC.js:1:1)",
      "    at eval (eval at secret (/opt/Dyad/resources/app.asar/.vite/build/main-ABC.js:1:1), <anonymous>:1:1)",
      "    at Array.map (<anonymous>)",
      "    at async Promise.all (index 0)",
      "    at /opt/Dyad/resources/app.asar/.vite/build/main-ABC.js:12345678:1",
    ]);

    expect(reportableStack(error, linux)).toBe("Error");
  });

  it("uses the listed name and skips the header", () => {
    const error = new Error("");
    error.name =
      "secret\n    at /opt/Dyad/resources/app.asar/.vite/build/main-ABC.js:1:1";

    expect(reportableStack(error, linux)).toMatch(/^UnlistedError(\n|$)/);
    expect(reportableStack(error, linux)).not.toContain("secret");
  });

  it("is a string for an error without a stack", () => {
    const error = new TypeError("x");
    error.stack = undefined;

    expect(reportableStack(error, linux)).toBe("TypeError");
  });
});

describe("withReducedChunkKeys", () => {
  const root = "C:/Users/Jane Doe/AppData/Local/dyad/app-1.0.0/resources";
  const sources: FrameSources = {
    buildDir: `${root}/app.asar/.vite/build`,
    buildFiles: new Set(["main-ABC.js", "index-DEF.js"]),
    packageRoots: [`${root}/app.asar`],
    packages: new Set(["ssh2"]),
  };
  const file = String.raw`C:\Users\Jane Doe\AppData\Local\dyad\app-1.0.0\resources\app.asar\.vite\build\main-ABC.js`;
  // A key as the injected snippet writes it: a stack captured in the file.
  const key = [
    "Error",
    `    at ${file}:1:234`,
    `    at Object.<anonymous> (${file}:9:9)`,
    "    at Module._compile (node:internal/modules/cjs/loader:1871:14)",
  ].join("\n");

  it("adds a key that names the file as a reduced frame does", () => {
    const registry = withReducedChunkKeys({ [key]: "chunk-main" }, sources);

    expect(registry).toEqual({
      [key]: "chunk-main",
      "Error\n    at .vite/build/main-ABC.js:1:234": "chunk-main",
    });

    // The file a reported frame names is the file the new key names.
    const error = new Error("x");
    error.stack = `Error: x\n    at run (${file}:10:20)`;
    expect(reportableStack(error, sources)).toBe(
      "Error\n    at .vite/build/main-ABC.js:10:20",
    );
  });

  it("adds no key for a stack that names no bundle file", () => {
    const registry = {
      "Error\n    at main-abc.js:1:1": "a",
      [`Error\n    at ${root}/app.asar/node_modules/ssh2/index.js:1:1`]: "b",
      "Error\n    at node:fs:1:1": "c",
      "not a stack": "d",
    };

    expect(withReducedChunkKeys(registry, sources)).toEqual(registry);
  });
});
