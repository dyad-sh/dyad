import { describe, expect, it } from "vitest";

import { classifyMcpFailure } from "@/ipc/handlers/mcp_handlers";

/**
 * The transport surfaces an HTTP 401 as an Error whose message is
 * "Unauthorized", with no status code attached, so this classification is
 * string matching and will rot silently if the wording changes.
 *
 * It matters because "needs signing in" is the only one of these failures the
 * user can act on: before it was separated out, a server needing auth logged a
 * stack on every poll and showed up in settings as simply having no tools.
 */
describe("MCP failure classification", () => {
  it("recognises an authentication failure", () => {
    for (const message of [
      "Unauthorized",
      "Error POSTing to endpoint (HTTP 401): Unauthorized",
      "Request failed with status 403",
      "Forbidden",
    ]) {
      expect(
        classifyMcpFailure(new Error(message)).reason,
        `"${message}" should read as an auth failure`,
      ).toBe("unauthorized");
    }
  });

  it("recognises a server it cannot reach", () => {
    for (const message of [
      "fetch failed",
      "connect ECONNREFUSED 127.0.0.1:9000",
      "getaddrinfo ENOTFOUND example.invalid",
      "The operation timed out",
    ]) {
      expect(
        classifyMcpFailure(new Error(message)).reason,
        `"${message}" should read as unreachable`,
      ).toBe("unreachable");
    }
  });

  it("does not guess at anything else", () => {
    // An unknown failure keeps its error-level log and full stack, which is
    // the behaviour worth preserving for real bugs.
    expect(
      classifyMcpFailure(new Error("Tool returned invalid JSON")).reason,
    ).toBe("unknown");
    expect(classifyMcpFailure("something odd").reason).toBe("unknown");
  });

  it("keeps the original message for the caller", () => {
    expect(classifyMcpFailure(new Error("Unauthorized")).message).toBe(
      "Unauthorized",
    );
  });
});
