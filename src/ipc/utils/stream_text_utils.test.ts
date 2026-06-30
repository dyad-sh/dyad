import { describe, expect, it } from "vitest";
import { fastTextOutput } from "./stream_text_utils";

describe("fastTextOutput", () => {
  it("returns the text length (a number) as the partial output", async () => {
    const output = fastTextOutput();
    const result = await output.parsePartialOutput({ text: "hello" });
    expect(result).toEqual({ partial: 5 });
    expect(typeof (result as { partial: unknown }).partial).toBe("number");
  });

  it("produces a value that grows as the accumulated text grows", async () => {
    const output = fastTextOutput();
    const shorter = await output.parsePartialOutput({ text: "ab" });
    const longer = await output.parsePartialOutput({ text: "abcd" });
    const shorterPartial = (shorter as unknown as { partial: number }).partial;
    const longerPartial = (longer as unknown as { partial: number }).partial;
    expect(longerPartial).toBeGreaterThan(shorterPartial);
  });

  it("preserves the base Output.text() behavior", async () => {
    const output = fastTextOutput() as unknown as {
      name: string;
      responseFormat: Promise<unknown>;
      parseCompleteOutput: (opts: { text: string }) => Promise<string>;
    };
    expect(output.name).toBe("text");
    await expect(output.responseFormat).resolves.toEqual({ type: "text" });
    // Completion still yields the full text, not the length.
    await expect(
      output.parseCompleteOutput({ text: "full response" }),
    ).resolves.toBe("full response");
  });
});
