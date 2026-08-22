// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildE2eTestStartCommand,
  startE2eTestRuntime,
} from "./e2e_test_runtime";
import { runningApps } from "@/ipc/utils/process_manager";

describe("buildE2eTestStartCommand", () => {
  it("starts npm without reinstalling dependencies", () => {
    const command = buildE2eTestStartCommand({
      workspacePath: path.resolve("app"),
      port: 45678,
    });
    expect(command.command).toBe("npm run dev -- --port 45678");
    expect(command.command).not.toContain("install");
    expect(command.env.PORT).toBe("45678");
  });

  it("supports an explicit port placeholder in custom commands", () => {
    const command = buildE2eTestStartCommand({
      workspacePath: path.resolve("app"),
      port: 45678,
      startCommand: "custom-server --listen {port}",
    });
    expect(command.command).toBe("custom-server --listen 45678");
  });

  it("uses pnpm when the sandbox contains its lockfile", () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), ".e2e-runtime-test-"));
    try {
      fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "");
      const command = buildE2eTestStartCommand({
        workspacePath: root,
        port: 45678,
      });
      expect(command.command).toContain("pnpm");
      expect(command.command).not.toContain("install");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("starts and stops a server without registering the normal app runtime", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-e2e-runtime-"));
    fs.writeFileSync(
      path.join(root, "server.mjs"),
      `import http from "node:http";
const port = Number(process.argv[2]);
http.createServer((_request, response) => response.end("sandbox"))
  .listen(port, "127.0.0.1");
`,
    );
    let runtime: Awaited<ReturnType<typeof startE2eTestRuntime>> | undefined;
    const registeredRuntimeCount = runningApps.size;
    try {
      runtime = await startE2eTestRuntime({
        workspacePath: root,
        startCommand: `"${process.execPath}" server.mjs {port}`,
      });
      await expect(
        fetch(runtime.baseUrl).then((response) => response.text()),
      ).resolves.toBe("sandbox");
      expect(runningApps.size).toBe(registeredRuntimeCount);
    } finally {
      await runtime?.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
