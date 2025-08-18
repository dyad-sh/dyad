import { describe, expect, it } from "vitest";
import { replacePromptReference } from "@/ipc/utils/replacePromptReference";

describe("replacePromptReference", () => {
  it("returns original when no references present", () => {
    const input = "Hello world";
    const output = replacePromptReference(input, {});
    expect(output).toBe(input);
  });

  it("replaces a single @prompt:id with content", () => {
    const input = "Use this: @prompt:42";
    const prompts = { 42: "Meaning of life" };
    const output = replacePromptReference(input, prompts);
    expect(output).toBe("Use this: Meaning of life");
  });

  it("replaces multiple occurrences and keeps surrounding text", () => {
    const input = "A @prompt:1 and B @prompt:2 end";
    const prompts = { 1: "One", 2: "Two" };
    const output = replacePromptReference(input, prompts);
    expect(output).toBe("A One and B Two end");
  });

  it("leaves unknown references intact", () => {
    const input = "Unknown @prompt:99 here";
    const prompts = { 1: "One" };
    const output = replacePromptReference(input, prompts);
    expect(output).toBe("Unknown @prompt:99 here");
  });

  it("supports string keys in map as well as numeric", () => {
    const input = "Mix @prompt:7 and @prompt:8";
    const prompts = { "7": "Seven", 8: "Eight" } as Record<
      string | number,
      string
    >;
    const output = replacePromptReference(input, prompts);
    expect(output).toBe("Mix Seven and Eight");
  });
});
