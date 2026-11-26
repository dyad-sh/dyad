import { describe, expect, it } from "vitest";
import {
  deserializeSandboxWorkerError,
  serializeSandboxWorkerError,
} from "./worker_protocol";

describe("sandbox worker error serialization", () => {
  it("keeps the nested errors of an AggregateError across the worker boundary", () => {
    const original = new AggregateError(
      [new Error("The specified module could not be found.")],
      "Unable to locate a MustardScript native addon for win32-x64-msvc",
    );

    // The worker posts plain data, so round-trip through structured clone.
    const restored = deserializeSandboxWorkerError(
      structuredClone(serializeSandboxWorkerError(original)),
    );

    expect(restored).toBeInstanceOf(AggregateError);
    expect(restored.message).toBe(original.message);
    expect((restored as AggregateError).errors.map((e) => e.message)).toEqual([
      "The specified module could not be found.",
    ]);
  });

  it("leaves ordinary errors as plain errors", () => {
    const restored = deserializeSandboxWorkerError(
      serializeSandboxWorkerError(new TypeError("boom")),
    );
    expect(restored).not.toBeInstanceOf(AggregateError);
    expect(restored.name).toBe("TypeError");
    expect(restored.message).toBe("boom");
  });
});
