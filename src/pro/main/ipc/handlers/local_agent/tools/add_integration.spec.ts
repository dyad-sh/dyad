import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exec } from "dugite";
import type { AgentContext } from "./types";

const mocks = vi.hoisted(() => ({
  request: vi.fn(() => "request-id"),
  park: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock("@/user_input/main", () => ({
  userInputRegistry: {
    request: mocks.request,
    park: mocks.park,
  },
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({ log: vi.fn(), warn: mocks.loggerWarn }),
  },
}));

import { addIntegrationTool } from "./add_integration";

describe("addIntegrationTool Git-visible mutation tracking", () => {
  let appPath: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "add-integration-track-"),
    );
    expect((await exec(["init"], appPath)).exitCode).toBe(0);
  });

  afterEach(async () => {
    if (appPath) {
      await fs.rm(appPath, { recursive: true, force: true });
      appPath = undefined;
    }
  });

  it("reports actual Git-visible files created during integration setup", async () => {
    mocks.park.mockImplementation(async () => {
      await fs.writeFile(
        path.join(appPath!, "nitro.config.ts"),
        "export {};\n",
      );
      return { kind: "integration", provider: "neon", completed: true };
    });

    const result = await addIntegrationTool.execute({}, {
      appPath,
    } as AgentContext);

    expect(result).toContain(
      "Git-visible workspace files changed during setup",
    );
    expect(
      addIntegrationTool.shouldTrackFileMutation?.(
        {},
        result,
        {} as AgentContext,
      ),
    ).toBe(true);
  });

  it("does not infer a file mutation from provider completion alone", async () => {
    mocks.park.mockResolvedValue({
      kind: "integration",
      provider: "neon",
      completed: true,
    });

    const result = await addIntegrationTool.execute({}, {
      appPath,
    } as AgentContext);

    expect(result).not.toContain("Git-visible workspace files changed");
    expect(
      addIntegrationTool.shouldTrackFileMutation?.(
        {},
        result,
        {} as AgentContext,
      ),
    ).toBe(false);
  });

  it("conservatively tracks a file mutation when fingerprinting is uncertain", async () => {
    const abortController = new AbortController();
    abortController.abort();
    mocks.park.mockResolvedValue({
      kind: "integration",
      provider: "neon",
      completed: true,
    });

    const result = await addIntegrationTool.execute({}, {
      appPath,
      abortSignal: abortController.signal,
    } as AgentContext);

    expect(result).toContain(
      "Git-visible workspace file state could not be determined during setup",
    );
    expect(
      addIntegrationTool.shouldTrackFileMutation?.(
        {},
        result,
        {} as AgentContext,
      ),
    ).toBe(true);
  });
});
