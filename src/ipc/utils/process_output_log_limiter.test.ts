import { describe, expect, it } from "vitest";
import { ProcessOutputLogLimiter } from "./process_output_log_limiter";

function createLimiter(options: {
  maxChunksPerWindow?: number;
  maxChunkChars?: number;
}) {
  let now = 0;
  const limiter = new ProcessOutputLogLimiter({
    windowMs: 1000,
    now: () => now,
    ...options,
  });
  return {
    limiter,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("ProcessOutputLogLimiter", () => {
  it("admits chunks up to the per-window limit", () => {
    const { limiter } = createLimiter({ maxChunksPerWindow: 2 });

    expect(limiter.admit("a")).toEqual({ message: "a", suppressedNote: null });
    expect(limiter.admit("b")).toEqual({ message: "b", suppressedNote: null });
    expect(limiter.admit("c")).toBeNull();
    expect(limiter.admit("dd")).toBeNull();
  });

  it("reports suppressed chunks on the first admitted chunk of the next window", () => {
    const { limiter, advance } = createLimiter({ maxChunksPerWindow: 1 });

    limiter.admit("a");
    limiter.admit("bb");
    limiter.admit("ccc");
    advance(1000);

    expect(limiter.admit("d")).toEqual({
      message: "d",
      suppressedNote: "suppressed 2 output chunk(s) (5 chars) from the log",
    });
    advance(1000);
    expect(limiter.admit("e")?.suppressedNote).toBeNull();
  });

  it("reports suppressed chunks on demand, once", () => {
    const { limiter } = createLimiter({ maxChunksPerWindow: 1 });

    limiter.admit("a");
    limiter.admit("b");

    expect(limiter.takeSuppressedNote()).toBe(
      "suppressed 1 output chunk(s) (1 chars) from the log",
    );
    expect(limiter.takeSuppressedNote()).toBeNull();
  });

  it("truncates long chunks", () => {
    const { limiter } = createLimiter({ maxChunkChars: 4 });

    expect(limiter.admit("abcdefgh")?.message).toBe(
      "abcd… [4 more chars truncated]",
    );
  });
});
