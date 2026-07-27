import { describe, expect, it, vi } from "vitest";
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
    service.recordInitiator("operation-overflow", "window-256");

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
});
