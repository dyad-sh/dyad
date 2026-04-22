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

  it("agent mode system prompt with mini plan disabled", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      enableMiniPlan: false,
    });
    expect(prompt).toMatchSnapshot();
    expect(prompt).not.toContain("<mini_plan>");
    expect(prompt).not.toContain("Mini Plan (new apps only)");
    expect(prompt).not.toContain("mini_plan_questionnaire");
    expect(prompt).toContain("1. **Understand:**");
    expect(prompt).toContain("based on the understanding in steps 1-2");
  });

  it("basic agent mode system prompt with mini plan disabled", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      basicAgentMode: true,
      enableMiniPlan: false,
    });
    expect(prompt).toMatchSnapshot();
    expect(prompt).not.toContain("<mini_plan>");
    expect(prompt).not.toContain("Mini Plan (new apps only)");
    expect(prompt).not.toContain("mini_plan_questionnaire");
    expect(prompt).toContain("1. **Understand:**");
    expect(prompt).toContain("based on the understanding in steps 1-2");
  });
});
