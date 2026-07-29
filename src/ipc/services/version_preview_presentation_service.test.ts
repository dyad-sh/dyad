import { describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { VersionPreviewPresentationService } from "./version_preview_presentation_service";

describe("VersionPreviewPresentationService", () => {
  it("never evicts an unresolved initiator when bounded retention is full", () => {
    const endpoints = new Map(
      Array.from({ length: 257 }, (_, index) => [
        `window-${index}`,
        { send: vi.fn() },
      ]),
    );
    const windows = {
      endpointForSession: vi.fn((sessionId: string) =>
        endpoints.get(sessionId),
      ),
      routePresentation: vi.fn(() => undefined),
    };
    const service = new VersionPreviewPresentationService(windows as never);

    for (let index = 0; index < 256; index += 1) {
      service.recordInitiator(`operation-${index}`, `window-${index}`);
    }
    expect(() =>
      service.recordInitiator("operation-overflow", "window-256"),
    ).toThrowError(
      expect.objectContaining({
        kind: DyadErrorKind.Auth,
      }),
    );

    expect(service.originEndpointFor("operation-0")).toBe(
      endpoints.get("window-0"),
    );
    expect(service.originEndpointFor("operation-overflow")).toBeUndefined();

    service.forget("operation-0");
    service.recordInitiator("operation-after-settlement", "window-256");
    expect(service.originEndpointFor("operation-after-settlement")).toBe(
      endpoints.get("window-256"),
    );
  });

  it("does not let another window hijack an existing operation id", () => {
    const original = { send: vi.fn() };
    const attacker = { send: vi.fn() };
    const windows = {
      endpointForSession: vi.fn((sessionId: string) =>
        sessionId === "original" ? original : attacker,
      ),
      routePresentation: vi.fn(),
    };
    const service = new VersionPreviewPresentationService(windows as never);

    service.recordInitiator("shared-operation", "original");
    service.recordInitiator("shared-operation", "other-window");

    expect(service.originEndpointFor("shared-operation")).toBe(original);
  });

  it("drops a one-shot result when its initiating window has closed", () => {
    const survivor = { send: vi.fn() };
    const endpoints = new Map<string, typeof survivor>();
    const windows = {
      endpointForSession: vi.fn((sessionId: string) =>
        endpoints.get(sessionId),
      ),
      routePresentation: vi.fn(() => "survivor"),
    };
    const service = new VersionPreviewPresentationService(windows as never);

    endpoints.set("initiator", { send: vi.fn() });
    endpoints.set("survivor", survivor);
    service.recordInitiator("operation", "initiator");
    endpoints.delete("initiator");

    service.publishResult(7, "operation", {
      repositoryOutcome: "target-applied",
      notification: { kind: "success", message: "Restored" },
      runtimeAction: "none",
      affectedChatId: null,
      createdChatId: 42,
    });

    expect(survivor.send).not.toHaveBeenCalled();
    expect(windows.routePresentation).not.toHaveBeenCalled();
  });

  it("isolates endpoint send failures from post-mutation lifecycle work", () => {
    const endpoint = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(() => {
        throw new Error("WebContents was destroyed");
      }),
    };
    const windows = {
      endpointForSession: vi.fn(() => endpoint),
      routePresentation: vi.fn(),
    };
    const service = new VersionPreviewPresentationService(windows as never);
    service.recordInitiator("operation", "initiator");

    expect(() =>
      service.publishResult(7, "operation", {
        repositoryOutcome: "target-applied",
        notification: { kind: "success", message: "Restored" },
        runtimeAction: "restart",
        affectedChatId: null,
        createdChatId: null,
      }),
    ).not.toThrow();
    expect(endpoint.send).toHaveBeenCalledWith("version-preview:result", {
      operationId: "operation",
      appId: 7,
      notification: { kind: "success", message: "Restored" },
      affectedChatId: null,
      createdChatId: null,
    });
  });

  it("expires unadmitted ownership but retains confirmed operations", () => {
    vi.useFakeTimers();
    try {
      const endpoint = { send: vi.fn() };
      const windows = {
        endpointForSession: vi.fn(() => endpoint),
        routePresentation: vi.fn(),
      };
      const service = new VersionPreviewPresentationService(windows as never);

      service.recordInitiator("rejected", "window");
      vi.runAllTimers();
      expect(service.originEndpointFor("rejected")).toBeUndefined();

      service.recordInitiator("admitted", "window");
      service.confirm("admitted");
      vi.runAllTimers();
      expect(service.originEndpointFor("admitted")).toBe(endpoint);
    } finally {
      vi.useRealTimers();
    }
  });
});
