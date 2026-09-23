// @vitest-environment node
//
// Proves the headless chat-flow harness can run an app's REAL dev server and
// pipe its output into the Local Agent's `read_logs` tool.
//
// Before this existed, in the app-builder benchmark:
//   restart_app -> "Machine app_run is not registered"
//   read_logs   -> "No logs found matching the specified filters."
// i.e. the agent built blind. This test asserts the three things that must
// hold instead:
//   (a) restart_app succeeds through the production app-run actor path;
//   (b) read_logs returns actual dev-server output;
//   (c) a page that throws at render shows up in read_logs.
//
// Gated: it installs the benchmark's Next.js template with pnpm and runs
// `next dev`, so it is far too heavy for the default unit run. Enable with
//   DYAD_DEV_SERVER_SMOKE=1 npx vitest run --project unit \
//     src/__tests__/headless_dev_server.smoke.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RUN = process.env.DYAD_DEV_SERVER_SMOKE === "1";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  if (process.env.DYAD_DEV_SERVER_SMOKE === "1") {
    // node-pty is Electron-ABI and posix_spawnp-fails under vitest; the
    // child_process fallback in pty_command_runner handles the `pnpm --version`
    // probe. Same setting the benchmark runner uses.
    process.env.DYAD_DISABLE_PTY = "1";
    // Keep app/proxy ports out of the benchmark's 7788/7789/3000/3210 and out
    // of the default 32100 band. Block 4 => app 40300+, proxy 41300+.
    process.env.DYAD_E2E_PORT_BLOCK_INDEX =
      process.env.APPBENCH_PORT_BLOCK ?? "4";
  }
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

// Required: production resolves the proxy worker relative to the packaged
// bundle, which under vitest points at a nonexistent src/worker/proxy_server.js.
vi.mock("@/ipc/utils/start_proxy_server", async () => {
  const { createHeadlessProxyModule } =
    await import("@/testing/headless_proxy_server");
  return createHeadlessProxyModule();
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { restartAppTool } from "@/pro/main/ipc/handlers/local_agent/tools/app_lifecycle";
import { readLogsTool } from "@/pro/main/ipc/handlers/local_agent/tools/read_logs";
import type { AgentContext } from "@/pro/main/ipc/handlers/local_agent/tools/types";

const TEMPLATE = path.resolve(
  __dirname,
  "..",
  "..",
  "benchmarks",
  "app-builder",
  "template",
  "nextjs",
);

const BOOM = "HEADLESS_SMOKE_BOOM";

(RUN ? describe : describe.skip)("headless dev server (smoke)", () => {
  let harness: ChatFlowHarness;
  let ctx: AgentContext;

  const readLogs = (args: Parameters<typeof readLogsTool.execute>[0] = {}) =>
    readLogsTool.execute(args, ctx) as Promise<string>;

  beforeAll(async () => {
    expect(fs.existsSync(TEMPLATE), `template missing: ${TEMPLATE}`).toBe(true);

    harness = await setupChatFlowHarness({
      electronMock: h,
      fixtureAppPath: TEMPLATE,
      chatMode: "local-agent",
      autoApprove: true,
    });

    ctx = {
      appId: harness.appId,
      appPath: harness.appDir,
      chatId: harness.chatId,
      onXmlStream: () => undefined,
      onXmlComplete: () => undefined,
    } as unknown as AgentContext;

    // The product installs deps as part of `install && dev`; pre-installing
    // just keeps the first readiness wait inside its timeout.
    execSync("pnpm install --prefer-offline", {
      cwd: harness.appDir,
      stdio: "pipe",
      timeout: 900_000,
    });

    const preview = await harness.startDevServer({ readyTimeoutMs: 300_000 });
    // eslint-disable-next-line no-console
    console.log("[smoke] startDevServer ->", JSON.stringify(preview));
    expect(preview.error, "dev server failed to start").toBeUndefined();
    expect(preview.ok).toBe(true);
    expect(preview.url).toMatch(/^http:\/\/localhost:\d+/);
  }, 1_500_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("(b) read_logs returns real dev-server output", async () => {
    const logs = await readLogs({ type: "server" });
    // eslint-disable-next-line no-console
    console.log("[smoke] read_logs(server) ->\n" + logs.slice(0, 1200));
    expect(logs).not.toContain("No logs found matching the specified filters.");
    // `next dev`'s banner: version line + the Local: URL it bound.
    expect(logs).toMatch(/Next\.js/);
    expect(logs).toMatch(/Local:\s+http:\/\/localhost:\d+/);
  }, 60_000);

  it("(a) restart_app succeeds instead of 'Machine app_run is not registered'", async () => {
    const result = await restartAppTool.execute({}, ctx);
    // eslint-disable-next-line no-console
    console.log("[smoke] restart_app ->", result);
    expect(result).toBe("The app restarted successfully.");
    expect(harness.devServerUrl()).toMatch(/^http:\/\/localhost:\d+/);

    // The restart cleared the log store; the new process refills it.
    const logs = await readLogs({ type: "server" });
    expect(logs).not.toContain("No logs found matching the specified filters.");
    expect(logs).toMatch(/Next\.js|Restarting app/);
  }, 600_000);

  it("(c) a page that throws at render is visible through read_logs", async () => {
    const routeDir = path.join(harness.appDir, "src", "app", "boom");
    fs.mkdirSync(routeDir, { recursive: true });
    fs.writeFileSync(
      path.join(routeDir, "page.tsx"),
      `export default function Boom() {\n  throw new Error("${BOOM}");\n}\n`,
    );

    // `next dev` compiles lazily: nothing is logged until the route is asked
    // for. This is exactly why the harness exposes a route warmer.
    const warmed = await harness.warmDevServerRoutes(["/boom"]);
    // eslint-disable-next-line no-console
    console.log("[smoke] warmDevServerRoutes ->", JSON.stringify(warmed));
    expect(
      warmed[0].status,
      "next dev should answer 500 for a throwing page",
    ).toBe(500);

    // The dev server writes the render error asynchronously after the response.
    let logs = "";
    for (let attempt = 0; attempt < 30; attempt++) {
      logs = await readLogs({ searchTerm: BOOM });
      if (!logs.startsWith("No logs found")) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    // eslint-disable-next-line no-console
    console.log(
      "[smoke] read_logs(searchTerm=BOOM) ->\n" + logs.slice(0, 1500),
    );
    expect(logs).not.toContain("No logs found matching the specified filters.");
    expect(logs).toContain(BOOM);
  }, 300_000);
});
