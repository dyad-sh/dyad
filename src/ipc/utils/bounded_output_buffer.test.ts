import { describe, expect, it } from "vitest";
import {
  BoundedOutputBuffer,
  OUTPUT_TRUNCATION_MARKER,
} from "./bounded_output_buffer";

describe("BoundedOutputBuffer", () => {
  it("keeps only the newest bytes from very large output", () => {
    const output = new BoundedOutputBuffer(16);

    output.append("a".repeat(1_000_000));
    output.append("0123456789abcdef");

    expect(output.byteLength).toBe(16);
    expect(output.wasTruncated).toBe(true);
    expect(output.toString()).toBe(
      OUTPUT_TRUNCATION_MARKER + "0123456789abcdef",
    );
  });

  it("wraps small appends around the ring and reassembles them in order", () => {
    const output = new BoundedOutputBuffer(8);

    output.append("abcde");
    // Crosses the physical end of the ring: "fgh" lands at the tail and "ij"
    // wraps to the front, so toString() must stitch the two regions together.
    output.append("fghij");

    expect(output.byteLength).toBe(8);
    expect(output.wasTruncated).toBe(true);
    expect(output.toString()).toBe(OUTPUT_TRUNCATION_MARKER + "cdefghij");
  });

  it("does not report truncation when small appends exactly fill the ring", () => {
    const output = new BoundedOutputBuffer(8);

    output.append("abcde");
    output.append("fgh");

    expect(output.byteLength).toBe(8);
    expect(output.wasTruncated).toBe(false);
    expect(output.toString()).toBe("abcdefgh");
  });

  it("reconstructs UTF-8 characters split across Buffer chunks", () => {
    const output = new BoundedOutputBuffer(64);
    const encoded = Buffer.from("start 🙂 end");

    output.append(encoded.subarray(0, 8));
    output.append(encoded.subarray(8, 10));
    output.append(encoded.subarray(10));

    expect(output.toString()).toBe("start 🙂 end");
  });

  it("does not emit a replacement character when eviction splits UTF-8", () => {
    const output = new BoundedOutputBuffer(4);

    output.append("x🙂y");

    expect(output.toString()).toBe(OUTPUT_TRUNCATION_MARKER + "y");
    expect(output.toString()).not.toContain("�");
  });

  it("releases retained chunks when cleared", () => {
    const output = new BoundedOutputBuffer(8);
    output.append("0123456789");

    output.clear();

    expect(output.byteLength).toBe(0);
    expect(output.wasTruncated).toBe(false);
    expect(output.toString()).toBe("");
  });
});
