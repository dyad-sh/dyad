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
      "Use `grep` and `list_files` when the relevant files are not reasonably clear",
    );
    expect(prompt).not.toContain("search_replace");
    expect(prompt).not.toContain("code_search");
    expect(prompt).not.toContain("explore_code");
    expect(prompt).not.toContain("explore_chat_history");
    expect(prompt).not.toContain("search tools extensively");
    expect(prompt).toContain(
      "Add targeted runtime logs only when runtime evidence is needed",
    );
    expect(prompt).toContain("<app_lifecycle>");
    expect(prompt).toContain(
      "Rely on hot reload for ordinary source, styling, and asset edits",
    );
    expect(prompt).toContain(
      "A rebuild already includes a restart, so never call both for the same reason",
    );
    expect(prompt).not.toContain(
      '<dyad-command type="restart"></dyad-command>',
    );
    expect(prompt).not.toContain(
      '<dyad-command type="rebuild"></dyad-command>',
    );
    expect(prompt).toContain('<dyad-command type="refresh"></dyad-command>');
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

  it("agent mode omits test-writing guidance when testing is disabled", () => {
    const prompt = constructLocalAgentPrompt(undefined);
    expect(prompt).not.toContain("# Keeping end-to-end tests up to date");
  });

  it("agent mode includes test-writing guidance when testing is enabled", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      testingEnabled: true,
    });
    expect(prompt).toContain("# Keeping end-to-end tests up to date");
  });

  it("ask mode system prompt", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      readOnly: true,
    });
    expect(prompt).toMatchSnapshot();
    expectGitContextGuidance(prompt);
    expect(prompt).not.toContain("<app_lifecycle>");
    expect(prompt).not.toContain("restart_app");
    expect(prompt).not.toContain("rebuild_app");
  });

  it("omits lifecycle tools that are unavailable", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      restartAppToolAvailable: false,
      rebuildAppToolAvailable: false,
    });

    expect(prompt).not.toContain("<app_lifecycle>");
    expect(prompt).not.toContain("restart_app");
    expect(prompt).not.toContain("rebuild_app");
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
});
