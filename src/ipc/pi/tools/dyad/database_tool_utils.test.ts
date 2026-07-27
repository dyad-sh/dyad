// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { boundDatabaseToolResult, runAbortable } from "./database_tool_utils";

describe("database tool utilities", () => {
  it("bounds large UTF-8 results and includes a truncation notice", () => {
    const result = boundDatabaseToolResult("\u4e2d".repeat(30_000));

    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(result).toContain("[Database result truncated.");
    expect(result).not.toContain("\uFFFD");
  });

  it("does not start an operation when already aborted", async () => {
    const controller = new AbortController();
    const operation = vi.fn(async () => "result");
    controller.abort();

    await expect(
      runAbortable(operation, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(operation).not.toHaveBeenCalled();
  });

  it("settles promptly when an in-flight operation is aborted", async () => {
    const controller = new AbortController();
    const operation = () => new Promise<string>(() => {});
    const result = runAbortable(operation, controller.signal);

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
});
