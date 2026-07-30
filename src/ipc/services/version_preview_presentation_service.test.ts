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
      service.recordInitiator(7, `operation-${index}`, `window-${index}`);
    }
    expect(() =>
      service.recordInitiator(7, "operation-overflow", "window-256"),
    ).toThrowError(
      expect.objectContaining({
        kind: DyadErrorKind.RateLimited,
      }),
    );

    expect(service.originEndpointFor("operation-0")).toBe(
      endpoints.get("window-0"),
    );
    expect(service.originEndpointFor("operation-overflow")).toBeUndefined();

    service.forget("operation-0");
    service.recordInitiator(7, "operation-after-settlement", "window-256");
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

    service.recordInitiator(7, "shared-operation", "original");
    expect(() =>
      service.recordInitiator(7, "shared-operation", "other-window"),
    ).toThrowError(expect.objectContaining({ kind: DyadErrorKind.Conflict }));

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
    service.recordInitiator(7, "operation", "initiator");
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
    expect(service.inspect().unresolved).toBe(1);
    service.settle("operation");
    expect(service.inspect()).toMatchObject({
      unresolved: 0,
      terminal: 1,
      total: 1,
    });
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
    service.recordInitiator(7, "operation", "initiator");

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

  it("releases rejected routes and retains settled routes within the bound", () => {
    const endpoint = { send: vi.fn() };
    const windows = {
      endpointForSession: vi.fn(() => endpoint),
      routePresentation: vi.fn(),
    };
    const service = new VersionPreviewPresentationService(windows as never);

    service.recordInitiator(7, "rejected", "window");
    service.forget("rejected");
    expect(service.originEndpointFor("rejected")).toBeUndefined();

    service.recordInitiator(7, "admitted", "window");
    service.settle("admitted");
    expect(service.originEndpointFor("admitted")).toBe(endpoint);
    expect(service.inspect()).toMatchObject({
      unresolved: 0,
      terminal: 1,
      total: 1,
    });
  });

  it("retains closed-window routes until authoritative actor settlement", () => {
    const windows = {
      endpointForSession: vi.fn(() => undefined),
      routePresentation: vi.fn(),
    };
    const service = new VersionPreviewPresentationService(windows as never);

    service.recordInitiator(7, "closed-window-operation", "closed-window");

    expect(service.inspect().unresolved).toBe(1);
    expect(
      service.originEndpointFor("closed-window-operation"),
    ).toBeUndefined();
    expect(service.inspect().unresolved).toBe(1);
    service.settle("closed-window-operation");
    expect(service.inspect()).toMatchObject({
      unresolved: 0,
      terminal: 1,
    });
  });

  it("does not settle a replacement actor's route when a stale actor disposes", () => {
    const windows = {
      endpointForSession: vi.fn(() => undefined),
      routePresentation: vi.fn(),
    };
    const service = new VersionPreviewPresentationService(windows as never);

    service.recordInitiator(7, "stale-operation", "window-a", "actor-old");
    service.recordInitiator(
      7,
      "replacement-operation",
      "window-b",
      "actor-new",
    );

    expect(service.settleActor("actor-old")).toBe(1);
    expect(service.inspect()).toMatchObject({
      unresolved: 1,
      terminal: 1,
    });
    expect(service.originEndpointFor("replacement-operation")).toBeUndefined();
    expect(service.settleActor("actor-new")).toBe(1);
  });
});
