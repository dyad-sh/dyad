import { describe, expect, it } from "vitest";
import { RemoteMachineTransportError } from "@/distributed_machines/remote_client";
import { classifyGithubOpsRequestFailure } from "./request_actor";

describe("classifyGithubOpsRequestFailure", () => {
  it("retries only a recoverable disconnect with stable identity", () => {
    expect(
      classifyGithubOpsRequestFailure(
        new RemoteMachineTransportError("disconnected", "offline"),
      ),
    ).toEqual({
      kind: "disconnect",
      retryable: true,
      admission: "unknown",
    });
    expect(
      classifyGithubOpsRequestFailure(
        new RemoteMachineTransportError("incompatible", "upgrade required"),
      ),
    ).toEqual({
      kind: "disconnect",
      retryable: false,
      admission: "unknown",
    });
    expect(
      classifyGithubOpsRequestFailure(
        new RemoteMachineTransportError("renderer-destroyed", "window closed"),
      ),
    ).toEqual({
      kind: "disconnect",
      retryable: false,
      admission: "unknown",
    });
  });

  it("reports invalid payloads and non-transport failures as unexpected", () => {
    expect(
      classifyGithubOpsRequestFailure(
        new RemoteMachineTransportError("invalid-payload", "invalid response"),
      ),
    ).toEqual({ kind: "unexpected" });
    expect(classifyGithubOpsRequestFailure(new Error("bug"))).toEqual({
      kind: "unexpected",
    });
  });
});
