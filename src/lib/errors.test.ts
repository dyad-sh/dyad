import { describe, expect, it } from "vitest";
import { getErrorMessage } from "./errors";

describe("getErrorMessage", () => {
  it("strips the Electron IPC wrapper from Error messages", () => {
    const error = new Error(
      "Error invoking remote method 'neon:set-active-branch': Error: Preview branches are used for historical rollback.",
    );

    expect(getErrorMessage(error)).toBe(
      "Preview branches are used for historical rollback.",
    );
  });

  it("prefers a message field on plain objects", () => {
    expect(getErrorMessage({ message: "Neon API key expired" })).toBe(
      "Neon API key expired",
    );
  });

  it("serializes plain objects instead of returning [object Object]", () => {
    expect(getErrorMessage({ code: "EACCES", retryable: false })).toBe(
      '{"code":"EACCES","retryable":false}',
    );
  });
});
