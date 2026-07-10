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
      { length: 25 },
      (_, index) => `${index}:${"x".repeat(20_000)}`,
    );

    scriptConsole.log(...args);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("console-log");
    expect(messages[0].args[0]).toContain("[console value truncated]");
    expect(messages[0].args.at(-1)).toMatch(/arguments omitted\]$/);
    expect(
      messages[0].args.every(
        (arg) => Buffer.byteLength(arg, "utf8") <= 8 * 1024,
      ),
    ).toBe(true);
    expect(
      messages[0].args.reduce(
        (total, arg) => total + Buffer.byteLength(arg, "utf8"),
        0,
      ),
    ).toBeLessThanOrEqual(64 * 1024);
    expect(originalLog).toHaveBeenCalledWith(...args);
  });

  it("preserves up to 20 small arguments before adding an omission marker", () => {
    const { messages, scriptConsole } = loadConsoleInterceptor();
    const args = Array.from({ length: 25 }, (_, index) => `arg-${index}`);

    scriptConsole.log(...args);

    expect(messages[0].args.slice(0, 20)).toEqual(args.slice(0, 20));
    expect(messages[0].args.at(-1)).toBe("… [5 arguments omitted]");
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

  it("preserves up to 50 object keys before marking additional keys", () => {
    const { messages, scriptConsole } = loadConsoleInterceptor();
    const wideObject = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [`key-${index}`, index]),
    );

    scriptConsole.log(wideObject);

    const serialized = JSON.parse(messages[0].args[0]);
    expect(serialized["key-49"]).toBe(49);
    expect(serialized["key-50"]).toBeUndefined();
    expect(serialized.__dyad_truncated__).toBe("Additional keys omitted");
  });

  it("honors toJSON while retaining the output byte limit", () => {
    const { messages, scriptConsole } = loadConsoleInterceptor();
    const date = new Date("2026-07-10T00:00:00.000Z");
    const custom = {
      toJSON: () => ({ value: "x".repeat(20_000) }),
    };

    scriptConsole.log(date, custom);

    expect(JSON.parse(messages[0].args[0])).toBe(date.toISOString());
    expect(messages[0].args[1]).toContain("[console value truncated]");
    expect(Buffer.byteLength(messages[0].args[1], "utf8")).toBeLessThanOrEqual(
      8 * 1024,
    );
  });

  it("applies the depth limit to chained toJSON results", () => {
    const { messages, scriptConsole } = loadConsoleInterceptor();
    const createToJsonChain = (remainingDepth: number): unknown => ({
      toJSON: () =>
        remainingDepth === 0 ? "leaf" : createToJsonChain(remainingDepth - 1),
    });

    scriptConsole.log(createToJsonChain(20));

    expect(messages[0].args[0]).toContain("[Maximum log depth reached]");
  });

  it("preserves empty object keys without skipping later properties", () => {
    const { messages, scriptConsole } = loadConsoleInterceptor();

    scriptConsole.log({ "": "empty-key value", after: "later value" });

    expect(JSON.parse(messages[0].args[0])).toEqual({
      "": "empty-key value",
      after: "later value",
    });
  });

  it("marks arrays and objects when their inner byte budget is exhausted", () => {
    const { messages, scriptConsole } = loadConsoleInterceptor();
    const hugeValue = "x".repeat(20_000);

    scriptConsole.log([hugeValue, hugeValue, "omitted array value"], {
      first: hugeValue,
      second: hugeValue,
      third: "omitted object value",
    });

    expect(messages[0].args[0]).toContain("[console value truncated]");
    expect(messages[0].args[1]).toContain("[console value truncated]");
  });

  it("stops reading nested values when the argument byte budget is exhausted", () => {
    const { messages, scriptConsole } = loadConsoleInterceptor();
    let getterReads = 0;
    const nested: Record<string, unknown> = {};

    for (let outer = 0; outer < 20; outer++) {
      const child: Record<string, unknown> = {};
      for (let inner = 0; inner < 20; inner++) {
        Object.defineProperty(child, `value-${inner}`, {
          enumerable: true,
          get() {
            getterReads++;
            return "x".repeat(4 * 1024);
          },
        });
      }
      nested[`child-${outer}`] = child;
    }

    scriptConsole.log(nested);

    expect(getterReads).toBeLessThan(10);
    expect(Buffer.byteLength(messages[0].args[0], "utf8")).toBeLessThanOrEqual(
      8 * 1024,
    );
  });
});
