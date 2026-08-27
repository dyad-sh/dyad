import { describe, it, expect } from "vitest";
import {
  constructBuildAgentPrompt,
  constructImplementerPrompt,
  constructLocalAgentPrompt,
  resolveImplementerProvider,
} from "@/prompts/local_agent_prompt";
import {
  SUPABASE_DISCONNECTED_SYSTEM_PROMPT,
  SUPABASE_GRANTS_AND_RLS_RULE,
  SUPABASE_IMPLEMENTER_NO_MANUAL_MIGRATIONS_RULE,
  SUPABASE_IMPLEMENTER_RLS_RULE,
  SUPABASE_SERVICE_ROLE_BROWSER_RULE,
} from "@/prompts/supabase_prompt";
import {
  NEON_NO_BROWSER_DATABASE_URL_RULE,
  NEON_NO_BROWSER_SERVERLESS_RULE,
  NEON_NO_CUSTOM_AUTH_RULE,
  NEON_IMPLEMENTER_NO_MANUAL_MIGRATIONS_RULE,
  NEON_RLS_REQUIRES_JWT_RULE,
} from "@/prompts/neon_prompt";

describe("local_agent_prompt", () => {
  const expectGitContextGuidance = (prompt: string) => {
    expect(prompt).toContain("<git_context>");
    expect(prompt).toContain("<dyad-git-context>");
    expect(prompt).toContain('source_commit="..." no_commit="true"');
  };

  it("keeps Supabase safety invariants in the disconnected root prompt", () => {
    expect(SUPABASE_DISCONNECTED_SYSTEM_PROMPT).toContain(
      SUPABASE_SERVICE_ROLE_BROWSER_RULE,
    );
    expect(SUPABASE_DISCONNECTED_SYSTEM_PROMPT).toContain(
      SUPABASE_GRANTS_AND_RLS_RULE,
    );
    expect(SUPABASE_DISCONNECTED_SYSTEM_PROMPT).toContain(
      SUPABASE_IMPLEMENTER_RLS_RULE,
    );
    expect(SUPABASE_DISCONNECTED_SYSTEM_PROMPT).toContain(
      "Never create or edit files under `supabase/migrations/`",
    );
  });

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
    // Delegation is the default and every assignment carries the form —
    // MUST HOLD is the field that makes an omitted project rule visible.
    expect(enabled).toContain(
      "Implementation is the Implementer's job by default",
    );
    expect(enabled).toContain("MUST HOLD:");
    expect(enabled).toContain("Its report must address each MUST HOLD item");
    expect(enabled).toContain("These are advisory");
    expect(enabled).toContain("inspect the complete actual diff");
    expect(enabled).toContain("You remain responsible for the result");
  });

  it("builds a focused Implementer prompt with app and Supabase rules", () => {
    const prompt = constructImplementerPrompt("# App Rules\n- Use foo.", {
      provider: "supabase",
      supabaseConnected: true,
    });

    expect(prompt).toContain("You are Dyad Implementer");
    expect(prompt).toContain('<provider_invariants provider="supabase">');
    expect(prompt).toContain(SUPABASE_SERVICE_ROLE_BROWSER_RULE);
    expect(prompt).toContain(SUPABASE_GRANTS_AND_RLS_RULE);
    expect(prompt).toContain(SUPABASE_IMPLEMENTER_RLS_RULE);
    expect(prompt).toContain(SUPABASE_IMPLEMENTER_NO_MANUAL_MIGRATIONS_RULE);
    expect(prompt).toContain("SQL execution, dependency installation");
    expect(prompt).toContain("# App Rules\n- Use foo.");
    expect(prompt).toContain(
      "its current on-disk contents supersede this snapshot",
    );
    expect(prompt).toContain("Address every MUST HOLD item");
    expect(prompt).not.toContain("set_chat_summary");
    expect(prompt).not.toContain("planning_questionnaire");
    expect(prompt).not.toContain("execute SQL");
    expect(prompt).not.toContain("dyad-execute-sql");
    expect(prompt).not.toContain("add_integration");
  });

  it("keeps Supabase safety rules without claiming disconnected tools work", () => {
    const prompt = constructImplementerPrompt(undefined, {
      provider: "supabase",
      supabaseConnected: false,
    });

    expect(prompt).toContain(SUPABASE_GRANTS_AND_RLS_RULE);
    expect(prompt).toContain("The Supabase account is disconnected");
    expect(prompt).not.toContain("The app is connected to Supabase");
    expect(prompt).not.toContain(
      "You may inspect provider metadata and the live schema",
    );
  });

  it("warns a plain Vite Implementer that no app server runtime exists", () => {
    const prompt = constructImplementerPrompt(undefined, {
      frameworkType: "vite",
    });

    expect(prompt).toContain('framework="vite"');
    expect(prompt).toContain("no application server runtime");
    expect(prompt).toContain("report the need for a server layer");
    expect(prompt).toContain("Supabase Edge Functions are the only exception");
  });

  it("does not add the no-server warning after Nitro is enabled", () => {
    const prompt = constructImplementerPrompt(undefined, {
      frameworkType: "vite-nitro",
    });

    expect(prompt).not.toContain("no application server runtime");
  });

  it("gives Neon Implementers critical code-writing invariants", () => {
    const prompt = constructImplementerPrompt(undefined, {
      provider: "neon",
      neonToolsAvailable: true,
      neonEmailVerificationEnabled: true,
    });

    expect(prompt).toContain('<provider_invariants provider="neon">');
    expect(prompt).toContain(NEON_NO_CUSTOM_AUTH_RULE);
    expect(prompt).toContain(NEON_IMPLEMENTER_NO_MANUAL_MIGRATIONS_RULE);
    expect(prompt).toContain(NEON_RLS_REQUIRES_JWT_RULE);
    expect(prompt).toContain(NEON_NO_BROWSER_DATABASE_URL_RULE);
    expect(prompt).toContain(NEON_NO_BROWSER_SERVERLESS_RULE);
    expect(prompt).toContain(
      '`read_guide` tool with guide="add-authentication"',
    );
    expect(prompt).toContain('guide="add-email-verification"');
    expect(prompt).toContain('guide="add-password-reset"');
    expect(prompt).toContain("Never hand-roll a reset-token flow");
    expect(prompt).not.toContain("execute SQL");
    expect(prompt).not.toContain("dyad-execute-sql");
  });

  it("omits the Neon email-verification guide when it is disabled", () => {
    const prompt = constructImplementerPrompt(undefined, {
      provider: "neon",
      neonToolsAvailable: true,
      neonEmailVerificationEnabled: false,
    });

    expect(prompt).not.toContain('guide="add-email-verification"');
  });

  it("does not promise Neon provider tools without branch context", () => {
    const prompt = constructImplementerPrompt(undefined, {
      provider: "neon",
      neonToolsAvailable: false,
    });

    expect(prompt).toContain("Neon branch context is unavailable");
    expect(prompt).not.toContain(
      "You may inspect provider metadata and the live schema",
    );
  });

  it("keeps root-owned operation boundaries without a provider", () => {
    const prompt = constructImplementerPrompt(undefined);

    expect(prompt).toContain(
      "SQL execution, dependency installation, provider configuration, and deployment are root-owned operations",
    );
    expect(prompt).not.toContain("<provider_invariants");
  });

  it("selects Implementer safety guidance from the app provider association", () => {
    expect(
      resolveImplementerProvider({
        hasSupabaseProject: true,
        hasNeonProject: false,
      }),
    ).toBe("supabase");
    expect(
      resolveImplementerProvider({
        hasSupabaseProject: true,
        hasNeonProject: true,
      }),
    ).toBe("supabase");
    expect(
      resolveImplementerProvider({
        hasSupabaseProject: false,
        hasNeonProject: true,
      }),
    ).toBe("neon");
    expect(
      resolveImplementerProvider({
        hasSupabaseProject: false,
        hasNeonProject: false,
      }),
    ).toBeUndefined();
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

  it("includes lifecycle guidance in the Build prompt", () => {
    const prompt = constructBuildAgentPrompt(undefined);

    expect(prompt).toContain("<app_lifecycle>");
    expect(prompt).toContain("restart_app");
    expect(prompt).toContain("reinstall_and_restart_app");
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

describe("build agent prompt", () => {
  it("describes the curated agentic workflow without excluded tools", () => {
    const prompt = constructBuildAgentPrompt(undefined, undefined, {
      frameworkType: "vite",
      enableAppBlueprint: true,
    });

    expect(prompt).toMatchSnapshot();
    expect(prompt).toContain("<tool_calling>");
    expect(prompt).toContain("`grep` and `list_files`");
    expect(prompt).toContain("`planning_questionnaire`");
    expect(prompt).toContain("`update_todos`");
    expect(prompt).toContain("write_app_blueprint");
    expect(prompt).toContain("<git_context>");
    expect(prompt).not.toContain("provided Git inspection tools");
    for (const unavailableTool of [
      "spawn_agent",
      "web_search",
      "read_logs",
      "run_build",
      "run_type_checks",
      "run_tests",
      "run_pre_commit",
      "execute_sandbox_script",
      "search_chats",
      "generate_image",
    ]) {
      expect(prompt).not.toContain(unavailableTool);
    }
  });
});
