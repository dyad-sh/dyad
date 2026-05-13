import { describe, it, expect } from "vitest";
import { constructLocalAgentPrompt } from "../prompts/local_agent_prompt";

describe("local_agent_prompt", () => {
  it("agent mode system prompt", () => {
    const prompt = constructLocalAgentPrompt(undefined);
    expect(prompt).toMatchSnapshot();
  });

  it("agent mode system prompt (vite framework includes Nitro nudge)", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      frameworkType: "vite",
    });
    expect(prompt).toMatchSnapshot();
  });

  it("agent mode system prompt (vite + supabase suppresses Nitro nudge)", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      frameworkType: "vite",
      hasSupabaseProject: true,
    });
    expect(prompt).not.toContain("<server_layer>");
    expect(prompt).not.toContain("enable_nitro");
  });

  it("basic agent mode system prompt", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      basicAgentMode: true,
    });
    expect(prompt).toMatchSnapshot();
  });

  it("basic agent mode system prompt (vite framework includes Nitro nudge)", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      basicAgentMode: true,
      frameworkType: "vite",
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
