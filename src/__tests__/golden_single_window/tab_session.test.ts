import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import capturedSessionFixture from "./fixtures/chat-tab-session.real.json";
import {
  chatTabSessionStorageAtom,
  closedChatIdsAtom,
  hydrateChatTabSessionAtom,
  recentViewedChatIdsAtom,
  sessionOpenedChatIdsAtom,
  type ChatTabSession,
} from "@/atoms/chatAtoms";

const capturedSession = capturedSessionFixture as ChatTabSession;

describe("golden single-window: tab-session schema", () => {
  it("restores the tabs and selection from a captured real session blob", () => {
    const store = createStore();
    store.set(chatTabSessionStorageAtom, capturedSession);

    const restored = store.set(
      hydrateChatTabSessionAtom,
      new Set([1711, 1736, 1764, 1799, 1807, 1842]),
    );

    // Protects the Phase B per-window tab-session schema migration.
    expect(restored).toEqual(capturedSession);
    expect(store.get(recentViewedChatIdsAtom)).toEqual([
      1842, 1799, 1807, 1764,
    ]);
    expect(Array.from(store.get(sessionOpenedChatIdsAtom))).toEqual([
      1842, 1799, 1807, 1764,
    ]);
    expect(Array.from(store.get(closedChatIdsAtom))).toEqual([1711, 1736]);
  });
});
