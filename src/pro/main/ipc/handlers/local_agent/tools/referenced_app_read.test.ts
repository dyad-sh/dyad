import { beforeEach, expect, it, vi } from "vitest";
import { withReferencedAppRead } from "./referenced_app_read";
import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";
import type { AgentContext } from "./types";
const row = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock("@/db", () => ({ db: { query: { apps: { findFirst: row.find } } } }));
vi.mock("@/paths/paths", () => ({ getDyadAppPath: (path: string) => path }));
const ctx = {
  referencedApps: new Map([["other", "/old/path"]]),
  referencedAppIds: new Map([["other", 987654]]),
  abortSignal: new AbortController().signal,
} as AgentContext;
beforeEach(() => {
  row.find.mockReset();
});
it("refreshes the referenced identity under a read claim and holds it until reads settle", async () => {
  row.find.mockResolvedValue({ id: 987654, path: "/new/path" });
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((r) => (entered = r));
  const gate = new Promise<void>((r) => (release = r));
  const read = withReferencedAppRead(
    "read_file",
    { app_name: "OTHER" },
    ctx,
    async (current) => {
      expect(current.referencedApps.get("other")).toBe("/new/path");
      entered();
      await gate;
      return "contents";
    },
  );
  await ready;
  let renamed = false;
  const rename = appOperationCoordinator.run(
    { appId: 987654, operation: "rename fixture", resources: ["app-path"] },
    async () => {
      renamed = true;
    },
  );
  await Promise.resolve();
  expect(renamed).toBe(false);
  release();
  expect(await read).toBe("contents");
  await rename;
  expect(renamed).toBe(true);
  expect(ctx.referencedApps.get("other")).toBe("/old/path");
});
it("never falls back to a reused stale path when the original referenced app was deleted", async () => {
  row.find.mockResolvedValue(undefined);
  const invoke = vi.fn();
  await expect(
    withReferencedAppRead("read_file", { app_name: "other" }, ctx, invoke),
  ).rejects.toThrow("no longer exists");
  expect(invoke).not.toHaveBeenCalled();
  expect(appOperationCoordinator.isBusy(987654, ["app-path"])).toBe(false);
});
