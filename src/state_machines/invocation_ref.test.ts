import { describe, expect, it, vi } from "vitest";

import { createSequentialIdSource } from "./testing";
import {
  CancellationTombstones,
  createInvocationRef,
  invocationRegistryKey,
  InvocationRegistry,
  matchCompletionToActiveOperation,
  settleSupersededWaiter,
  SupersededInvocationRefs,
} from "./invocation_ref";

describe("InvocationRef", () => {
  it("mints globally distinct operation IDs through the injected source", () => {
    const ids = createSequentialIdSource();
    const first = createInvocationRef("chat-stream", 7, ids);
    const second = createInvocationRef("chat-stream", 7, ids);

    expect(first).toEqual({
      kind: "chat-stream",
      entityKey: 7,
      operationId: "chat-stream:1",
    });
    expect(second.operationId).toBe("chat-stream:2");
  });

  it("constructs unambiguous composite registry keys", () => {
    const left = {
      kind: "a",
      entityKey: "bc",
      operationId: "d",
    } as const;
    const right = {
      kind: "ab",
      entityKey: "c",
      operationId: "d",
    } as const;

    expect(invocationRegistryKey(left)).not.toBe(invocationRegistryKey(right));
    expect(
      invocationRegistryKey({
        kind: "chat",
        entityKey: 1,
        operationId: "same",
      }),
    ).not.toBe(
      invocationRegistryKey({
        kind: "chat",
        entityKey: "1",
        operationId: "same",
      }),
    );
  });

  it("classifies matching, stale, and unsolicited completions", () => {
    const ids = createSequentialIdSource();
    const active = createInvocationRef("chat-stream", 7, ids);
    const stale = createInvocationRef("chat-stream", 7, ids);

    expect(matchCompletionToActiveOperation(active, active).kind).toBe(
      "matched",
    );
    expect(matchCompletionToActiveOperation(active, stale).kind).toBe("stale");
    expect(matchCompletionToActiveOperation(active, undefined).kind).toBe(
      "unsolicited",
    );
  });

  it("enforces refs at registry claim time", () => {
    const ids = createSequentialIdSource();
    const stale = createInvocationRef("oauth", "provider", ids);
    const active = createInvocationRef("oauth", "provider", ids);
    const registry = new InvocationRegistry<string>();

    registry.register(active, "active");

    expect(registry.claim(stale)).toMatchObject({
      kind: "stale",
      expected: active,
    });
    expect(registry.claim(active)).toEqual({
      kind: "claimed",
      ref: active,
      value: "active",
    });
  });

  it("settles superseded waiters without applying stale state", () => {
    const ids = createSequentialIdSource();
    const oldRef = createInvocationRef("chat-stream", 7, ids);
    const activeRef = createInvocationRef("chat-stream", 7, ids);
    const settle = vi.fn();
    const applyState = vi.fn();

    const settled = settleSupersededWaiter({ ref: oldRef, settle }, activeRef, {
      success: false,
    });
    if (!settled) {
      applyState();
    }

    expect(settle).toHaveBeenCalledWith({ success: false });
    expect(applyState).not.toHaveBeenCalled();
  });

  it("bounds superseded refs and cancellation tombstones", () => {
    const ids = createSequentialIdSource();
    const first = createInvocationRef("chat-stream", 7, ids);
    const second = createInvocationRef("chat-stream", 7, ids);
    const superseded = new SupersededInvocationRefs(1);
    const tombstones = new CancellationTombstones(1);

    superseded.add(first);
    superseded.add(second);
    tombstones.add(first);
    tombstones.add(second);

    expect(superseded.has(first)).toBe(false);
    expect(superseded.has(second)).toBe(true);
    expect(tombstones.has(first)).toBe(false);
    expect(tombstones.has(second)).toBe(true);
  });
});
