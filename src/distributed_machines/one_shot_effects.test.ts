import { describe, expect, it, vi } from "vitest";
import {
  defineCorrelatedEffectHandlers,
  runCorrelatedEffect,
} from "./one_shot_effects";

type Command = {
  readonly type: "GENERATE";
  readonly operationId: string;
};

type Event =
  | { readonly type: "SUCCEEDED"; readonly operationId: string }
  | {
      readonly type: "FAILED";
      readonly operationId: string;
      readonly message: string;
    }
  | { readonly type: "CANCELLED"; readonly operationId: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function harness(
  run: (command: Command, signal: AbortSignal) => Promise<string>,
) {
  const send = vi.fn();
  const reportUnexpected = vi.fn();
  const handlers = defineCorrelatedEffectHandlers<Command, Event>()({
    GENERATE: {
      correlation: (command) => command.operationId,
      disposal: "abort-and-settle",
      run: (command, { signal }) => run(command, signal),
      succeeded: (command) => ({
        type: "SUCCEEDED",
        operationId: command.operationId,
      }),
      failed: (command, failure) => ({
        type: "FAILED",
        operationId: command.operationId,
        message: failure as string,
      }),
      cancelled: (command) => ({
        type: "CANCELLED",
        operationId: command.operationId,
      }),
      classifyFailure: (error) =>
        error === "provider"
          ? { kind: "expected", failure: "provider failed" }
          : { kind: "unexpected", failure: "unexpected failure" },
    },
  });
  const sink = {
    actor: {
      actorInstanceId: "actor:1",
      snapshotRevision: 0,
      transactionSequence: 0,
    },
    admissionGeneration: { ordinal: 1, identity: {} },
    send,
  };
  return { handlers, reportUnexpected, send, sink };
}

describe("runCorrelatedEffect", () => {
  const command: Command = { type: "GENERATE", operationId: "runtime:1" };

  it("settles cancellation before the effect starts without scheduling it", async () => {
    const run = vi.fn(async () => "image");
    const { handlers, send, sink } = harness(run);
    const controller = new AbortController();
    controller.abort();

    await runCorrelatedEffect({
      command,
      handlers,
      sink,
      signal: controller.signal,
    });

    expect(run).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      type: "CANCELLED",
      operationId: "runtime:1",
    });
  });

  it("settles cancellation during execution exactly once", async () => {
    const result = deferred<string>();
    const { handlers, send, sink } = harness(() => result.promise);
    const controller = new AbortController();
    const execution = runCorrelatedEffect({
      command,
      handlers,
      sink,
      signal: controller.signal,
    });

    controller.abort();
    result.resolve("image");
    await execution;

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      type: "CANCELLED",
      operationId: "runtime:1",
    });
  });

  it("maps expected provider failures to a typed terminal event", async () => {
    const { handlers, send, sink } = harness(async () => {
      throw "provider";
    });

    await runCorrelatedEffect({ command, handlers, sink });

    expect(send).toHaveBeenCalledWith({
      type: "FAILED",
      operationId: "runtime:1",
      message: "provider failed",
    });
  });

  it("reports unexpected throws while preserving correlated settlement", async () => {
    const failure = new Error("dependency broke");
    const { handlers, reportUnexpected, send, sink } = harness(async () => {
      throw failure;
    });

    await runCorrelatedEffect({
      command,
      handlers,
      sink,
      reportUnexpected,
    });

    expect(reportUnexpected).toHaveBeenCalledWith(failure);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      type: "FAILED",
      operationId: "runtime:1",
      message: "unexpected failure",
    });
  });
});
