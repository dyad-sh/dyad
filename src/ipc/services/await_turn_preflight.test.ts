import { expect, it, vi } from "vitest";
import { awaitTurnPreflight } from "./await_turn_preflight";

it("cancels a waiter promptly while shared work can still finish", async () => {
  const controller = new AbortController();
  let finish!: (value: string) => void;
  const work = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const waiting = awaitTurnPreflight(work, controller.signal);
  const rejected = expect(waiting).rejects.toThrow("stopped");
  controller.abort(new Error("stopped"));
  await rejected;
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  finish("ready");
  expect(await work).toBe("ready");
});

it("consumes late failures after cancellation", async () => {
  const controller = new AbortController();
  let fail!: (error: Error) => void;
  const work = new Promise<never>((_, reject) => {
    fail = reject;
  });
  controller.abort(new Error("stopped"));
  await expect(awaitTurnPreflight(work, controller.signal)).rejects.toThrow(
    "stopped",
  );
  fail(new Error("late failure"));
  await Promise.resolve();
});
