// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  addTrackedValue,
  removeTrackedValue,
  setPartialResponseForStream,
  takePartialResponseForStream,
} from "@/ipc/handlers/chat_stream_handlers";

describe("stream invocation tracking", () => {
  it("keeps a newer invocation tracked when an older one finishes", () => {
    const trackedInvocations = new Map<number, Set<object>>();
    const olderInvocation = {};
    const newerInvocation = {};

    addTrackedValue(trackedInvocations, 42, olderInvocation);
    addTrackedValue(trackedInvocations, 42, newerInvocation);
    removeTrackedValue(trackedInvocations, 42, olderInvocation);

    expect(trackedInvocations.get(42)).toEqual(new Set([newerInvocation]));
  });

  it("keeps partial responses isolated between concurrent streams", () => {
    const olderStream = new AbortController();
    const newerStream = new AbortController();

    setPartialResponseForStream(olderStream, "older partial response");
    setPartialResponseForStream(newerStream, "newer partial response");

    expect(takePartialResponseForStream(olderStream)).toBe(
      "older partial response",
    );
    expect(takePartialResponseForStream(newerStream)).toBe(
      "newer partial response",
    );
  });
});
