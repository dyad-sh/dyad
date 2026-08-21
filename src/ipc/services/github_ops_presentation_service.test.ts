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
    service.recordInitiator(7, "operation-1", firstSession);

    service.showError(7, "operation-1", "Push failed");

    expect(first.send).toHaveBeenCalledWith("toast:error", {
      message: "Push failed",
      toastId: "github-ops-7-operation",
    });
    expect(second.send).not.toHaveBeenCalled();
  });

  it("keeps the first initiating window for duplicate operation ids", () => {
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
    const service = new GithubOpsPresentationService(windows);

    service.recordInitiator(7, "shared-operation", firstSession);
    service.recordInitiator(7, "shared-operation", secondSession);
    service.showError(7, "shared-operation", "Push failed");

    expect(first.send).toHaveBeenCalledWith("toast:error", {
      message: "Push failed",
      toastId: "github-ops-7-operation",
    });
    expect(second.send).not.toHaveBeenCalled();
  });

  it("expires unadmitted initiators but retains confirmed ownership", () => {
    vi.useFakeTimers();
    try {
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
      const service = new GithubOpsPresentationService(windows);

      service.recordInitiator(7, "rejected", firstSession);
      vi.runAllTimers();
      service.recordInitiator(7, "rejected", secondSession);
      service.showError(7, "rejected", "Rejected retry failed");
      expect(second.send).toHaveBeenCalled();

      service.recordInitiator(7, "admitted", firstSession);
      service.confirm("admitted");
      vi.runAllTimers();
      service.recordInitiator(7, "admitted", secondSession);
      service.showError(7, "admitted", "Admitted operation failed");
      expect(first.send).toHaveBeenCalledWith("toast:error", {
        message: "Admitted operation failed",
        toastId: "github-ops-7-operation",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("evicts a tentative route before confirmed ownership at capacity", () => {
    vi.useFakeTimers();
    try {
      const windows = new WindowRegistry();
      const target = { id: 1, isDestroyed: () => false, send: vi.fn() };
      const session = WindowSessionIdSchema.parse(
        "00000000-0000-4000-8000-000000000001",
      );
      windows.register(target, session);
      const service = new GithubOpsPresentationService(windows);

      service.recordInitiator(7, "confirmed", session);
      service.confirm("confirmed");
      for (let index = 0; index < 255; index += 1) {
        service.recordInitiator(7, `tentative-${index}`, session);
      }
      expect(() =>
        service.recordInitiator(7, "operation-overflow", session),
      ).not.toThrow();

      service.showError(7, "confirmed", "Confirmed operation failed");
      expect(target.send).toHaveBeenCalledWith("toast:error", {
        message: "Confirmed operation failed",
        toastId: "github-ops-7-operation",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports capacity exhaustion rather than evicting confirmed ownership", () => {
    vi.useFakeTimers();
    try {
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
      windows.setVisibleEntities(secondSession, [{ kind: "app", id: 7 }]);
      const service = new GithubOpsPresentationService(windows);

      for (let index = 0; index < 256; index += 1) {
        service.recordInitiator(7, `confirmed-${index}`, firstSession);
        service.confirm(`confirmed-${index}`);
      }
      expect(() =>
        service.recordInitiator(7, "operation-overflow", firstSession),
      ).toThrowError(
        "Too many GitHub operations are still settling. Please try again.",
      );

      service.showError(7, "confirmed-0", "Confirmed operation failed");
      expect(first.send).toHaveBeenCalledWith("toast:error", {
        message: "Confirmed operation failed",
        toastId: "github-ops-7-operation",
      });
      expect(second.send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets only routes owned by a disposed app", () => {
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
    windows.setVisibleEntities(firstSession, [{ kind: "app", id: 8 }]);
    windows.setVisibleEntities(secondSession, [{ kind: "app", id: 7 }]);
    const service = new GithubOpsPresentationService(windows);
    service.recordInitiator(7, "disposed-app-operation", firstSession);
    service.recordInitiator(8, "retained-app-operation", firstSession);
    service.confirm("disposed-app-operation");
    service.confirm("retained-app-operation");

    service.forgetApp(7);
    service.showError(7, "disposed-app-operation", "Disposed app failure");
    service.showError(8, "retained-app-operation", "Retained app failure");

    expect(second.send).toHaveBeenCalledWith("toast:error", {
      message: "Disposed app failure",
      toastId: "github-ops-7-operation",
    });
    expect(first.send).toHaveBeenCalledWith("toast:error", {
      message: "Retained app failure",
      toastId: "github-ops-8-operation",
    });
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

    service.showError(7, undefined, message, "git-state");
    service.showError(7, undefined, message, "git-state");

    expect(target.send).toHaveBeenCalledTimes(2);
    expect(target.send).toHaveBeenNthCalledWith(1, "toast:error", {
      message,
      persist: true,
      toastId: "github-ops-7-git-state",
    });
    expect(target.send).toHaveBeenNthCalledWith(2, "toast:error", {
      message,
      persist: true,
      toastId: "github-ops-7-git-state",
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
    service.recordInitiator(7, "operation-1", session);
    const message = `Git push failed:\n${"detail ".repeat(40)}`;

    service.showError(7, "operation-1", message);

    expect(target.send).toHaveBeenCalledWith("toast:error", {
      message,
      toastId: "github-ops-7-operation",
    });
  });

  it("dismisses a recovered probe error in the window that received it", () => {
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
    const service = new GithubOpsPresentationService(windows);
    service.showError(7, undefined, "Probe failed\nDetails", "git-state");
    windows.setVisibleEntities(firstSession, []);
    windows.setVisibleEntities(secondSession, [{ kind: "app", id: 7 }]);

    service.dismissError(7, "git-state");

    expect(first.send).toHaveBeenCalledWith("toast:dismiss", {
      toastId: "github-ops-7-git-state",
    });
    expect(second.send).not.toHaveBeenCalled();
  });
});
