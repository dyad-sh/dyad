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
    expect(prompt).toContain("<app_lifecycle>");
    expect(prompt).toContain(
      "Rely on hot reload for ordinary source, styling, and asset edits",
    );
    expect(prompt).toContain(
      "Reinstalling dependencies already includes a restart, so never call both lifecycle tools for the same reason",
    );
    expect(prompt).not.toContain(
      '<dyad-command type="restart"></dyad-command>',
    );
    expect(prompt).not.toContain(
      '<dyad-command type="rebuild"></dyad-command>',
    );
    expect(prompt).toContain('<dyad-command type="refresh"></dyad-command>');
  });

  it("agent mode system prompt with code explorer available", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      codeExplorerAvailable: true,
    });
    expect(prompt).toMatchSnapshot();
    expect(prompt).toContain('Use `spawn_agent` with persona="explorer"');
    expect(prompt).toContain(
      "when the relevant files are not reasonably clear",
    );
    expect(prompt).toContain("Treat the Explorer report as a starting map");
    expect(prompt).toContain(
      "Explorer spawning waits until its report is ready",
    );
    expect(prompt).toContain(
      "Do not spawn duplicate Explorers for the same investigation",
    );
    expect(prompt).toContain(
      "Validate an Explorer report's exact edit targets",
    );
    expect(prompt).not.toContain("Use `grep` and `code_search`");
    expect(prompt).not.toContain(
      "`list_files`, `code_search`, and `read_file`",
    );
  });

  it("uses direct search guidance when Explorer is unavailable", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      codeExplorerAvailable: false,
    });

    expect(prompt).not.toContain('spawn_agent` with persona="explorer"');
    expect(prompt).toContain("Use `grep` and `code_search`");
  });

  it("includes Implementer delegation guidance only when available", () => {
    const disabled = constructLocalAgentPrompt(undefined);
    const enabled = constructLocalAgentPrompt(undefined, undefined, {
      implementerAvailable: true,
    });

    expect(disabled).not.toContain("**Implementer delegation:**");
    expect(enabled).toContain("**Implementer delegation:**");
    expect(enabled).toContain(
      'delegate straightforward, low-risk, well-scoped editing tasks to `spawn_agent` with `persona="implementer"`',
    );
    expect(enabled).toContain(
      "The root Agent remains responsible for the result",
    );
    expect(enabled).toContain(
      "An Implementer's completion status alone is not sufficient verification",
    );
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
    expect(prompt).toContain("ask up to 5 focused questions");
    expect(prompt).toContain(
      "Ask only the questions needed to resolve meaningful ambiguity",
    );
    expect(prompt).toContain("aim for 3-4 quick questions; never exceed 5");
    expect(prompt).toContain(
      "user-facing product requirements and high-level architectural needs",
    );
    expect(prompt).toContain("whether the app needs user accounts");
    expect(prompt).toContain(
      "whether it needs a database to store persistent app data",
    );
    expect(prompt).toContain(
      "Do not ask the user to choose implementation details such as frameworks, libraries, hosting platforms, database providers, authentication providers, or other technology-specific options",
    );
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

  it("gates pre-commit workflow guidance on hook availability", () => {
    const unavailable = constructLocalAgentPrompt(undefined);
    expect(unavailable).not.toContain("call `run_pre_commit`");

    for (const basicAgentMode of [false, true]) {
      const available = constructLocalAgentPrompt(undefined, undefined, {
        basicAgentMode,
        preCommitHookAvailable: true,
      });
      expect(available).toContain(
        "After finishing file edits and the other relevant verification, call `run_pre_commit`",
      );
    }
  });

  it("ask mode system prompt", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      readOnly: true,
    });
    expect(prompt).toMatchSnapshot();
    expectGitContextGuidance(prompt);
    expect(prompt).not.toContain("<app_lifecycle>");
    expect(prompt).not.toContain("restart_app");
    expect(prompt).not.toContain("reinstall_and_restart_app");
  });

  it("omits lifecycle tools that are unavailable", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      restartAppToolAvailable: false,
      reinstallAndRestartAppToolAvailable: false,
    });

    expect(prompt).not.toContain("<app_lifecycle>");
    expect(prompt).not.toContain("restart_app");
    expect(prompt).not.toContain("reinstall_and_restart_app");
  });

  it("omits production-build guidance when run_build is unavailable", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      runBuildToolAvailable: false,
    });

    expect(prompt).not.toContain("`run_build`");
  });

  it("only orders run_build after verification tools available in the turn", () => {
    const withoutOptionalVerification = constructLocalAgentPrompt(
      undefined,
      undefined,
      {
        testingEnabled: false,
        preCommitHookAvailable: false,
      },
    );
    const withOptionalVerification = constructLocalAgentPrompt(
      undefined,
      undefined,
      {
        testingEnabled: true,
        preCommitHookAvailable: true,
      },
    );

    expect(withoutOptionalVerification).toContain(
      "Run it only after edits and type checks are complete.",
    );
    expect(withoutOptionalVerification).not.toContain("`run_pre_commit`");
    expect(withOptionalVerification).toContain(
      "Run it only after edits, type checks, targeted tests, and `run_pre_commit` are complete.",
    );
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
