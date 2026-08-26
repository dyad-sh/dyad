import { describe, expect, it } from "vitest";
import { selectCoolifySetupCapabilities } from "./capabilities";
import { coolifySetupTransition } from "./transition";
import { IDLE, type CoolifySetupState } from "./state";
import type { SetupResult } from "@/ipc/types/coolify_setup";

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

const RESULT: SetupResult = {
  dashboardUrl: "https://203.0.113.5.sslip.io",
  secure: true,
  insecureReason: null,
  adminEmail: "me@gmail.com",
  adminPassword: "Abc123@xyz",
  tokenStored: true,
  tokenUnavailableReason: null,
  version: "4.3.2",
};

const done = (): CoolifySetupState => ({
  type: "done",
  host: "203.0.113.5",
  invocationRef: REF,
  result: RESULT,
});

const failed = (): CoolifySetupState => ({
  type: "failed",
  host: "203.0.113.5",
  invocationRef: REF,
  message: "boom",
  log: "output",
  cancelled: false,
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

describe("against what the machine would actually do", () => {
  it("offers a start exactly when the transition would take one", () => {
    // Two statements of one rule, in two files. Offering a start the machine
    // refuses turns a button into an error message; refusing one it would
    // take strands the user on a screen with nothing to press. The gate that
    // guards installing again reads this selector too, so drift here is not
    // only cosmetic.
    for (const state of [IDLE, running(), running(true), done(), failed()]) {
      const taken =
        coolifySetupTransition(state, {
          type: "start-requested",
          invocationRef: {
            kind: "coolify-setup",
            entityKey: "198.51.100.9",
            operationId: "op-9",
          },
          target: {
            host: "198.51.100.9",
            username: "root",
            adminEmail: "me@gmail.com",
          },
        }).kind === "applied";
      expect({
        state: state.type,
        canStart: selectCoolifySetupCapabilities(state).canStart,
      }).toEqual({ state: state.type, canStart: taken });
    }
  });
});
