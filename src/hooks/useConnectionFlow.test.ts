import { describe, expect, it } from "vitest";
import {
  DISCONNECTED_FLOW_STATE,
  type ConnectionFlowState,
} from "@/connection_flow/state";
import { mergeConnectionFlowSnapshots } from "./useConnectionFlow";

describe("mergeConnectionFlowSnapshots", () => {
  it("never replaces a pushed provider state with an older refresh response", () => {
    const pushed: ConnectionFlowState = {
      status: "awaiting-return",
      revision: 6,
      provider: "neon",
      invocationRef: {
        kind: "connection-flow",
        entityKey: "neon",
        operationId: "newer",
      },
    };
    const delayed: ConnectionFlowState = {
      status: "disconnected",
      revision: 5,
    };
    const current = {
      github: DISCONNECTED_FLOW_STATE,
      supabase: DISCONNECTED_FLOW_STATE,
      neon: pushed,
    };

    const merged = mergeConnectionFlowSnapshots(current, {
      ...current,
      neon: delayed,
    });

    expect(merged.neon).toBe(pushed);
  });
});
