// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  startTestCaseLifecycleServer,
  TEST_CASE_ENDPOINT_ENV,
  TEST_CASE_TOKEN_ENV,
} from "./test_case_lifecycle_server";

vi.mock("electron-log/main", () => ({
  default: { scope: () => ({ info: vi.fn() }) },
}));

import { ensurePreviewShim } from "../utils/playwright_bootstrap";

const servers: Awaited<ReturnType<typeof startTestCaseLifecycleServer>>[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

async function setup() {
  const lifecycle = {
    beforeEach: vi.fn(async () => ({ DYAD_TEST_USER_EMAIL: "new@dyad.test" })),
    afterEach: vi.fn(async () => {}),
  };
  const server = await startTestCaseLifecycleServer(lifecycle);
  servers.push(server);
  const request = (route: string, headers: Record<string, string> = {}) =>
    fetch(`${server.env[TEST_CASE_ENDPOINT_ENV]}/${route}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.env[TEST_CASE_TOKEN_ENV]}`,
        ...headers,
      },
    });
  return { lifecycle, server, request };
}

describe("test case lifecycle bridge", () => {
  it("requires the run token and rejects browser-origin requests", async () => {
    const { lifecycle, request } = await setup();
    expect(
      (await request("before/one", { Authorization: "Bearer wrong" })).status,
    ).toBe(403);
    expect(
      (await request("before/one", { Origin: "https://app.example" })).status,
    ).toBe(403);
    expect((await request("invalid/one")).status).toBe(404);
    expect(lifecycle.beforeEach).not.toHaveBeenCalled();
  });

  it("cleans up an abandoned attempt and ignores its stale teardown", async () => {
    const { lifecycle, request } = await setup();
    expect(await (await request("before/one")).json()).toEqual({
      DYAD_TEST_USER_EMAIL: "new@dyad.test",
    });
    await request("before/two");
    expect(lifecycle.afterEach).toHaveBeenCalledTimes(1);
    await request("after/one");
    expect(lifecycle.afterEach).toHaveBeenCalledTimes(1);
    await request("after/two");
    expect(lifecycle.afterEach).toHaveBeenCalledTimes(2);
  });

  it("blocks later cases after failed cleanup and retries cleanup on close", async () => {
    const { lifecycle, server, request } = await setup();
    await request("before/one");
    lifecycle.afterEach.mockRejectedValueOnce(new Error("cleanup unavailable"));
    expect((await request("after/one")).status).toBe(500);
    expect((await request("before/two")).status).toBe(500);
    expect(lifecycle.beforeEach).toHaveBeenCalledTimes(1);
    expect(server.failure?.message).toBe("cleanup unavailable");
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    expect(lifecycle.afterEach).toHaveBeenCalledTimes(2);
  });

  it("drains in-flight provisioning before cleaning up a killed worker", async () => {
    const { lifecycle, server, request } = await setup();
    let finish!: (value: { DYAD_TEST_USER_EMAIL: string }) => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    lifecycle.beforeEach.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const pendingRequest = request("before/one").catch(() => undefined);
    await startedPromise;
    const closed = server.close();
    expect(lifecycle.afterEach).not.toHaveBeenCalled();
    finish({ DYAD_TEST_USER_EMAIL: "created@dyad.test" });
    await closed;
    await pendingRequest;
    servers.splice(servers.indexOf(server), 1);
    expect(lifecycle.afterEach).toHaveBeenCalledTimes(1);
  });

  it("runs the generated auto fixture around cases in different files and retries", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "dyad-case-fixture-"),
    );
    directories.push(directory);
    const logFile = path.join(directory, "events.jsonl");
    const record = (event: string) =>
      fs.appendFileSync(logFile, JSON.stringify(event) + "\n");
    let id = 0;
    const server = await startTestCaseLifecycleServer({
      beforeEach: async () => {
        id += 1;
        record(`create-${id}`);
        return {
          DYAD_TEST_USER_EMAIL: String(id),
          DYAD_TEST_USER_PASSWORD: `password-${id}`,
        };
      },
      afterEach: async () => {
        record(`cleanup-${id}`);
      },
    });
    servers.push(server);
    fs.symlinkSync(
      path.resolve("node_modules"),
      path.join(directory, "node_modules"),
      "junction",
    );
    fs.mkdirSync(path.join(directory, "e2e-tests"));
    ensurePreviewShim(directory);
    fs.writeFileSync(
      path.join(directory, "playwright.config.cjs"),
      `module.exports = { testDir: './e2e-tests', workers: 1, retries: 1 };`,
    );
    const helpers = `
import { test, expect } from '@playwright/test';
import { appendFileSync } from 'node:fs';
const record = (phase) => appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(phase + '-' + process.env.DYAD_TEST_USER_EMAIL) + '\\n');
test.beforeEach(() => {
  expect(process.env.DYAD_TEST_USER_PASSWORD).toBe('password-' + process.env.DYAD_TEST_USER_EMAIL);
  record('before');
});
test.afterEach(() => record('after'));
`;
    fs.writeFileSync(
      path.join(directory, "e2e-tests/a.spec.ts"),
      `${helpers}
test('first', () => record('test'));
test('retry', ({}, info) => { record('test'); expect(info.retry).toBe(1); });
`,
    );
    fs.writeFileSync(
      path.join(directory, "e2e-tests/b.spec.ts"),
      `${helpers}
test('next file', () => record('test'));
`,
    );
    const require = createRequire(import.meta.url);
    const cli = path.join(
      path.dirname(require.resolve("@playwright/test/package.json")),
      "cli.js",
    );
    const result = await new Promise<{ code: number | null; output: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [cli, "test", "--reporter=line"],
          {
            cwd: directory,
            env: { ...process.env, ...server.env, CI: "true" },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
          output += String(chunk);
        });
        child.once("error", reject);
        child.once("close", (code) => resolve({ code, output }));
      },
    );
    expect(result.code, result.output).toBe(0);
    expect(server.failure).toBeUndefined();
    expect(id).toBe(4);
    expect(
      fs
        .readFileSync(logFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual(
      [1, 2, 3, 4].flatMap((caseId) =>
        ["create", "before", "test", "after", "cleanup"].map(
          (phase) => `${phase}-${caseId}`,
        ),
      ),
    );
  }, 30_000);
});
