import { afterEach, describe, expect, it } from "vitest";
import {
  countTrackedSupabaseSelfHostedProjects,
  listPendingSupabaseSelfHostedFunctionUpdates,
  recordSupabaseSelfHostedFunctionDelete,
  recordSupabaseSelfHostedFunctionDeploy,
  resetSupabaseSelfHostedFunctionUpdates,
} from "./supabase_self_hosted_function_updates";

const T0 = 1_795_000_000_000;
const LIFETIME = 400_000;

afterEach(() => resetSupabaseSelfHostedFunctionUpdates());

function deploy(
  functionName: string,
  replacedExisting: boolean,
  nowMs: number,
  projectId = "instance-1",
) {
  recordSupabaseSelfHostedFunctionDeploy({
    projectId,
    functionName,
    replacedExisting,
    workerLifetimeMs: LIFETIME,
    nowMs,
  });
}

describe("pending self-hosted function updates", () => {
  it("is live by the deploy time plus the worker lifetime", () => {
    deploy("send-email", true, T0);

    expect(
      listPendingSupabaseSelfHostedFunctionUpdates("instance-1", T0 + 1),
    ).toEqual([{ functionName: "send-email", liveByMs: T0 + LIFETIME }]);
    expect(listPendingSupabaseSelfHostedFunctionUpdates("other", T0)).toEqual(
      [],
    );
  });

  it("drops an update once its deadline has passed", () => {
    deploy("send-email", true, T0);

    expect(
      listPendingSupabaseSelfHostedFunctionUpdates("instance-1", T0 + LIFETIME),
    ).toEqual([]);
  });

  it("moves the deadline with each redeploy and lists the soonest first", () => {
    deploy("send-email", true, T0);
    deploy("charge", true, T0 + 1_000);
    deploy("send-email", true, T0 + 2_000);

    expect(
      listPendingSupabaseSelfHostedFunctionUpdates("instance-1", T0 + 3_000),
    ).toEqual([
      { functionName: "charge", liveByMs: T0 + 1_000 + LIFETIME },
      { functionName: "send-email", liveByMs: T0 + 2_000 + LIFETIME },
    ]);
  });

  it("treats a new function as live at once", () => {
    deploy("send-email", false, T0);

    expect(
      listPendingSupabaseSelfHostedFunctionUpdates("instance-1", T0),
    ).toEqual([]);
  });

  it("waits out a deleted function's worker when the name comes back", () => {
    recordSupabaseSelfHostedFunctionDelete({
      projectId: "instance-1",
      functionName: "send-email",
      workerLifetimeMs: LIFETIME,
      nowMs: T0,
    });
    deploy("send-email", false, T0 + 10_000);

    expect(
      listPendingSupabaseSelfHostedFunctionUpdates("instance-1", T0 + 10_000),
    ).toEqual([{ functionName: "send-email", liveByMs: T0 + LIFETIME }]);
  });

  it("forgets a deletion once its worker must have ended", () => {
    recordSupabaseSelfHostedFunctionDelete({
      projectId: "instance-1",
      functionName: "send-email",
      workerLifetimeMs: LIFETIME,
      nowMs: T0,
    });
    deploy("send-email", false, T0 + LIFETIME);

    expect(
      listPendingSupabaseSelfHostedFunctionUpdates("instance-1", T0 + LIFETIME),
    ).toEqual([]);
  });

  it("forgets deletions and updates once their time has passed", () => {
    deploy("send-email", true, T0);
    recordSupabaseSelfHostedFunctionDelete({
      projectId: "instance-2",
      functionName: "charge",
      workerLifetimeMs: LIFETIME,
      nowMs: T0,
    });

    listPendingSupabaseSelfHostedFunctionUpdates("instance-1", T0 + LIFETIME);
    listPendingSupabaseSelfHostedFunctionUpdates("instance-2", T0 + LIFETIME);

    expect(countTrackedSupabaseSelfHostedProjects()).toBe(0);
  });

  it("clears a pending update when the function is deleted", () => {
    deploy("send-email", true, T0);
    recordSupabaseSelfHostedFunctionDelete({
      projectId: "instance-1",
      functionName: "send-email",
      workerLifetimeMs: LIFETIME,
      nowMs: T0 + 1_000,
    });

    expect(
      listPendingSupabaseSelfHostedFunctionUpdates("instance-1", T0 + 2_000),
    ).toEqual([]);
  });
});
