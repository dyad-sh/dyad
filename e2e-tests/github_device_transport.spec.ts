import { expect, test as runtimeTest, _electron } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test, type PageObject } from "./helpers/test_helper";
import { FAKE_LLM_BASE_PORT } from "./helpers/test-ports";
import type { ConnectionFlowState } from "../src/connection_flow/state";

async function invoke(po: PageObject, channel: string, input?: unknown) {
  return po.page.evaluate(
    ({ channel, input }) =>
      (window as any).electron.ipcRenderer.invoke(channel, input),
    { channel, input },
  );
}

async function state(po: PageObject): Promise<ConnectionFlowState> {
  return (await invoke(po, "connection-flow:get-states")).github;
}

// Runs without the full app/native modules, so the original 43.0.0 runtime can
// qualify this exact production transport before a full runtime upgrade.
runtimeTest(
  "reads compressed GitHub bodies in a selectable Electron runtime",
  async ({ request }, testInfo) => {
    const base = `http://localhost:${FAKE_LLM_BASE_PORT + testInfo.parallelIndex}`;
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "dyad-github-transport-"),
    );
    const modulePath = path.join(directory, "github-fetch.cjs");
    await build({
      entryPoints: ["src/ipc/utils/github_fetch.ts"],
      outfile: modulePath,
      bundle: true,
      platform: "node",
      format: "cjs",
    });
    const entry = path.join(directory, "main.cjs");
    await writeFile(
      entry,
      'globalThis.fetchGitHub = require("./github-fetch.cjs").default; require("electron").app.whenReady();',
    );
    const application = await _electron.launch({
      args: [entry],
      executablePath: process.env.DYAD_E2E_GITHUB_ELECTRON_EXECUTABLE,
    });
    try {
      await request.post(`${base}/github/api/test/device-flow-config`, {
        data: { mode: "gzip-chunked", outcome: "success" },
      });
      const result = await application.evaluate(
        async (_, { base }) => {
          const fetchGitHub = (globalThis as any).fetchGitHub as typeof fetch;
          const deviceResponse = await fetchGitHub(
            `${base}/github/login/device/code`,
            { method: "POST" },
          );
          const encoding = deviceResponse.headers.get("content-encoding");
          const transfer = deviceResponse.headers.get("transfer-encoding");
          const device = await deviceResponse.json();
          const polls = [];
          for (let i = 0; i < 3; i++) {
            const response = await fetchGitHub(
              `${base}/github/login/oauth/access_token`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ device_code: device.device_code }),
              },
            );
            polls.push({
              status: response.status,
              body: await response.json(),
            });
          }
          return {
            electron: process.versions.electron,
            encoding,
            transfer,
            device,
            polls,
          };
        },
        { base },
      );
      console.log(`GitHub transport passed in Electron ${result.electron}`);
      expect(result).toMatchObject({
        encoding: "gzip",
        transfer: "chunked",
        device: { user_code: "FAKE-CODE" },
        polls: [
          { status: 400, body: { error: "authorization_pending" } },
          { status: 400, body: { error: "authorization_pending" } },
          { status: 200, body: { access_token: "fake_access_token_12345" } },
        ],
      });
    } finally {
      await application.close();
      await rm(directory, { recursive: true, force: true });
      await request.post(`${base}/github/api/test/device-flow-config`, {
        data: { mode: "plain", outcome: "success" },
      });
    }
  },
);

test("consumes gzip/chunked GitHub device and token bodies through real Electron IPC", async ({
  po,
}) => {
  await po.setUp();
  const configure = async (outcome: string, mode = "gzip-chunked") => {
    const response = await po.page.request.post(
      `http://localhost:${po.fakeLlmPort}/github/api/test/device-flow-config`,
      { data: { mode, outcome } },
    );
    expect(response.ok()).toBe(true);
  };
  const start = async () => {
    const current = await state(po);
    return invoke(po, "connection-flow:start", {
      provider: "github",
      expectedRevision: current.revision,
    });
  };
  try {
    await configure("pending");
    const first = await start();
    await expect
      .poll(() => state(po))
      .toMatchObject({
        status: "awaiting-return",
        userCode: "FAKE-CODE",
        verificationUri: "https://github.com/login/device",
      });
    await invoke(po, "connection-flow:cancel", {
      provider: "github",
      invocationRef: first.invocationRef,
    });
    expect(await state(po)).toMatchObject({ status: "cancelled" });

    await configure("access_denied");
    await start();
    await expect
      .poll(() => state(po))
      .toMatchObject({
        status: "failed",
        reason: "user_cancelled",
        message: "Authorization denied by user.",
      });

    // A new attempt must survive two compressed pending bodies and then read
    // the entire compressed token body before persisting the credential.
    await configure("success");
    await start();
    await expect
      .poll(() => state(po), { timeout: 15_000 })
      .toMatchObject({
        status: "connected",
      });
    expect(po.settings.recordSettings()).toMatchObject({
      githubAccessToken: { value: "fake_access_token_12345" },
    });
    const repos = await invoke(po, "github:list-repos");
    expect(repos.length).toBeGreaterThan(0);
  } finally {
    await configure("success", "plain");
  }
});
