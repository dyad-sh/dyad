import { describe, expect, it, vi } from "vitest";
import { WindowRegistry } from "@/window_infrastructure/main/window_registry";
import { WindowSessionIdSchema } from "@/window_infrastructure/types";
import { GithubOpsPresentationService } from "./github_ops_presentation_service";

describe("GithubOpsPresentationService", () => {
  it("routes an operation error to its initiating window", () => {
    const windows = new WindowRegistry();
    const first = { id: 1, isDestroyed: () => false, send: vi.fn() };
    const second = { id: 2, isDestroyed: () => false, send: vi.fn() };
    const firstSession = WindowSessionIdSchema.parse(
      "00000000-0000-4000-8000-000000000001",
    );
    const secondSession = WindowSessionIdSchema.parse(
      "00000000-0000-4000-8000-000000000002",
    );
    windows.register(first, firstSession);
    windows.register(second, secondSession);
    windows.setVisibleEntities(firstSession, [{ kind: "app", id: 7 }]);
    windows.setVisibleEntities(secondSession, [{ kind: "app", id: 7 }]);
    const service = new GithubOpsPresentationService(windows);
    service.recordInitiator("operation-1", "actor-1", 7, firstSession);

    service.showError(7, "operation-1", "Push failed");

    expect(first.send).toHaveBeenCalledWith("toast:error", {
      message: "Push failed",
    });
    expect(second.send).not.toHaveBeenCalled();
  });

  it("falls back to another app window when the initiating window closes", () => {
    const windows = new WindowRegistry();
    const first = { id: 1, isDestroyed: () => false, send: vi.fn() };
    const second = { id: 2, isDestroyed: () => false, send: vi.fn() };
    const firstSession = WindowSessionIdSchema.parse(
      "00000000-0000-4000-8000-000000000001",
    );
    const secondSession = WindowSessionIdSchema.parse(
      "00000000-0000-4000-8000-000000000002",
    );
    windows.register(first, firstSession);
    windows.register(second, secondSession);
    windows.setVisibleEntities(firstSession, [{ kind: "app", id: 7 }]);
    windows.setVisibleEntities(secondSession, [{ kind: "app", id: 7 }]);
    const service = new GithubOpsPresentationService(windows);
    service.recordInitiator("operation-1", "actor-1", 7, firstSession);

    windows.unregister(first.id);
    expect(service.inspectWindowRoutes(firstSession)).toHaveLength(1);
    service.showError(7, "operation-1", "Push failed");

    expect(second.send).toHaveBeenCalledWith("toast:error", {
      message: "Push failed",
    });
    expect(service.inspect().unresolved).toBe(1);
    expect(service.markTerminal("operation-1")).toBe(true);
    expect(service.inspect()).toMatchObject({
      unresolved: 0,
      terminal: 1,
      total: 1,
    });
    expect(service.releaseOwner("actor-1")).toBe(1);
    expect(service.inspect()).toMatchObject({
      unresolved: 0,
      terminal: 0,
      total: 0,
    });
  });
});
