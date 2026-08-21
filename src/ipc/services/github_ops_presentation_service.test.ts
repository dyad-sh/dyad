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
    service.recordInitiator("operation-1", firstSession);

    service.showError(7, "operation-1", "Push failed");

    expect(first.send).toHaveBeenCalledWith("toast:error", {
      message: "Push failed",
      toastId: "github-ops-7",
    });
    expect(second.send).not.toHaveBeenCalled();
  });

  it("deduplicates persistent detailed probe errors by app", () => {
    const windows = new WindowRegistry();
    const target = { id: 1, isDestroyed: () => false, send: vi.fn() };
    const session = WindowSessionIdSchema.parse(
      "00000000-0000-4000-8000-000000000001",
    );
    windows.register(target, session);
    windows.setVisibleEntities(session, [{ kind: "app", id: 7 }]);
    const service = new GithubOpsPresentationService(windows);
    const message = `Git probe failed:\n${"detail ".repeat(40)}`;

    service.showError(7, undefined, message);
    service.showError(7, undefined, message);

    expect(target.send).toHaveBeenCalledTimes(2);
    expect(target.send).toHaveBeenNthCalledWith(1, "toast:error", {
      message,
      persist: true,
      toastId: "github-ops-7",
    });
    expect(target.send).toHaveBeenNthCalledWith(2, "toast:error", {
      message,
      persist: true,
      toastId: "github-ops-7",
    });
  });

  it("lets detailed operation toasts expire because the banner persists", () => {
    const windows = new WindowRegistry();
    const target = { id: 1, isDestroyed: () => false, send: vi.fn() };
    const session = WindowSessionIdSchema.parse(
      "00000000-0000-4000-8000-000000000001",
    );
    windows.register(target, session);
    windows.setVisibleEntities(session, [{ kind: "app", id: 7 }]);
    const service = new GithubOpsPresentationService(windows);
    service.recordInitiator("operation-1", session);
    const message = `Git push failed:\n${"detail ".repeat(40)}`;

    service.showError(7, "operation-1", message);

    expect(target.send).toHaveBeenCalledWith("toast:error", {
      message,
      toastId: "github-ops-7",
    });
  });

  it("dismisses a recovered probe error for the visible app", () => {
    const windows = new WindowRegistry();
    const target = { id: 1, isDestroyed: () => false, send: vi.fn() };
    const session = WindowSessionIdSchema.parse(
      "00000000-0000-4000-8000-000000000001",
    );
    windows.register(target, session);
    windows.setVisibleEntities(session, [{ kind: "app", id: 7 }]);
    const service = new GithubOpsPresentationService(windows);

    service.dismissError(7);

    expect(target.send).toHaveBeenCalledWith("toast:dismiss", {
      toastId: "github-ops-7",
    });
  });
});
