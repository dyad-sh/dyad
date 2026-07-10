import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { AgentContext } from "./types";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  default: { spawn: mocks.spawn },
  spawn: mocks.spawn,
}));
vi.mock("electron-log", () => ({
  default: {
    scope: () => ({ warn: vi.fn() }),
  },
}));
vi.mock("@/ipc/utils/ripgrep_utils", () => ({
  getRgExecutablePath: () => "rg",
  MAX_FILE_SEARCH_SIZE: 1024 * 1024,
  RIPGREP_EXCLUDED_GLOBS: ["!node_modules/**", "!.git/**", "!.next/**"],
}));

import { grepTool } from "./grep";

class FakeRipgrepProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => true);
}

function matchEvent(path: string) {
  return JSON.stringify({
    type: "match",
    data: {
      path: { text: path },
      lines: { text: "needle\n" },
      line_number: 1,
    },
  });
}

describe("grepTool stream handling", () => {
  let child: FakeRipgrepProcess;

  beforeEach(() => {
    child = new FakeRipgrepProcess();
    mocks.spawn.mockReset();
    mocks.spawn.mockReturnValue(child);
  });

  it("ignores a process error emitted after an intentional early kill", async () => {
    const context = {
      appPath: "/tmp/test-app",
      referencedApps: new Map(),
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;
    const search = grepTool.execute({ query: "needle", limit: 1 }, context);

    child.stdout.emit(
      "data",
      Buffer.from(`${matchEvent("one.ts")}\n${matchEvent("two.ts")}\n`),
    );
    expect(child.kill).toHaveBeenCalledOnce();
    child.emit("error", new Error("kill race"));
    child.emit("close", null);

    await expect(search).resolves.toContain("one.ts:1: needle");
  });
});
