// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";

const runningApps = vi.hoisted(() => new Map<number, { proxyUrl?: string }>());

vi.mock("electron", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ apps: {} }));
vi.mock("@/main/settings", () => ({ readSettings: vi.fn() }));
vi.mock("@/lib/log_store", () => ({ clearLogs: vi.fn() }));
vi.mock("@/paths/paths", () => ({ getDyadAppPath: vi.fn() }));
vi.mock("../../../shared/ports", () => ({ getAppPort: vi.fn() }));
vi.mock("./app_runtime_service", () => ({
  cleanUpPort: vi.fn(),
  executeApp: vi.fn(),
}));
vi.mock("../utils/lock_utils", () => ({ withLock: vi.fn() }));
vi.mock("../utils/process_manager", () => ({
  removeDockerVolumesForApp: vi.fn(),
  runningApps,
  stopAppByInfo: vi.fn(),
}));

import { waitForAppReady } from "./restart_app";

describe("waitForAppReady", () => {
  it("settles promptly when readiness waiting is cancelled", async () => {
    runningApps.set(1, {});
    const controller = new AbortController();
    const ready = waitForAppReady(1, {
      timeoutMs: 60_000,
      signal: controller.signal,
    });

    controller.abort();

    await expect(ready).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
    });
    runningApps.clear();
  });
});
