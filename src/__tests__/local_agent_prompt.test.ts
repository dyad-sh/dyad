import { describe, it, expect } from "vitest";
import { constructLocalAgentPrompt } from "../prompts/local_agent_prompt";

describe("local_agent_prompt", () => {
  it("agent mode system prompt", () => {
    const prompt = constructLocalAgentPrompt(undefined);
    expect(prompt).toMatchSnapshot();
  });

  it("basic agent mode system prompt", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      basicAgentMode: true,
    });
    expect(prompt).toMatchSnapshot();
  });

  it("ask mode system prompt", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      readOnly: true,
    });
    expect(prompt).toMatchSnapshot();
  });
});
