import { describe, it, expect } from "vitest";
import { constructLocalAgentPrompt } from "@/prompts/local_agent_prompt";

describe("local_agent_prompt", () => {
  it("agent mode system prompt", () => {
    const prompt = constructLocalAgentPrompt(undefined);
    expect(prompt).toMatchSnapshot();
  });

  it("agent mode system prompt with code explorer available", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      codeExplorerAvailable: true,
    });
    expect(prompt).toMatchSnapshot();
    expect(prompt).toContain("Use `explore_code` first");
    expect(prompt).not.toContain("Use `grep` and `code_search`");
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

  it("agent mode system prompt with app blueprint enabled", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      enableAppBlueprint: true,
    });
    expect(prompt).toMatchSnapshot();
    expect(prompt).toContain("<app_blueprint>");
    expect(prompt).toContain("App Blueprint (new apps only)");
    expect(prompt).toContain("write_app_blueprint");
    expect(prompt).toContain("planning_questionnaire");
  });

  it("basic agent mode system prompt with app blueprint enabled", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      basicAgentMode: true,
      enableAppBlueprint: true,
    });
    expect(prompt).toMatchSnapshot();
    expect(prompt).toContain("<app_blueprint>");
    expect(prompt).toContain("App Blueprint (new apps only)");
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

  it("agent mode system prompt with app blueprint disabled", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      enableAppBlueprint: false,
    });
    expect(prompt).toMatchSnapshot();
    expect(prompt).not.toContain("<app_blueprint>");
    expect(prompt).not.toContain("App Blueprint (new apps only)");
    expect(prompt).not.toContain("write_app_blueprint");
    expect(prompt).toContain("1. **Understand:**");
    expect(prompt).toContain("based on the understanding in steps 1-2");
  });

  it("basic agent mode system prompt with app blueprint disabled", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      basicAgentMode: true,
      enableAppBlueprint: false,
    });
    expect(prompt).toMatchSnapshot();
    expect(prompt).not.toContain("<app_blueprint>");
    expect(prompt).not.toContain("App Blueprint (new apps only)");
    expect(prompt).not.toContain("write_app_blueprint");
    expect(prompt).toContain("1. **Understand:**");
    expect(prompt).toContain("based on the understanding in steps 1-2");
  });
});
