import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { TabInstanceId, WindowSessionId } from "../types";
import { WindowRegistry, type WindowEndpoint } from "./window_registry";

function endpoint(id: number): WindowEndpoint & { destroy(): void } {
  let destroyed = false;
  let onDestroyed: (() => void) | undefined;
  return {
    id,
    isDestroyed: () => destroyed,
    send: vi.fn(),
    once: (_event, listener) => {
      onDestroyed = listener;
    },
    destroy: () => {
      destroyed = true;
      onDestroyed?.();
    },
  };
}

const session = () => randomUUID() as WindowSessionId;

describe("WindowRegistry", () => {
  it("keeps the N=1 identity rule while shadow-checking the full fallback", () => {
    const onDivergence = vi.fn();
    const registry = new WindowRegistry({
      development: true,
      onSingleWindowDivergence: onDivergence,
    });
    const onlySession = session();
    registry.register(endpoint(1), onlySession);

    expect(registry.routePresentation({ effect: "important-completion" })).toBe(
      onlySession,
    );
    expect(onDivergence).toHaveBeenCalledWith(
      { effect: "important-completion" },
      onlySession,
      null,
    );
  });

  it("routes initiator, visible focused, visible, focused, then headless", () => {
    const registry = new WindowRegistry();
    const first = session();
    const second = session();
    registry.register(endpoint(1), first);
    registry.register(endpoint(2), second);
    registry.setVisibleEntities(first, [{ kind: "app", id: 7 }]);
    registry.setVisibleEntities(second, [{ kind: "app", id: 7 }]);
    registry.setFocused(first);
    registry.setFocused(second);

    expect(
      registry.routePresentation({
        effect: "ordinary",
        initiatorWindowSessionId: first,
        entity: { kind: "app", id: 7 },
      }),
    ).toBe(first);
    expect(
      registry.routePresentation({
        effect: "ordinary",
        entity: { kind: "app", id: 7 },
      }),
    ).toBe(second);
    expect(
      registry.presentationTargets({
        effect: "inline-shared-error",
        entity: { kind: "app", id: 7 },
      }),
    ).toEqual([second, first]);
    expect(
      registry.routePresentation({ effect: "important-completion" }),
    ).toBeNull();
  });

  it("keeps initiator-only effects local and does not invent a focused fallback", () => {
    const registry = new WindowRegistry();
    const first = session();
    const second = session();
    registry.register(endpoint(1), first);
    registry.register(endpoint(2), second);

    expect(
      registry.routePresentation({
        effect: "operation-toast",
        initiatorWindowSessionId: first,
      }),
    ).toBe(first);
    expect(
      registry.routePresentation({
        effect: "navigation",
        initiatorWindowSessionId: session(),
      }),
    ).toBeNull();
    expect(registry.routePresentation({ effect: "ordinary" })).toBeNull();

    registry.setFocused(second);
    expect(registry.routePresentation({ effect: "ordinary" })).toBe(second);
  });

  it("tracks exact chat tab ownership and removes only matching identities", () => {
    const registry = new WindowRegistry();
    const first = session();
    const second = session();
    registry.register(endpoint(1), first);
    registry.register(endpoint(2), second);
    registry.setChatTabOwnership(first, [
      {
        chatId: 7,
        tabInstanceId: "10000000-0000-4000-8000-000000000007" as TabInstanceId,
      },
    ]);
    registry.setChatTabOwnership(second, [
      {
        chatId: 8,
        tabInstanceId: "20000000-0000-4000-8000-000000000008" as TabInstanceId,
      },
    ]);

    expect(
      registry.ownsChatTab(first, 7, "10000000-0000-4000-8000-000000000007"),
    ).toBe(true);
    expect(registry.findWindowsOwningChat(7)).toEqual([first]);

    registry.removeOwnedChatTab(
      first,
      7,
      "20000000-0000-4000-8000-000000000008",
    );
    expect(registry.findWindowsOwningChat(7)).toEqual([first]);

    registry.removeOwnedChatTab(
      first,
      7,
      "10000000-0000-4000-8000-000000000007",
    );
    expect(registry.findWindowsOwningChat(7)).toEqual([]);
  });

  it("revokes screenshot leases on iframe epoch changes and destruction", () => {
    const registry = new WindowRegistry();
    const windowSession = session();
    const renderer = endpoint(1);
    registry.register(renderer, windowSession);
    registry.advertiseScreenshotCapability(windowSession, {
      kind: "screenshot",
      appId: 7,
      iframeEpoch: 1,
    });
    const retryLease = registry.claimCapability({
      kind: "screenshot",
      appId: 7,
      lossPolicy: "retry",
    });
    expect(retryLease?.isActive()).toBe(true);

    registry.advertiseScreenshotCapability(windowSession, {
      kind: "screenshot",
      appId: 7,
      iframeEpoch: 2,
    });
    expect(retryLease?.isActive()).toBe(false);
    expect(retryLease?.lossReason()).toBe("iframe-epoch-changed");
    expect(retryLease?.shouldRetry()).toBe(true);

    const settleLease = registry.claimCapability({
      kind: "screenshot",
      appId: 7,
      lossPolicy: "settle",
    });
    renderer.destroy();
    expect(settleLease?.lossReason()).toBe("window-destroyed");
    expect(settleLease?.shouldRetry()).toBe(false);
  });
});
