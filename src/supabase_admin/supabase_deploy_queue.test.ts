import { afterEach, describe, expect, it } from "vitest";
import {
  enqueueSupabaseDeploy,
  getSupabaseDeployQueueStatsForTests,
  resetSupabaseDeployQueuesForTests,
} from "./supabase_deploy_queue";
import { SUPABASE_DEPLOY_ACTIVE_PAYLOAD_BYTE_BUDGET } from "./supabase_deploy_limits";

describe("Supabase deploy payload scheduling", () => {
  afterEach(() => {
    resetSupabaseDeployQueuesForTests();
  });

  it("adapts cross-project concurrency to the active payload byte budget", async () => {
    const payloadBytes =
      Math.floor(SUPABASE_DEPLOY_ACTIVE_PAYLOAD_BYTE_BUDGET / 2) + 1;
    const started: string[] = [];
    let releaseFirst!: () => void;

    const first = enqueueSupabaseDeploy(
      "project-1",
      true,
      async () => {
        started.push("first");
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return "first";
      },
      { estimatedBytes: payloadBytes },
    );
    const second = enqueueSupabaseDeploy(
      "project-2",
      true,
      async () => {
        started.push("second");
        return "second";
      },
      { estimatedBytes: payloadBytes },
    );

    expect(started).toEqual(["first"]);
    expect(getSupabaseDeployQueueStatsForTests()).toMatchObject({
      projects: 2,
      active: 1,
      pending: 1,
      activePayloadBytes: payloadBytes,
    });

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      "first",
      "second",
    ]);
    expect(started).toEqual(["first", "second"]);
    expect(getSupabaseDeployQueueStatsForTests()).toEqual({
      projects: 0,
      active: 0,
      pending: 0,
      activePayloadBytes: 0,
    });
  });

  it("coalesces equivalent work and removes the project queue after it settles", async () => {
    let operationCalls = 0;
    let release!: () => void;
    const operation = async () => {
      operationCalls++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "done";
    };

    const first = enqueueSupabaseDeploy("project-1", true, operation, {
      estimatedBytes: 100,
      coalesceKey: "same-source-signature",
    });
    const duplicate = enqueueSupabaseDeploy("project-1", true, operation, {
      estimatedBytes: 100,
      coalesceKey: "same-source-signature",
    });

    expect(duplicate).toBe(first);
    expect(operationCalls).toBe(1);
    release();
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      "done",
      "done",
    ]);
    expect(operationCalls).toBe(1);
    expect(getSupabaseDeployQueueStatsForTests().projects).toBe(0);
  });
});
