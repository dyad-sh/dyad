import { describe, expect, it, vi } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

vi.mock("../main/settings", () => ({
  readSettings: vi.fn(),
  writeSettings: vi.fn(),
}));

vi.mock("@neondatabase/api-client", () => ({
  Api: class {},
  createApiClient: vi.fn(),
}));

const { getNeonErrorMessage } = await import("./neon_management_client");

describe("getNeonErrorMessage", () => {
  it("combines the top-level and detailed Neon messages", () => {
    expect(
      getNeonErrorMessage({
        message: "Request failed",
        response: {
          data: {
            message: "Rate limit exceeded",
          },
        },
      }),
    ).toBe("Request failed Rate limit exceeded");
  });

  it("returns a plain string error unchanged", () => {
    expect(getNeonErrorMessage("Connection reset")).toBe("Connection reset");
  });

  it("falls back to a friendly message for nullish errors", () => {
    expect(getNeonErrorMessage(undefined)).toBe("Unknown Neon error");
  });
});
