import { expect, it } from "vitest";
import { estimateTokens } from "@/ipc/utils/token_utils";
import {
  serializeShellResultForModel,
  SHELL_MODEL_RESULT_TOKEN_LIMIT,
} from "./shell_model_result";
const base = {
  executed: true,
  code: 0,
  status: "completed" as const,
  reason: "Allowed",
  truncated: false,
};
it.each(["x", '"\\\n\u0000'])(
  "caps escaped serialized results and preserves both output tails (%s)",
  (text) => {
    const result = {
      ...base,
      stdout: text.repeat(64000) + "STDOUT_TAIL",
      stderr: text.repeat(64000) + "STDERR_TAIL",
    };
    const serialized = serializeShellResultForModel(result);
    const bounded = JSON.parse(serialized);
    expect(estimateTokens(serialized)).toBeLessThanOrEqual(
      SHELL_MODEL_RESULT_TOKEN_LIMIT,
    );
    expect(bounded.stdout.endsWith("STDOUT_TAIL")).toBe(true);
    expect(bounded.stderr.endsWith("STDERR_TAIL")).toBe(true);
    expect(bounded.truncated).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.stdout.length).toBeGreaterThan(bounded.stdout.length);
  },
);
it("preserves small results and redistributes unused stderr space", () => {
  const small = { ...base, stdout: "ok", stderr: "" };
  expect(serializeShellResultForModel(small)).toBe(JSON.stringify(small));
  const large = { ...base, stdout: "x".repeat(128000), stderr: "warning" };
  const bounded = JSON.parse(serializeShellResultForModel(large));
  expect(bounded.stdout.length).toBeGreaterThan(70000);
  expect(bounded.stderr).toBe("warning");
});
it("counts oversized reason/note metadata in the complete result budget", () => {
  const serialized = serializeShellResultForModel({
    ...base,
    reason: "r".repeat(100000),
    note: "n".repeat(100000),
    stdout: "tail",
    stderr: "warning",
  });
  expect(estimateTokens(serialized)).toBeLessThanOrEqual(
    SHELL_MODEL_RESULT_TOKEN_LIMIT,
  );
  expect(JSON.parse(serialized).stdout).toBe("tail");
});
