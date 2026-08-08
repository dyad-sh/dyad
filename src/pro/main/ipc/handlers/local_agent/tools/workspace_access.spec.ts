import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentContext } from "./types";
import { createDirectoryTool } from "./create_directory";
import { runTerminalCommandTool } from "./run_terminal_command";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.promises.rm(root, { recursive: true, force: true })),
  );
});

async function workspaceContext(): Promise<AgentContext> {
  const appPath = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "agent-workspace-access-"),
  );
  temporaryRoots.push(appPath);
  return {
    appId: 1,
    appPath,
  } as AgentContext;
}

describe("workspace access tools", () => {
  it("creates nested directories inside the active workspace", async () => {
    const ctx = await workspaceContext();

    await createDirectoryTool.execute({ path: "notes/daily" }, ctx);

    expect(
      fs.statSync(path.join(ctx.appPath, "notes", "daily")).isDirectory(),
    ).toBe(true);
  });

  it("does not let directory creation escape the active workspace", async () => {
    const ctx = await workspaceContext();

    await expect(
      createDirectoryTool.execute({ path: "../outside" }, ctx),
    ).rejects.toThrow("would escape the base directory");
  });

  it("runs terminal commands with the workspace as the working directory", async () => {
    const ctx = await workspaceContext();
    const executable = JSON.stringify(process.execPath);

    const output = await runTerminalCommandTool.execute(
      {
        command: `${executable} -e "process.stdout.write(process.cwd())"`,
        timeoutSeconds: 10,
      },
      ctx,
    );

    expect(output).toContain(ctx.appPath);
  });
});
