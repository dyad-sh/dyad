import { describe, expect, it } from "vitest";
import { selectCoolifySetupCapabilities } from "./capabilities";
import { IDLE, type CoolifySetupState } from "./state";

const REF = {
  kind: "coolify-setup" as const,
  entityKey: "203.0.113.5",
  operationId: "op-1",
};

const running = (stopping = false): CoolifySetupState => ({
  type: "running",
  host: "203.0.113.5",
  invocationRef: REF,
  step: "installing",
  log: "",
  stopping,
});

describe("what the panel may offer", () => {
  it("offers a start when nothing is going on", () => {
    expect(selectCoolifySetupCapabilities(IDLE)).toMatchObject({
      canStart: true,
      canCancel: false,
    });
  });

  it("refuses a second start, which is what the machine would say anyway", () => {
    // Offering it means the answer to pressing it is an error rather than an
    // install, and the transition already refuses with "already-running".
    expect(selectCoolifySetupCapabilities(running()).canStart).toBe(false);
  });

  it("offers a cancel only while there is something to stop", () => {
    expect(selectCoolifySetupCapabilities(running()).canCancel).toBe(true);
    expect(selectCoolifySetupCapabilities(IDLE).canCancel).toBe(false);
  });

  it("stops offering a cancel once one has been asked for", () => {
    expect(selectCoolifySetupCapabilities(running(true)).canCancel).toBe(false);
  });
});
