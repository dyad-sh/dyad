/**
 * TEST-ONLY: run an app's real dev server from a headless (vitest) harness.
 *
 * Why this exists
 * ---------------
 * `setupChatFlowHarness` registers only the chat-stream handlers. Production
 * registers the `app_run` distributed machine as a side effect of constructing
 * `RemoteMachineTransport` in `@/ipc/services/distributed_machine_host`, so in
 * the headless harness every Local Agent `restart_app` / `rebuild_app` call
 * fails with "Machine app_run is not registered" and `read_logs` has nothing
 * to read — the agent builds blind to runtime behaviour.
 *
 * What this does
 * --------------
 * Nothing new: it drives the SAME production path the renderer's "run app"
 * button drives.
 *
 *   register appRunDefinition on the existing main-placement ActorHost
 *     -> appRunActorService.dispatchStart(appId, …)     (app_handlers.ts:848)
 *     -> appRuntimeService.start -> executeApp -> executeAppLocalNode
 *     -> child_process.spawn("<pnpm|npm> install && … run dev --port <p>")
 *     -> listenToProcess -> addLog({type:"server"}) -> read_logs
 *
 * Deliberately NOT imported here: `@/ipc/services/distributed_machine_host`.
 * That module pulls in the window registry and the remote transport and
 * registers all six machines (chat_stream included), which would change
 * behaviour for existing chat-flow tests. Only `app_run` is needed, and
 * `ActorHost.register()` is all the registration the machine requires —
 * transport/window plumbing matters only for renderer subscribe/dispatch,
 * which a headless harness never performs.
 *
 * Requirement: the test file must install the headless proxy module, see
 * `@/testing/headless_proxy_server`. `assertHeadlessProxyInstalled` fails
 * fast (with instructions) rather than letting `waitForAppReady` stall.
 */
import { randomUUID } from "node:crypto";

import { appRunDefinition } from "@/app_run/definition";
import { appRunActorService } from "@/ipc/services/app_run_actor_service";
import { appRuntimeService } from "@/ipc/services/app_runtime_service";
import { remoteMachineHost } from "@/ipc/services/distributed_machine_actor_host";
import {
  runningApps,
  setCurrentlySelectedAppId,
  stopAllAppsSync,
} from "@/ipc/utils/process_manager";
import { addLog } from "@/lib/log_store";
import { getAppPort } from "../../shared/ports";
import { HEADLESS_PROXY_MARKER } from "./headless_proxy_server";

/** Mirrors DEFAULT_APP_READY_TIMEOUT_MS in app_runtime_service. */
const DEFAULT_READY_TIMEOUT_MS = 2 * 60 * 1_000;

export interface HeadlessAppPreview {
  /** True only when the dev server is up AND the preview proxy answered. */
  ok: boolean;
  /** Proxy URL the agent/browser would load; undefined when !ok. */
  url?: string;
  /** The dev-server port `next dev --port` was told to bind. */
  port: number;
  /** Human-readable failure reason; also written to the app's log store. */
  error?: string;
}

let machineRegistered = false;
let exitHookInstalled = false;

/**
 * Registers `app_run` on the shared main-placement ActorHost.
 *
 * Idempotent, and tolerant of a harness that already registered the whole
 * manifest via `distributed_machine_host` (the hybrid harness does).
 */
export function ensureAppRunMachineRegistered(): void {
  if (machineRegistered) return;
  try {
    remoteMachineHost.register(appRunDefinition);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/is already registered/.test(message)) {
      throw error;
    }
  }
  machineRegistered = true;
}

/**
 * A hard vitest kill (test timeout, Ctrl-C in run-cell.sh) skips
 * `harness.dispose()`, leaking a `next dev` that keeps holding the app port.
 * `stopAllAppsSync` is the same tree-kill the Electron quit path uses.
 */
function ensureExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const stop = () => {
    try {
      stopAllAppsSync();
    } catch {
      // best effort during teardown
    }
  };
  process.once("exit", stop);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

async function assertHeadlessProxyInstalled(): Promise<void> {
  const proxyModule = await import("@/ipc/utils/start_proxy_server");
  const startProxy = proxyModule.startProxy as unknown as Record<
    string,
    unknown
  >;
  if (startProxy?.[HEADLESS_PROXY_MARKER]) return;
  throw new Error(
    "headless dev server requires the headless proxy module. Add to the test file:\n" +
      '  vi.mock("@/ipc/utils/start_proxy_server", async () => {\n' +
      '    const { createHeadlessProxyModule } = await import("@/testing/headless_proxy_server");\n' +
      "    return createHeadlessProxyModule();\n" +
      "  });\n" +
      "Without it the production worker path resolves to src/worker/proxy_server.js " +
      "(nonexistent under vitest) and every readiness wait stalls to its timeout.",
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Starts the app's dev server and waits for the preview proxy to answer.
 *
 * NEVER throws and never blocks past `readyTimeoutMs`: a cell must not be
 * hung by a broken dev server. On failure the reason is appended to the app's
 * log store as a `server`/`error` entry, so `read_logs` tells the agent the
 * truth instead of "No logs found".
 */
export async function startHeadlessAppPreview({
  appId,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
}: {
  appId: number;
  readyTimeoutMs?: number;
}): Promise<HeadlessAppPreview> {
  const port = getAppPort(appId);
  try {
    await assertHeadlessProxyInstalled();
    ensureAppRunMachineRegistered();
    ensureExitHook();
    // Belt-and-braces against the idle-app garbage collector, which the
    // chat-flow harness does not start today but might tomorrow.
    setCurrentlySelectedAppId(appId);

    await appRunActorService.dispatchStart(appId, {
      operationId: randomUUID(),
      startedAt: Date.now(),
    });
    await appRuntimeService.waitForReady(appId, { timeoutMs: readyTimeoutMs });
    return { ok: true, url: runningApps.get(appId)?.proxyUrl, port };
  } catch (error) {
    const message = describe(error);
    addLog({
      level: "error",
      type: "server",
      appId,
      timestamp: Date.now(),
      message: `[dyad-harness] dev server failed to become ready: ${message}`,
    });
    return { ok: false, port, error: message };
  }
}

/** True when the dev server is running and its preview proxy is answering. */
export function isHeadlessAppPreviewLive(appId: number): boolean {
  const info = runningApps.get(appId);
  return Boolean(info?.proxyUrl);
}

/** The preview URL an agent (or a browser) would load, if any. */
export function getHeadlessAppPreviewUrl(appId: number): string | undefined {
  return runningApps.get(appId)?.proxyUrl;
}

/** The dev server's own origin (what the proxy forwards to), if any. */
export function getHeadlessAppOriginUrl(appId: number): string | undefined {
  return runningApps.get(appId)?.originalUrl;
}

/**
 * Restarts the dev server only if it is not currently live. Cheap no-op when
 * the agent left a healthy server behind at the end of a milestone.
 */
export async function ensureHeadlessAppPreview(options: {
  appId: number;
  readyTimeoutMs?: number;
}): Promise<HeadlessAppPreview> {
  if (isHeadlessAppPreviewLive(options.appId)) {
    return {
      ok: true,
      url: getHeadlessAppPreviewUrl(options.appId),
      port: getAppPort(options.appId),
    };
  }
  return startHeadlessAppPreview(options);
}

/**
 * `next dev` compiles lazily: a page whose module throws at import, or whose
 * prerender fails, prints nothing until something requests it. Requesting a
 * few routes turns those genuine faults into `type:"server"` log entries.
 *
 * Best effort — a failed fetch is itself the interesting signal and is never
 * thrown.
 *
 * Requests go to the dev server's own origin, NOT the preview proxy: the
 * proxy's HTML injection emits `Content-Length` alongside `Transfer-Encoding`,
 * which Chromium (the real preview) tolerates but undici — Node's `fetch` —
 * rejects outright with "Response does not match the HTTP/1.1 protocol".
 * Compilation and error logging happen in the dev server either way.
 */
export async function warmHeadlessAppPreviewRoutes({
  appId,
  routes = ["/"],
  timeoutMs = 60_000,
}: {
  appId: number;
  routes?: string[];
  timeoutMs?: number;
}): Promise<Array<{ route: string; status?: number; error?: string }>> {
  const base =
    getHeadlessAppOriginUrl(appId) ?? getHeadlessAppPreviewUrl(appId);
  if (!base) {
    return routes.map((route) => ({ route, error: "preview not running" }));
  }
  const results: Array<{ route: string; status?: number; error?: string }> = [];
  for (const route of routes) {
    try {
      const response = await fetch(new URL(route, base).toString(), {
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Drain so the dev server finishes rendering (and logging) the response.
      await response.text().catch(() => undefined);
      results.push({ route, status: response.status });
    } catch (error) {
      results.push({ route, error: describe(error) });
    }
  }
  return results;
}

/** Stops the dev server and disposes the app-run actor. Never throws. */
export async function stopHeadlessAppPreview(appId: number): Promise<void> {
  try {
    await appRuntimeService.stop(appId);
  } catch {
    // stopRunningAppsForHarness tree-kills whatever is left.
  }
  if (!machineRegistered) return;
  try {
    await appRunActorService.disposeApp(appId);
  } catch {
    // actor may already be gone
  }
}
