import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import {
  chatErrorByIdAtom,
  isStreamingByIdAtom,
  queuePausedByIdAtom,
  queuedMessagesByIdAtom,
} from "@/atoms/chatAtoms";

import { ChatStreamManager } from "../manager";

const CHAT_ID = 17;

describe("ChatStreamManager", () => {
  it("owns one controller per chat and releases unobserved terminal controllers", () => {
    const manager = new ChatStreamManager(createStore());
    const controller = manager.ensure(CHAT_ID);

    expect(manager.ensure(CHAT_ID)).toBe(controller);
    const unsubscribe = controller.subscribe(() => undefined);
    unsubscribe();

    expect(manager.peek(CHAT_ID)).toBeUndefined();
  });

  it("does not create a controller for registration-only notifications", () => {
    const manager = new ChatStreamManager(createStore());

    manager.notifyStreamRegistered(CHAT_ID);

    expect(manager.peek(CHAT_ID)).toBeUndefined();
  });

  it("disposes the controller and clears all stream residue for a deleted chat", () => {
    const store = createStore();
    const manager = new ChatStreamManager(store);
    manager.ensure(CHAT_ID);
    store.set(queuedMessagesByIdAtom, new Map([[CHAT_ID, []]]));
    store.set(queuePausedByIdAtom, new Map([[CHAT_ID, true]]));
    store.set(chatErrorByIdAtom, new Map([[CHAT_ID, "boom"]]));
    store.set(isStreamingByIdAtom, new Map([[CHAT_ID, false]]));

    manager.disposeChat(CHAT_ID);

    expect(manager.peek(CHAT_ID)).toBeUndefined();
    expect(store.get(queuedMessagesByIdAtom).has(CHAT_ID)).toBe(false);
    expect(store.get(queuePausedByIdAtom).has(CHAT_ID)).toBe(false);
    expect(store.get(chatErrorByIdAtom).has(CHAT_ID)).toBe(false);
    expect(store.get(isStreamingByIdAtom).has(CHAT_ID)).toBe(false);
  });
});
