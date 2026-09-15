import { expect, it } from "vitest";
import { restoredClaudeHistory } from "./history";
it("bounds restored context and labels omitted history", () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    role: "user",
    content: "message-" + index + ":" + "x".repeat(10000),
  }));
  const result = restoredClaudeHistory(messages);
  expect(result).not.toContain("message-0:");
  expect(result).toContain("message-19:");
  expect(result).toContain("older context may be omitted");
  expect(result).toContain("[message truncated]");
  expect(result.length).toBeLessThan(65000);
  expect(restoredClaudeHistory([])).toBe("");
});
