import { describe, it, expect } from "vitest";
import { constructLocalAgentPrompt } from "@/prompts/local_agent_prompt";

describe("local_agent_prompt", () => {
  const expectGitContextGuidance = (prompt: string) => {
    expect(prompt).toContain("<git_context>");
    expect(prompt).toContain("<dyad-git-context>");
    expect(prompt).toContain('source_commit="..." no_commit="true"');
  };

  it("agent mode system prompt", () => {
    const prompt = constructLocalAgentPrompt(undefined);
    expect(prompt).toMatchSnapshot();
    expectGitContextGuidance(prompt);
    expect(prompt).toContain(
      "Use `grep` and `code_search` when the relevant files are not reasonably clear",
    );
    expect(prompt).not.toContain("search tools extensively");
    expect(prompt).toContain(
      "Add targeted runtime logs only when runtime evidence is needed",
    );
  });

  it("agent mode system prompt with code explorer available", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      codeExplorerAvailable: true,
    });
    expect(prompt).toMatchSnapshot();
    expect(prompt).toContain('use `spawn_agent` with persona="explorer"');
    expect(prompt).toContain(
      "Continue non-conflicting root work while Explorer runs",
    );
    expect(prompt).toContain("use `wait_agents` or `list_agents`");
    expect(prompt).toContain(
      "Do not spawn duplicate Explorers for the same investigation",
    );
    expect(prompt).toContain(
      "Validate an Explorer report's exact edit targets",
    );
    expect(prompt).not.toContain("Use `grep` and `code_search`");
  });

  it("uses direct search guidance when Explorer is unavailable", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      codeExplorerAvailable: false,
    });

    expect(prompt).not.toContain('spawn_agent` with persona="explorer"');
    expect(prompt).toContain("Use `grep` and `code_search`");
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
    expectGitContextGuidance(prompt);
  });

  it("basic agent mode system prompt (vite framework includes Nitro nudge)", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      basicAgentMode: true,
      frameworkType: "vite",
    });
    expect(prompt).toMatchSnapshot();
  });

  it("agent mode omits test-writing guidance when testing is disabled", () => {
    const prompt = constructLocalAgentPrompt(undefined);
    expect(prompt).not.toContain("# Writing end-to-end tests");
  });

  it("agent mode includes test-writing guidance when testing is enabled", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      testingEnabled: true,
    });
    expect(prompt).toContain("# Writing end-to-end tests");
  });

  it("basic agent mode gates test-writing guidance on testingEnabled", () => {
    const disabled = constructLocalAgentPrompt(undefined, undefined, {
      basicAgentMode: true,
    });
    expect(disabled).not.toContain("# Writing end-to-end tests");

    const enabled = constructLocalAgentPrompt(undefined, undefined, {
      basicAgentMode: true,
      testingEnabled: true,
    });
    expect(enabled).toContain("# Writing end-to-end tests");
  });

  it("ask mode system prompt", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      readOnly: true,
    });
    expect(prompt).toMatchSnapshot();
    expectGitContextGuidance(prompt);
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
