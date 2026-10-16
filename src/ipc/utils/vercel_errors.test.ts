import { describe, expect, it } from "vitest";
import { ResponseValidationError } from "@vercel/sdk/models/responsevalidationerror.js";
import { SDKError } from "@vercel/sdk/models/sdkerror.js";
import { z } from "zod/v3";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  getVercelDeploymentError,
  getVercelProjectCreationError,
} from "./vercel_errors";

describe("getVercelDeploymentError", () => {
  it.each([
    [401, DyadErrorKind.Auth, "Reconnect Vercel"],
    [403, DyadErrorKind.Auth, "access to this project"],
    [404, DyadErrorKind.NotFound, "Reconnect an existing project"],
    [400, DyadErrorKind.Precondition, "Vercel GitHub integration has access"],
    [422, DyadErrorKind.Precondition, "repository and branch exist"],
    [429, DyadErrorKind.RateLimited, "rate limit"],
    [500, DyadErrorKind.External, "retry in a moment"],
  ])("classifies HTTP %s with recovery guidance", (status, kind, guidance) => {
    const error = new SDKError("Raw provider error", {
      response: new Response(null, { status }),
      request: new Request("https://api.vercel.com/v13/deployments"),
      body: '{"error":{"message":"private-project-details"}}',
    });
    const result = getVercelDeploymentError(error);
    expect(result).toMatchObject({
      kind,
      message: expect.stringContaining(guidance),
    });
    expect(result.message).not.toContain("private-project-details");
  });

  it("preserves unexpected failures and existing classifications", () => {
    for (const error of [
      new Error("Unexpected bug"),
      new DyadError("Missing token", DyadErrorKind.Auth),
    ]) {
      expect(getVercelDeploymentError(error)).toBe(error);
    }
  });
});

describe("getVercelProjectCreationError", () => {
  it.each([200, 400, 403, 500])(
    "explains an unreadable HTTP %s response without exposing project secrets",
    (status) => {
      const body = JSON.stringify({ secret: "private-environment-value" });
      const error = new ResponseValidationError("Response validation failed", {
        response: new Response(body, { status }),
        request: new Request("https://api.vercel.com/v10/projects"),
        body,
        cause: undefined,
        rawValue: JSON.parse(body),
        rawMessage: "Response validation failed",
      });

      const result = getVercelProjectCreationError(error);

      expect(result).toBeInstanceOf(DyadError);
      expect(result.message).toContain("couldn't read Vercel's response");
      expect(result.message).toContain(`HTTP ${status}`);
      if (status === 200) {
        expect(result.message).toContain("may already have been created");
        expect(result.message).toContain('"Connect to existing project"');
      } else {
        expect(result.message).not.toContain("may already have been created");
      }
      expect(result.message).not.toContain("private-");
      expect(result.message).not.toContain("Response validation failed");
    },
  );

  it.each(["body", "rawValue"])(
    "shows Vercel's actual error message from %s",
    (source) => {
      const payload = {
        error: {
          code: "forbidden",
          message:
            "You must install the GitHub integration before creating a project.",
        },
        secret: "private-environment-value",
      };
      const error = new ResponseValidationError("Response validation failed", {
        response: new Response(null, { status: 403 }),
        request: new Request("https://api.vercel.com/v10/projects"),
        body: source === "body" ? JSON.stringify(payload) : "not JSON",
        rawValue: source === "rawValue" ? payload : undefined,
        rawMessage: "Response validation failed",
        cause: new Error("SDK schema mismatch"),
      });

      expect(getVercelProjectCreationError(error).message).toBe(
        `Vercel project setup failed (HTTP 403): ${payload.error.message}`,
      );
    },
  );

  it("shows the validation cause when a successful response fails SDK validation", () => {
    const error = new ResponseValidationError("Response validation failed", {
      response: new Response(null, { status: 200 }),
      request: new Request("https://api.vercel.com/v10/projects"),
      body: JSON.stringify({ secret: "private-environment-value" }),
      rawValue: {},
      rawMessage: "Response validation failed",
      cause: new Error("Invalid value for framework: expected a string"),
    });

    const message = getVercelProjectCreationError(error).message;
    expect(message).toContain(
      "Vercel project setup failed (HTTP 200): Invalid value for framework: expected a string",
    );
    expect(message).toContain("may already have been created");
    expect(message).toContain('"Connect to existing project"');
  });

  it.each([400, 403, 409, 500])(
    "extracts normal HTTP %s API errors without displaying the SDK's raw body",
    (status) => {
      const body = JSON.stringify({
        error: { message: "The project could not be created." },
        secret: "private-environment-value",
      });
      const error = new SDKError("API error occurred", {
        response: new Response(body, { status }),
        request: new Request("https://api.vercel.com/v10/projects"),
        body,
      });

      expect(getVercelProjectCreationError(error).message).toBe(
        `Vercel project setup failed (HTTP ${status}): The project could not be created.`,
      );
    },
  );

  it("keeps the HTTP status when a normal API error has a non-JSON body", () => {
    const error = new SDKError("API error occurred", {
      response: new Response(null, { status: 502 }),
      request: new Request("https://api.vercel.com/v10/projects"),
      body: "<html>private-proxy-details</html>",
    });
    const message = getVercelProjectCreationError(error).message;
    expect(message).toContain("HTTP 502");
    expect(message).not.toContain("private-proxy-details");
  });

  it.each([
    [400, DyadErrorKind.Validation],
    [401, DyadErrorKind.Auth],
    [402, DyadErrorKind.Precondition],
    [403, DyadErrorKind.Auth],
    [404, DyadErrorKind.NotFound],
    [409, DyadErrorKind.Conflict],
    [410, DyadErrorKind.NotFound],
    [422, DyadErrorKind.Validation],
    [428, DyadErrorKind.Precondition],
    [429, DyadErrorKind.RateLimited],
    [500, DyadErrorKind.External],
  ] as const)("classifies HTTP %s as %s", (status, kind) => {
    const error = new SDKError("API error occurred", {
      response: new Response(null, { status }),
      request: new Request("https://api.vercel.com/v10/projects"),
      body: "{}",
    });
    expect(getVercelProjectCreationError(error)).toHaveProperty("kind", kind);
  });

  it("preserves real Zod validation details alongside recovery guidance", () => {
    const parsed = z
      .object({
        resourceConfig: z.object({
          buildMachineType: z.enum(["enhanced", "turbo"]),
        }),
      })
      .safeParse({ resourceConfig: { buildMachineType: "basic" } });
    if (parsed.success)
      throw new Error("Expected the old SDK schema to reject basic");
    const error = new ResponseValidationError("Response validation failed", {
      response: new Response(null, { status: 200 }),
      request: new Request("https://api.vercel.com/v10/projects"),
      body: "{}",
      rawValue: {},
      rawMessage: "Response validation failed",
      cause: parsed.error,
    });
    const result = getVercelProjectCreationError(error);
    expect(result.message).toContain('"basic"');
    expect(result.message).toContain("buildMachineType");
    expect(result.message).toContain('"Connect to existing project"');
    expect(result).toHaveProperty("kind", DyadErrorKind.External);
  });

  it("preserves other errors and their classifications", () => {
    for (const error of [
      new Error("Project name is already in use."),
      new DyadError("Not authenticated with Vercel.", DyadErrorKind.Auth),
    ]) {
      expect(getVercelProjectCreationError(error)).toBe(error);
    }
  });

  it("provides a fallback for unknown failures", () => {
    expect(getVercelProjectCreationError(null).message).toBe(
      "Failed to create Vercel project.",
    );
  });
});
