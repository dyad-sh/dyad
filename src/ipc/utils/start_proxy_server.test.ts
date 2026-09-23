import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { startProxy } from "./start_proxy_server";
import { createHeadlessProxyModule } from "@/testing/headless_proxy_server";

const { createWorker } = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock("worker_threads", () => ({
  Worker: createWorker,
  default: { Worker: createWorker },
}));
vi.mock("node:worker_threads", () => ({
  Worker: createWorker,
  default: { Worker: createWorker },
}));

describe.each([
  ["packaged", startProxy],
  ["headless", createHeadlessProxyModule().startProxy],
] as const)("%s proxy failure reporting", (_name, launch) => {
  let worker: EventEmitter;
  beforeEach(() => {
    worker = new EventEmitter();
    createWorker.mockImplementation(function () {
      return worker;
    });
  });

  async function start(signal?: AbortSignal) {
    const onError = vi.fn();
    await launch("http://localhost:3000", {
      port: 42142,
      hostname: "app-42.localhost",
      authBootstrapToken: "token",
      onError,
      signal,
    });
    return onError;
  }

  it.each(["bind", "crash"] as const)(
    "reports a %s failure once even when exit follows",
    async (failure) => {
      const onError = await start();
      if (failure === "bind")
        worker.emit("message", "proxy-server-error: occupied");
      else worker.emit("error", new Error("crashed"));
      worker.emit("exit", 1);
      expect(onError).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          kind:
            failure === "bind"
              ? DyadErrorKind.Conflict
              : DyadErrorKind.External,
        }),
      );
    },
  );

  it("reports an unexpected pre-ready exit but suppresses intentional cancellation", async () => {
    const onError = await start();
    worker.emit("exit", 0);
    expect(onError).toHaveBeenCalledOnce();
    const controller = new AbortController();
    const cancelledError = await start(controller.signal);
    controller.abort();
    worker.emit("exit", 1);
    expect(cancelledError).not.toHaveBeenCalled();
  });
});
