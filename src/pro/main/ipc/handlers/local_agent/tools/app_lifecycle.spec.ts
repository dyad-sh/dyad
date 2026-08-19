import { beforeEach, describe, expect, it, vi } from "vitest";

import { appRunActorService } from "@/ipc/services/app_run_actor_service";
import { reinstallAndRestartAppTool, restartAppTool } from "./app_lifecycle";
import type { AgentContext } from "./types";

vi.mock("@/ipc/services/app_run_actor_service", () => ({
  appRunActorService: {
    executeExternalLifecycle: vi.fn(),
  },
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
    vi.mocked(appRunActorService.executeExternalLifecycle).mockResolvedValue(
      undefined,
    );
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

    expect(appRunActorService.executeExternalLifecycle).toHaveBeenCalledWith({
      appId: 42,
      operation: "restart",
      abortSignal: undefined,
      timeoutMs: undefined,
    });
    expect(ctx.onXmlStream).toHaveBeenCalledWith(
      '<dyad-status title="Restarting app"></dyad-status>',
    );
    expect(ctx.onXmlComplete).toHaveBeenCalledWith(
      '<dyad-status title="App restarted" state="finished"></dyad-status>',
    );
  });

  it("declares rebuild as an approval-required runtime mutation", () => {
    expect(reinstallAndRestartAppTool.inputSchema.parse({})).toEqual({});
    expect(reinstallAndRestartAppTool.defaultConsent).toBe("ask");
    expect(reinstallAndRestartAppTool.modifiesState).toBe(true);
    expect(reinstallAndRestartAppTool.description).toContain(
      "Never use for ordinary code errors",
    );
  });

  it("rebuilds the current app after clearing stale logs", async () => {
    await expect(reinstallAndRestartAppTool.execute({}, ctx)).resolves.toBe(
      "The app rebuilt and restarted successfully.",
    );

    expect(appRunActorService.executeExternalLifecycle).toHaveBeenCalledWith({
      appId: 42,
      operation: "rebuild",
      abortSignal: undefined,
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
    expect(reinstallAndRestartAppTool.buildXml?.({}, false)).toContain(
      "Rebuilding app",
    );
    expect(reinstallAndRestartAppTool.buildXml?.({}, true)).toBeUndefined();
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

    expect(appRunActorService.executeExternalLifecycle).not.toHaveBeenCalled();
    expect(ctx.onXmlStream).not.toHaveBeenCalled();
  });
});
