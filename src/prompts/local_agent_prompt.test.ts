import { describe, it, expect } from "vitest";
import {
  constructBuildAgentPrompt,
  constructImplementerPrompt,
  constructLocalAgentPrompt,
  resolveImplementerProvider,
} from "@/prompts/local_agent_prompt";
import {
  SUPABASE_DISCONNECTED_SYSTEM_PROMPT,
  SUPABASE_EDGE_FUNCTION_JWT_RULE,
  SUPABASE_GRANTS_AND_RLS_RULE,
  SUPABASE_IMPLEMENTER_NO_MANUAL_MIGRATIONS_RULE,
  SUPABASE_IMPLEMENTER_RLS_RULE,
  SUPABASE_ROOT_NO_MANUAL_MIGRATIONS_RULE,
  SUPABASE_ROOT_RLS_RULE,
  SUPABASE_SERVICE_ROLE_BROWSER_RULE,
} from "@/prompts/supabase_prompt";
import {
  NEON_DISCONNECTED_SYSTEM_PROMPT,
  NEON_NO_BROWSER_DATABASE_URL_RULE,
  NEON_NO_BROWSER_SERVERLESS_RULE,
  NEON_NO_CUSTOM_AUTH_RULE,
  NEON_IMPLEMENTER_NO_MANUAL_MIGRATIONS_RULE,
  NEON_RLS_REQUIRES_JWT_RULE,
} from "@/prompts/neon_prompt";

const expectGitContextGuidance = (prompt: string) => {
  expect(prompt).toContain("<git_context>");
  expect(prompt).toContain("Dyad may add Git provenance to a user message");
  expect(prompt).toContain(
    "identifies the app state at the start of that turn",
  );
  expect(prompt).toContain(
    "use the provided commit hash with Git inspection tools",
  );
  expect(prompt).not.toContain("<dyad-git-context>");
};

const expectBuildGitContextGuidance = (prompt: string) => {
  expect(prompt).toContain("<git_context>");
  expect(prompt).toContain("Dyad may add Git provenance to a user message");
  expect(prompt).toContain(
    "identifies the app state at the start of that turn",
  );
  expect(prompt).not.toContain("Git inspection tools");
  expect(prompt).not.toContain("<dyad-git-context>");
};

describe("local_agent_prompt", () => {
  it("keeps Supabase safety invariants in the disconnected root prompt", () => {
    expect(SUPABASE_DISCONNECTED_SYSTEM_PROMPT).toContain(
      SUPABASE_SERVICE_ROLE_BROWSER_RULE,
    );
    expect(SUPABASE_DISCONNECTED_SYSTEM_PROMPT).toContain(
      SUPABASE_EDGE_FUNCTION_JWT_RULE,
    );
    expect(SUPABASE_DISCONNECTED_SYSTEM_PROMPT).toContain(
      SUPABASE_GRANTS_AND_RLS_RULE,
    );
    expect(SUPABASE_DISCONNECTED_SYSTEM_PROMPT).toContain(
      SUPABASE_ROOT_RLS_RULE,
    );
    expect(SUPABASE_DISCONNECTED_SYSTEM_PROMPT).toContain(
      SUPABASE_ROOT_NO_MANUAL_MIGRATIONS_RULE,
    );
    expect(SUPABASE_DISCONNECTED_SYSTEM_PROMPT).not.toContain(
      "Report required schema or SQL changes to the root Agent",
    );
  });

  it("keeps Neon safety invariants in the disconnected root prompt", () => {
    expect(NEON_DISCONNECTED_SYSTEM_PROMPT).toContain(NEON_NO_CUSTOM_AUTH_RULE);
    expect(NEON_DISCONNECTED_SYSTEM_PROMPT).toContain(
      NEON_RLS_REQUIRES_JWT_RULE,
    );
    expect(NEON_DISCONNECTED_SYSTEM_PROMPT).toContain(
      NEON_NO_BROWSER_DATABASE_URL_RULE,
    );
    expect(NEON_DISCONNECTED_SYSTEM_PROMPT).toContain(
      NEON_NO_BROWSER_SERVERLESS_RULE,
    );
    expect(NEON_DISCONNECTED_SYSTEM_PROMPT).toContain("reconnect Neon");
    expect(NEON_DISCONNECTED_SYSTEM_PROMPT).toContain(
      "email-verification setting is unknown",
    );
    expect(NEON_DISCONNECTED_SYSTEM_PROMPT).toContain(
      "Do not change authentication or sign-up behavior",
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
    expect(prompt).toContain(
      "selecting **Clear Cache** to clear that app's cookies, local storage, service workers, and cached data",
    );
    expect(prompt).not.toContain("sign them out of other app previews");
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
    expect(prompt).toContain(SUPABASE_EDGE_FUNCTION_JWT_RULE);
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
    expect(prompt).toContain(
      "Supabase project metadata inspection is unavailable",
    );
    expect(prompt).toContain("Live-schema inspection is unavailable");
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

  it("includes test-writing conventions for testing-enabled apps", () => {
    const prompt = constructImplementerPrompt(undefined, {
      testingEnabled: true,
    });

    expect(prompt).toContain("e2e-tests/");
    expect(prompt).toContain(".spec.ts");
    expect(prompt).not.toContain("generate_test_assertions");
    expect(prompt).not.toContain("install it (Playwright is required");
    expect(prompt).not.toContain("ask the user to start it");
    expect(prompt).not.toContain("tell the user which flow");
    expect(prompt).toContain("report the required dev dependency");
    expect(prompt).toContain("report to the root Agent");
    expect(prompt).toContain("report the missing login prerequisite");
    expect(prompt).not.toContain(
      "build one before writing the auth-gated test",
    );
    expect(
      constructImplementerPrompt(undefined, { testingEnabled: false }),
    ).not.toContain("e2e-tests/");
  });

  it("reports verification to root when run_tests is unavailable", () => {
    const prompt = constructImplementerPrompt(undefined, {
      testingEnabled: true,
      runTestsAvailable: false,
    });

    expect(prompt).toContain("`run_tests` tool is unavailable");
    expect(prompt).not.toContain("VERIFY it with the `run_tests` tool");
    expect(prompt).not.toContain("VERIFY it with `run_tests`");
  });

  it("renders Supabase provider invariants as separate bullets", () => {
    const prompt = constructImplementerPrompt(undefined, {
      provider: "supabase",
      supabaseConnected: true,
    });

    for (const rule of [
      SUPABASE_SERVICE_ROLE_BROWSER_RULE,
      SUPABASE_GRANTS_AND_RLS_RULE,
      SUPABASE_IMPLEMENTER_RLS_RULE,
      SUPABASE_IMPLEMENTER_NO_MANUAL_MIGRATIONS_RULE,
      SUPABASE_EDGE_FUNCTION_JWT_RULE,
    ]) {
      expect(rule).toMatch(/^- /);
      expect(prompt).toContain(`\n${rule}`);
    }
  });

  it("keeps Neon identity over disconnected Supabase", () => {
    expect(
      resolveImplementerProvider({
        hasSupabaseProject: true,
        hasNeonProject: true,
      }),
    ).toBe("neon");
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

  it("does not treat unknown Neon email verification as disabled", () => {
    const prompt = constructImplementerPrompt(undefined, {
      provider: "neon",
      neonToolsAvailable: false,
    });

    expect(prompt).toContain("Email-verification state is unavailable");
    expect(prompt).toContain("do not assume it is disabled");
  });

  it("does not promise Neon provider tools without branch context", () => {
    const prompt = constructImplementerPrompt(undefined, {
      provider: "neon",
      neonToolsAvailable: false,
    });

    expect(prompt).toContain("Neon project metadata inspection is unavailable");
    expect(prompt).toContain("Live-schema inspection is unavailable");
  });

  it("describes provider read-tool consent independently", () => {
    const prompt = constructImplementerPrompt(undefined, {
      provider: "neon",
      neonToolsAvailable: true,
      neonEmailVerificationEnabled: true,
      providerMetadataReadAvailable: true,
      databaseSchemaReadAvailable: false,
      readGuideAvailable: false,
    });

    expect(prompt).toContain("read_guide` tool is unavailable");
    expect(prompt).toContain(
      "`get_neon_project_info` metadata tool is available",
    );
    expect(prompt).toContain("Live-schema inspection is unavailable");
    expect(prompt).not.toContain("MUST call the `read_guide`");
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
    ).toBe("neon");
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
    expect(prompt).toContain('<app_blueprint mode="required">');
    expect(prompt).toContain("Required App Blueprint Gate");
    expect(prompt).toContain(
      "Blueprint mode is enabled for this turn. Dyad has already determined",
    );
    expect(prompt).toContain("write_app_blueprint");
    expect(prompt).toContain("planning_questionnaire");
    expect(prompt).toContain("Ask 1-5 focused questions (usually 2-3)");
    expect(prompt).toContain(
      "Every radio or checkbox question must have 1-3 options",
    );
    expect(prompt).toContain(
      "It must successfully return the user's answers before you continue",
    );
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
    expect(prompt).not.toContain("**Clarify (when needed):**");
    expect(prompt).not.toContain("**Implement:**");
  });

  it("basic agent mode system prompt with app blueprint enabled", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      basicAgentMode: true,
      enableAppBlueprint: true,
    });
    expect(prompt).toMatchSnapshot();
    expect(prompt).toContain('<app_blueprint mode="required">');
    expect(prompt).toContain("Required App Blueprint Gate");
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
    expect(prompt).not.toContain('<app_blueprint mode="required">');
    expect(prompt).not.toContain("Required App Blueprint Gate");
    expect(prompt).not.toContain("write_app_blueprint");
    expect(prompt).toContain("1. **Understand:**");
    expect(prompt).toContain(
      "plan based on the understanding and clarification steps",
    );
  });

  it("basic agent mode system prompt with app blueprint disabled", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      basicAgentMode: true,
      enableAppBlueprint: false,
    });
    expect(prompt).toMatchSnapshot();
    expect(prompt).not.toContain('<app_blueprint mode="required">');
    expect(prompt).not.toContain("Required App Blueprint Gate");
    expect(prompt).not.toContain("write_app_blueprint");
    expect(prompt).toContain("1. **Understand:**");
    expect(prompt).toContain(
      "plan based on the understanding and clarification steps",
    );
  });

  it("updates an existing unapproved blueprint without repeating the questionnaire", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      enableAppBlueprint: true,
      hasAppBlueprint: true,
      appBlueprint: {
        appName: "Card-edited name",
        userPrompt: "Build an app",
        attachments: [],
        templateId: "react",
        themeId: "default",
        designDirection: "Card-edited direction",
        primaryColor: "#2563EB",
        visuals: [],
      },
    });

    expect(prompt).toContain("an unapproved blueprint already exists");
    expect(prompt).toContain("update the blueprint directly");
    expect(prompt).toContain("Card-edited name");
    expect(prompt).toContain("Card-edited direction");
    expect(prompt).toContain("including edits made in the blueprint card");
    expect(prompt).toContain(
      "Do not repeat it merely to update an existing unapproved blueprint",
    );
    expect(prompt).not.toContain(
      "You MUST call this tool even when the initial request seems concrete",
    );
  });

  it("preserves reserved prompt markers inside blueprint data", () => {
    const prompt = constructLocalAgentPrompt("# Actual app rules", undefined, {
      enableAppBlueprint: true,
      hasAppBlueprint: true,
      appBlueprint: {
        appName: "Marker test",
        userPrompt: "Keep [[AI_RULES]] and [[SERVER_LAYER]] as data",
        attachments: [],
        templateId: "react",
        themeId: "default",
        designDirection: "Literal [[AI_RULES]] marker",
        primaryColor: "#2563EB",
        visuals: [],
      },
    });

    expect(prompt).toContain(
      "Keep \\u005b\\u005bAI_RULES\\u005d\\u005d and \\u005b\\u005bSERVER_LAYER\\u005d\\u005d as data",
    );
    expect(prompt).toContain("# Actual app rules");
    expect(prompt).not.toContain("[[AI_RULES]]");
    expect(prompt).not.toContain("[[SERVER_LAYER]]");
  });

  it("does not repeat a completed initial blueprint questionnaire", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      enableAppBlueprint: true,
      appBlueprintQuestionnaireCompleted: true,
      planningQuestionnaireAvailable: false,
    });

    expect(prompt).toContain("initial questionnaire was already completed");
    expect(prompt).toContain("questionnaire answers already recorded");
    expect(prompt).toContain("Do not call `planning_questionnaire` again");
    expect(prompt).not.toContain(
      "You MUST call this tool even when the initial request seems concrete",
    );
  });

  it("surfaces an actionable recovery when the initial questionnaire is disabled", () => {
    const prompt = constructLocalAgentPrompt(undefined, undefined, {
      enableAppBlueprint: true,
      planningQuestionnaireAvailable: false,
    });

    expect(prompt).toContain('state="questionnaire-disabled"');
    expect(prompt).toContain("Settings → Build and Agent Permissions");
    expect(prompt).toContain(
      "set `planning_questionnaire` to Ask or Always allow",
    );
    expect(prompt).toContain("Do not call `write_app_blueprint`");
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
    expect(prompt).toContain("write_app_blueprint");
    expectBuildGitContextGuidance(prompt);
    expect(prompt).toContain("Required App Blueprint Gate");
    expect(prompt).not.toContain("**Implement:**");
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

  it("uses the normal Build workflow when app blueprint is disabled", () => {
    const prompt = constructBuildAgentPrompt(undefined, undefined, {
      enableAppBlueprint: false,
    });

    expect(prompt).not.toContain("Required App Blueprint Gate");
    expect(prompt).not.toContain('<app_blueprint mode="required">');
    expect(prompt).toContain("**Clarify (when needed):**");
    expect(prompt).toContain("**Implement:**");
  });
});
