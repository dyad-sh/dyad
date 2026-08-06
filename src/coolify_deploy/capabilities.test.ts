import { describe, expect, it } from "vitest";
import { assertCapabilityTransitionConsistency } from "@/state_machines/testing";
import { selectCoolifyDeployCapabilities } from "./capabilities";
import { transition } from "./transition";
import {
  COOLIFY_DEPLOY_INVOCATION_KIND,
  type CoolifyDeployEvent,
  type CoolifyDeployState,
} from "./state";

const APP_ID = 1;

const invocationRef = {
  kind: COOLIFY_DEPLOY_INVOCATION_KIND,
  entityKey: APP_ID,
  operationId: "coolify-deploy:1",
} as const;

const states: CoolifyDeployState[] = [
  { type: "idle" },
  {
    type: "running",
    appId: APP_ID,
    invocationRef,
    stage: "building",
    log: "",
    startedAt: 1,
    deploymentUuid: "dep-1",
  },
  {
    type: "succeeded",
    appId: APP_ID,
    log: "",
    url: "https://app.example.com",
    finishedAt: 2,
  },
  {
    type: "failed",
    appId: APP_ID,
    log: "",
    error: "boom",
    finishedAt: 2,
    deploymentUuid: "dep-1",
  },
];

const deployRequested: CoolifyDeployEvent = {
  type: "DEPLOY_REQUESTED",
  appId: APP_ID,
  invocationRef: { ...invocationRef, operationId: "coolify-deploy:2" },
  startedAt: 3,
};

describe("coolify_deploy capabilities", () => {
  it("keeps every enabled control consistent with the transition", () => {
    expect(() =>
      assertCapabilityTransitionConsistency({
        states,
        // canEditConnection guards a database write rather than a machine
        // event, so there is no transition for it to agree with.
        selectCapabilities: (state: CoolifyDeployState) => ({
          canDeploy: selectCoolifyDeployCapabilities(state).canDeploy,
        }),
        transition,
        cases: {
          canDeploy: {
            representativeEvents: () => ({ valid: [deployRequested] }),
            disabledReason: "already-running",
          },
        },
      }),
    ).not.toThrow();
  });

  it("blocks deploying and editing the connection only while one is running", () => {
    const running = states.find((s) => s.type === "running")!;
    expect(selectCoolifyDeployCapabilities(running)).toEqual({
      canDeploy: false,
      canEditConnection: false,
    });
    // Every other state allows both, including the two terminal ones — which
    // is what "only while one is running" claims.
    for (const state of states.filter((s) => s.type !== "running")) {
      expect(selectCoolifyDeployCapabilities(state)).toEqual({
        canDeploy: true,
        canEditConnection: true,
      });
    }
  });
});

describe("canEditConnection guards the handler, not just the form", () => {
  it("is false while a deploy is running, which is when retargeting strands it", () => {
    const running = states.find((s) => s.type === "running")!;
    expect(selectCoolifyDeployCapabilities(running).canEditConnection).toBe(
      false,
    );
  });
});
