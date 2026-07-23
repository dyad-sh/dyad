import { beforeEach, describe, expect, it, vi } from "vitest";

import { restartApp, waitForAppReady } from "@/ipc/services/restart_app";
import { safeSend } from "@/ipc/utils/safe_sender";
import { rebuildAppTool, restartAppTool } from "./app_lifecycle";
import type { AgentContext } from "./types";

vi.mock("@/ipc/services/restart_app", () => ({
  restartApp: vi.fn(),
  waitForAppReady: vi.fn(),
}));

vi.mock("@/ipc/utils/safe_sender", () => ({
  safeSend: vi.fn(),
}));

describe("app lifecycle tools", () => {
  const ctx = {
    appId: 42,
    event: { sender: undefined },
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
  } as unknown as AgentContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(restartApp).mockResolvedValue(undefined);
    vi.mocked(waitForAppReady).mockResolvedValue(undefined);
  });

  it("declares restart as an auto-approved runtime mutation", () => {
    expect(restartAppTool.inputSchema.parse({})).toEqual({});
    expect(restartAppTool.defaultConsent).toBe("always");
    expect(restartAppTool.modifiesState).toBe(true);
    expect(restartAppTool.description).toContain(
      "Do not use after ordinary source/style/asset edits",
    );
  });

  it("restarts the current app without removing dependencies", async () => {
    await expect(restartAppTool.execute({}, ctx)).resolves.toBe(
      "The app restarted successfully.",
    );

    expect(restartApp).toHaveBeenCalledWith(ctx.event, {
      appId: 42,
      removeNodeModules: false,
      recreateSandbox: false,
      clearRuntimeLogs: true,
    });
    expect(waitForAppReady).toHaveBeenCalledWith(42, undefined);
    expect(safeSend).toHaveBeenCalledWith(
      undefined,
      "app:output",
      expect.objectContaining({
        type: "agent-lifecycle-succeeded",
        appId: 42,
        lifecycleOperation: "restart",
      }),
    );
    expect(ctx.onXmlStream).toHaveBeenCalledWith(
      '<dyad-status title="Restarting app"></dyad-status>',
    );
    expect(ctx.onXmlComplete).toHaveBeenCalledWith(
      '<dyad-status title="App restarted" state="finished"></dyad-status>',
    );
  });

  it("declares rebuild as an approval-required runtime mutation", () => {
    expect(rebuildAppTool.inputSchema.parse({})).toEqual({});
    expect(rebuildAppTool.defaultConsent).toBe("ask");
    expect(rebuildAppTool.modifiesState).toBe(true);
    expect(rebuildAppTool.description).toContain(
      "Never use for ordinary code errors",
    );
  });

  it("rebuilds the current app after clearing stale logs", async () => {
    await expect(rebuildAppTool.execute({}, ctx)).resolves.toBe(
      "The app rebuilt and restarted successfully.",
    );

    expect(restartApp).toHaveBeenCalledWith(ctx.event, {
      appId: 42,
      removeNodeModules: true,
      recreateSandbox: true,
      clearRuntimeLogs: true,
    });
    expect(waitForAppReady).toHaveBeenCalledWith(42, {
      timeoutMs: 10 * 60 * 1_000,
    });
    expect(ctx.onXmlStream).toHaveBeenCalledWith(
      '<dyad-status title="Rebuilding app"></dyad-status>',
    );
    expect(ctx.onXmlComplete).toHaveBeenCalledWith(
      '<dyad-status title="App rebuilt" state="finished"></dyad-status>',
    );
  });

  it("does not render a duplicate completed preview", () => {
    expect(restartAppTool.buildXml?.({}, false)).toContain("Restarting app");
    expect(restartAppTool.buildXml?.({}, true)).toBeUndefined();
    expect(rebuildAppTool.buildXml?.({}, false)).toContain("Rebuilding app");
    expect(rebuildAppTool.buildXml?.({}, true)).toBeUndefined();
  });

  it("does not start a lifecycle mutation after the turn is cancelled", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const cancelledCtx = {
      ...ctx,
      abortSignal: abortController.signal,
    } as AgentContext;

    await expect(restartAppTool.execute({}, cancelledCtx)).rejects.toThrow(
      "cancelled before it started",
    );

    expect(restartApp).not.toHaveBeenCalled();
    expect(waitForAppReady).not.toHaveBeenCalled();
    expect(ctx.onXmlStream).not.toHaveBeenCalled();
  });
});
