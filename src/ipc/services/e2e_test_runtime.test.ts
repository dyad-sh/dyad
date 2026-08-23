// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPnpmMinimumReleaseAgeSupportMock = vi.hoisted(() => vi.fn());
vi.mock("@/ipc/utils/socket_firewall", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/ipc/utils/socket_firewall")>();
  return {
    ...actual,
    getPnpmMinimumReleaseAgeSupport: getPnpmMinimumReleaseAgeSupportMock,
  };
});

import {
  buildE2eTestStartCommand,
  startE2eTestRuntime,
} from "./e2e_test_runtime";
import { runningApps } from "@/ipc/utils/process_manager";

function mockPnpmAvailable(available: boolean) {
  getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
    available,
    minimumReleaseAgeSupported: available,
  });
}

describe("buildE2eTestStartCommand", () => {
  beforeEach(() => {
    getPnpmMinimumReleaseAgeSupportMock.mockReset();
    mockPnpmAvailable(false);
  });

  it("starts npm without reinstalling dependencies", async () => {
    const command = await buildE2eTestStartCommand({
      workspacePath: path.resolve("app"),
      port: 45678,
    });
    expect(command.command).toBe("npm run dev -- --port 45678");
    expect(command.command).not.toContain("install");
    expect(command.env.PORT).toBe("45678");
  });

  it("supports an explicit port placeholder in custom commands", async () => {
    const command = await buildE2eTestStartCommand({
      workspacePath: path.resolve("app"),
      port: 45678,
      installCommand: "custom-install",
      startCommand: "custom-server --listen {port}",
    });
    expect(command.command).toBe("custom-server --listen 45678");
  });

  it("runs a custom command verbatim instead of appending a port flag", async () => {
    const command = await buildE2eTestStartCommand({
      workspacePath: path.resolve("app"),
      port: 45678,
      installCommand: "pip install -r requirements.txt",
      startCommand: "python server.py",
    });
    expect(command.command).toBe("python server.py");
    expect(command.env.PORT).toBe("45678");
  });

  it("ignores a start command that has no matching install command", async () => {
    // `getCommand` in app_runtime_service only treats an app as custom when
    // both commands are set; the sandbox must agree with the normal preview.
    const command = await buildE2eTestStartCommand({
      workspacePath: path.resolve("app"),
      port: 45678,
      startCommand: "python server.py",
    });
    expect(command.command).toBe("npm run dev -- --port 45678");
  });

  it("uses pnpm when the sandbox contains its lockfile", async () => {
    mockPnpmAvailable(true);
    const root = fs.mkdtempSync(path.join(process.cwd(), ".e2e-runtime-test-"));
    try {
      fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "");
      const command = await buildE2eTestStartCommand({
        workspacePath: root,
        port: 45678,
      });
      expect(command.command).toContain("pnpm");
      expect(command.command).not.toContain("install");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to npm when the lockfile wants pnpm but pnpm is unusable", async () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), ".e2e-runtime-test-"));
    try {
      fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "");
      const command = await buildE2eTestStartCommand({
        workspacePath: root,
        port: 45678,
      });
      expect(command.command).toBe("npm run dev -- --port 45678");
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
        installCommand: "true",
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
