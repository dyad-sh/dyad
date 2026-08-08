import { describe, expect, it } from "vitest";

import {
  blockedPortMessage,
  decideStartAction,
} from "@/ipc/utils/managed_server";

describe("decideStartAction", () => {
  it("starts a server when the port is free", () => {
    expect(
      decideStartAction({
        portBusy: false,
        healthy: false,
        ownedPidAlive: false,
      }),
    ).toBe("spawn");
  });

  it("uses a Helix that is already serving instead of failing", () => {
    // This is the crash-and-restart case: the old server outlived the app.
    expect(
      decideStartAction({ portBusy: true, healthy: true, ownedPidAlive: true }),
    ).toBe("adopt");
  });

  it("adopts a healthy server even when we have no record of starting it", () => {
    expect(
      decideStartAction({
        portBusy: true,
        healthy: true,
        ownedPidAlive: false,
      }),
    ).toBe("adopt");
  });

  it("replaces our own server when it holds the port but has stopped answering", () => {
    expect(
      decideStartAction({
        portBusy: true,
        healthy: false,
        ownedPidAlive: true,
      }),
    ).toBe("reclaim");
  });

  it("refuses to touch a port held by something that is not ours", () => {
    expect(
      decideStartAction({
        portBusy: true,
        healthy: false,
        ownedPidAlive: false,
      }),
    ).toBe("blocked");
  });

  it("never spawns onto an occupied port", () => {
    for (const healthy of [true, false]) {
      for (const ownedPidAlive of [true, false]) {
        expect(
          decideStartAction({ portBusy: true, healthy, ownedPidAlive }),
        ).not.toBe("spawn");
      }
    }
  });
});

describe("blockedPortMessage", () => {
  it("says which port and what to do about it", () => {
    const message = blockedPortMessage("Helix", 31100);
    expect(message).toContain("31100");
    expect(message).toMatch(/try again/i);
  });

  it("reveals nothing but the port", () => {
    // Error text reaches the UI, so it must not carry paths or process detail.
    const message = blockedPortMessage("Helix", 31100);
    expect(message).not.toMatch(/\/Users|\/home|pid|apiKey/i);
  });
});
