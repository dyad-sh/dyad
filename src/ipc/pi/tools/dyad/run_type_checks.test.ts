// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const runTypeScriptCheck = vi.hoisted(() => vi.fn());

vi.mock("@/ipc/processors/tsc", () => ({
  runTypeScriptCheck,
  getTypeCheckPreconditionGuidance: vi.fn(),
  getTypeCheckPreconditionKind: vi.fn(),
}));
vi.mock("@/ipc/utils/safe_sender", () => ({ safeSend: vi.fn() }));

import type { AgentContext } from "./types";
import { runTypeChecksTool } from "./run_type_checks";

describe("runTypeChecksTool", () => {
  beforeEach(() => {
    runTypeScriptCheck.mockReset();
    runTypeScriptCheck.mockResolvedValue({ problems: [], outcome: "passed" });
  });

  it("passes the invocation abort signal to the TypeScript process", async () => {
    const controller = new AbortController();
    const context = {
      appPath: "/tmp/app",
      appId: 1,
      event: { sender: {} },
      abortSignal: controller.signal,
      onXmlStream: vi.fn(),
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;

    await runTypeChecksTool.execute({}, context);

    expect(runTypeScriptCheck).toHaveBeenCalledWith({
      appPath: "/tmp/app",
      signal: controller.signal,
    });
  });
});
