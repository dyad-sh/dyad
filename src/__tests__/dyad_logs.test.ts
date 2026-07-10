import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

interface PostedConsoleMessage {
  type: string;
  args: string[];
}

type ConsoleMethod = (...args: unknown[]) => void;

const DYAD_LOGS_SCRIPT = readFileSync(
  resolve(__dirname, "../../worker/dyad_logs.js"),
  "utf8",
);

function loadConsoleInterceptor() {
  const messages: PostedConsoleMessage[] = [];
  const originalLog = vi.fn<ConsoleMethod>();
  const scriptConsole: Record<
    "log" | "warn" | "error" | "info" | "debug",
    ConsoleMethod
  > = {
    log: originalLog,
    warn: vi.fn<ConsoleMethod>(),
    error: vi.fn<ConsoleMethod>(),
    info: vi.fn<ConsoleMethod>(),
    debug: vi.fn<ConsoleMethod>(),
  };

  runInNewContext(DYAD_LOGS_SCRIPT, {
    console: scriptConsole,
    window: {
      parent: {
        postMessage(message: PostedConsoleMessage) {
          messages.push(message);
        },
      },
    },
  });

  return { messages, originalLog, scriptConsole };
}

describe("dyad console interception", () => {
  it("bounds giant values and argument lists before posting to the parent", () => {
    const { messages, originalLog, scriptConsole } = loadConsoleInterceptor();
    const args = Array.from(
      { length: 20 },
      (_, index) => `${index}:${"x".repeat(20_000)}`,
    );

    scriptConsole.log(...args);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("console-log");
    expect(messages[0].args).toHaveLength(11);
    expect(messages[0].args[0]).toContain("[console value truncated]");
    expect(messages[0].args.at(-1)).toBe("… [10 arguments omitted]");
    expect(
      messages[0].args.every(
        (arg) => Buffer.byteLength(arg, "utf8") <= 8 * 1024,
      ),
    ).toBe(true);
    expect(originalLog).toHaveBeenCalledWith(...args);
  });

  it("bounds deep and circular object traversal", () => {
    const { messages, scriptConsole } = loadConsoleInterceptor();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    let deep: Record<string, unknown> = { value: "leaf" };
    for (let index = 0; index < 20; index++) {
      deep = { child: deep };
    }
    const hugeKey = `key-${"x".repeat(10_000)}`;

    scriptConsole.log(circular, deep, { [hugeKey]: "value" });

    expect(messages).toHaveLength(1);
    expect(messages[0].args[0]).toContain("[Circular]");
    expect(messages[0].args[1]).toContain("[Maximum log depth reached]");
    expect(messages[0].args[2]).toContain("[console value truncated]");
  });
});
