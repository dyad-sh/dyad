import { describe, expect, it } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  SupabaseTestUserCreationRejectedError,
  SupabaseTestUserOperationError,
  getSupabaseTestUserMessage,
  parseSupabaseTestUserErrorResponse,
  supabaseTestUserStepError,
  withSupabaseTestUserOperation,
  withSupabaseTestUserStep,
} from "./supabase_test_user_errors";

describe("Supabase test-user diagnostics", () => {
  it.each([
    ["ENOTFOUND", "couldn't reach Supabase"],
    ["ECONNREFUSED", "Check your internet connection or VPN"],
    ["CERT_HAS_EXPIRED", "secure connection to Supabase"],
    ["SELF_SIGNED_CERT_IN_CHAIN", "VPN or security software"],
    ["ETIMEDOUT", "didn't respond in time"],
    ["UND_ERR_HEADERS_TIMEOUT", "didn't respond in time"],
  ])(
    "explains %s in plain language while preserving its diagnostic",
    (code, guidance) => {
      const cause = new TypeError("private request details", {
        cause: { code },
      });
      const error = supabaseTestUserStepError(
        "per-test setup",
        new SupabaseTestUserOperationError("create", cause),
      );
      const message = getSupabaseTestUserMessage(error);
      expect(message).toContain(guidance);
      expect(message).not.toMatch(
        /private|\/auth\/|Transport failure|per-test setup/,
      );
      expect(message).not.toContain(code);
      expect(message!.length).toBeLessThan(400);
      expect(error.message).toContain(code);
      expect(error.message).toContain("POST /auth/v1/admin/users");
    },
  );

  it.each([
    [400, "email_address_invalid", "test account's email address"],
    [400, "weak_password", "password requirements"],
    [400, "23503", "database rules blocked this step"],
    [500, "P0001", "database rules blocked this step"],
    [401, undefined, "connection and permissions"],
    [403, undefined, "connection and permissions"],
    [429, undefined, "Wait a moment"],
    [503, undefined, "Try again in a moment"],
    [400, "unrecognized-private-code", "Check your project settings"],
  ] as const)(
    "explains HTTP %s / %s without showing diagnostic codes",
    (status, code, guidance) => {
      const error = new SupabaseTestUserOperationError(
        "create",
        undefined,
        status,
        { code, message: "private response" },
      );
      expect(error.userMessage).toContain(guidance);
      expect(error.userMessage).not.toMatch(/private|HTTP|\/auth\//);
      if (code) expect(error.userMessage).not.toContain(code);
      expect(error.message).toContain(`HTTP ${status}`);
    },
  );

  it("keeps cleanup and verification context without technical prefixes", () => {
    const cleanup = supabaseTestUserStepError(
      "cleanup",
      new SupabaseTestUserOperationError("delete", { code: "ENOTFOUND" }),
    );
    expect(cleanup.userMessage).toContain(
      "couldn't remove the temporary test account",
    );
    expect(cleanup.userMessage).toContain("Check your internet connection");
    expect(cleanup.userMessage).not.toMatch(/DELETE|ENOTFOUND|per-test/);
    const verification = new SupabaseTestUserOperationError(
      "verify",
      new SyntaxError("private response"),
    );
    expect(verification.userMessage).toContain(
      "couldn't check whether the test account was created",
    );
    expect(verification.userMessage).toContain(
      "couldn't read Supabase's response",
    );
  });

  it("keeps prerequisite advice and handles unknown failures without guessing an outage", () => {
    const prerequisite = new DyadError(
      "Create a secret key in Supabase.",
      DyadErrorKind.Precondition,
    );
    expect(supabaseTestUserStepError("setup", prerequisite).userMessage).toBe(
      prerequisite.message,
    );
    const failure = new Error("fetch failed private details");
    expect(getSupabaseTestUserMessage(failure)).toBeUndefined();
    const message = supabaseTestUserStepError(
      "per-test setup",
      failure,
    ).userMessage;
    expect(message).toContain("Check your internet connection and try again");
    expect(message).not.toMatch(/private|fetch failed|unavailable|outage/);
    expect(
      supabaseTestUserStepError("cleanup", prerequisite).userMessage,
    ).toContain("Test cleanup couldn't finish");
    const cleanup = supabaseTestUserStepError("cleanup", failure).userMessage;
    expect(cleanup).toContain("Test cleanup couldn't finish");
    expect(cleanup).not.toContain("prepare test data");
  });

  it.each<[Record<string, unknown>, string]>([
    [
      { code: "email_address_invalid" },
      "rejected the email address or its domain",
    ],
    [{ code: 400, error_code: "weak_password" }, "strength requirements"],
    [{ code: "23514" }, "database check constraint"],
    [{ error_code: "P0001" }, "database function raised an exception"],
    [{ code: "unexpected_failure" }, "unspecified server failure"],
  ])(
    "explains known provider codes without retaining response values (%j)",
    (fields, explanation) => {
      const body = parseSupabaseTestUserErrorResponse(
        JSON.stringify({
          ...fields,
          message: "private@example.com sb_secret_private",
          details: "Authorization: Bearer private",
          hint: "https://private.supabase.co/auth?token=private",
        }),
      );
      const error = new SupabaseTestUserOperationError(
        "create",
        undefined,
        400,
        body,
      );
      expect(error.message).toContain(explanation);
      expect(error.message).toContain("HTTP 400");
      expect(error.providerCode).toBe(fields.error_code ?? fields.code);
      expect(JSON.stringify(error)).not.toContain("private");
      expect(error.stack).not.toContain("private");
    },
  );

  it.each([
    "not JSON sb_secret_private",
    "null",
    "42",
    "[]",
    JSON.stringify([{ code: "email_address_invalid" }]),
    JSON.stringify({ message: "email_address_invalid sb_secret_private" }),
    JSON.stringify({ code: "sb_secret_private" }),
    JSON.stringify({ code: "unknown_code", message: "private@example.com" }),
    JSON.stringify({ code: "constructor" }),
    JSON.stringify({ code: "__proto__" }),
    JSON.stringify({ code: 23514 }),
    JSON.stringify({ error_code: "unknown_code", code: "weak_password" }),
  ])(
    "falls back safely for malformed or unknown provider responses (%s)",
    (text) => {
      const error = new SupabaseTestUserOperationError(
        "create",
        undefined,
        400,
        parseSupabaseTestUserErrorResponse(text),
      );
      expect(error.providerCode).toBeUndefined();
      expect(error.message).toContain("HTTP 400");
      expect(error.message).toContain("Auth and database logs");
      expect(error.message).not.toContain("email_address_invalid");
      expect(error.message).not.toContain("weak_password");
      expect(JSON.stringify(error)).not.toContain("private");
    },
  );

  it("keeps the diagnostic bounded even when the provider includes a large message", () => {
    const body = parseSupabaseTestUserErrorResponse(
      JSON.stringify({
        code: "validation_failed",
        message: "private".repeat(100_000),
      }),
    );
    const error = new SupabaseTestUserOperationError(
      "create",
      undefined,
      400,
      body,
    );
    expect(error.message).toContain("parameters failed validation");
    expect(error.message.length).toBeLessThan(1_000);
    expect(JSON.stringify(error)).not.toContain("private");
  });

  it("keeps nested and aggregate transport codes without projecting sensitive fields", async () => {
    const privateDetail =
      "sb_secret_private https://private.supabase.co/auth?token=private Authorization: Bearer private user@private.test /private/path";
    const cause = new TypeError(privateDetail, {
      cause: new AggregateError(
        [
          Object.assign(new Error(privateDetail), { code: "ENOTFOUND" }),
          Object.assign(new Error(privateDetail), {
            code: "SELF_SIGNED_CERT_IN_CHAIN",
          }),
          {
            code: privateDetail,
            message: privateDetail,
            headers: { apikey: privateDetail },
          },
        ],
        privateDetail,
      ),
    });
    const error = await withSupabaseTestUserStep("per-test setup", () =>
      withSupabaseTestUserOperation("create", async () => {
        throw cause;
      }),
    ).catch((error) => error);
    expect(error.message).toContain(
      "Supabase test database per-test setup failed",
    );
    expect(error.message).toContain("POST /auth/v1/admin/users");
    expect(error.message).toContain("ENOTFOUND");
    expect(error.message).toContain("SELF_SIGNED_CERT_IN_CHAIN");
    expect(error.message).toContain("certificate trust");
    expect(error.message).toContain("Check DNS");
    expect(error.message).not.toContain("private");
    expect(error.cause.cause).toBe(cause);
  });

  it("bounds cyclic, deeply nested and wide aggregate causes", () => {
    const cause: { cause?: unknown; errors?: unknown[] } = {};
    cause.cause = cause;
    cause.errors = Array.from({ length: 1_000 }, () => cause);
    expect(
      new SupabaseTestUserOperationError("delete", cause).message.length,
    ).toBeLessThan(1_000);
    let nested: unknown = { code: "ENOTFOUND" };
    for (let i = 0; i < 100; i++) nested = { cause: nested };
    expect(
      new SupabaseTestUserOperationError("create", nested).message,
    ).not.toContain("ENOTFOUND");
  });

  it("distinguishes an invalid provider response without exposing its content", () => {
    const error = new SupabaseTestUserOperationError(
      "verify",
      new SyntaxError("Unexpected token in sb_secret_private"),
    );
    expect(error.message).toContain("invalid response");
    expect(error.message).toContain("POST /v1/projects/{ref}/database/query");
    expect(error.message).not.toContain("sb_secret_private");
  });

  it.each([401, 403, 429, 503])(
    "reports HTTP %s without copying a response body",
    async (status) => {
      const cause = Object.assign(new Error("sb_secret_private"), { status });
      const error = await withSupabaseTestUserOperation("create", async () => {
        throw cause;
      }).catch((error) => error);
      expect(error.message).toContain(`HTTP ${status}`);
      expect(error.message).not.toContain("private");
      expect(error.cause).toBe(cause);
    },
  );

  it("preserves cancellation identity, prerequisite classification and verified rejection", async () => {
    const controller = new AbortController();
    const cancelled = new Error("stopped");
    controller.abort(cancelled);
    await expect(
      withSupabaseTestUserStep(
        "cleanup",
        () =>
          withSupabaseTestUserOperation(
            "delete",
            async () => {
              throw new Error("fetch failed");
            },
            controller.signal,
          ),
        controller.signal,
      ),
    ).rejects.toBe(cancelled);
    const prerequisite = new DyadError(
      "Create a secret key in Supabase.",
      DyadErrorKind.Precondition,
    );
    await expect(
      withSupabaseTestUserStep("setup", () =>
        withSupabaseTestUserOperation("adminKey", async () => {
          throw prerequisite;
        }),
      ),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      cause: prerequisite,
    });
    const rejected = new SupabaseTestUserCreationRejectedError();
    await expect(
      withSupabaseTestUserStep("per-test setup", async () => {
        throw rejected;
      }),
    ).rejects.toBe(rejected);
  });
});
