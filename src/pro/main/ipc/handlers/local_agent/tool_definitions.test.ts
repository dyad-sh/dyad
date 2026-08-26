import { describe, expect, it } from "vitest";

import {
  BUILD_MODE_TOOL_NAMES,
  estimateBuildModeToolTokens,
  TOOL_DEFINITIONS,
} from "./tool_definitions";

describe("Build mode tool profile", () => {
  it("is an exact, engine-free, non-sub-agent allowlist", () => {
    expect(BUILD_MODE_TOOL_NAMES).toEqual([
      "write_file",
      "search_replace",
      "copy_file",
      "delete_file",
      "rename_file",
      "add_dependency",
      "execute_sql",
      "read_file",
      "list_files",
      "grep",
      "get_supabase_project_info",
      "get_neon_project_info",
      "get_database_table_schema",
      "set_chat_summary",
      "add_integration",
      "enable_nitro",
      "update_todos",
      "read_guide",
      "planning_questionnaire",
      "write_app_blueprint",
    ]);

    const definitions = new Map(
      TOOL_DEFINITIONS.map((definition) => [definition.name, definition]),
    );
    for (const name of BUILD_MODE_TOOL_NAMES) {
      const definition = definitions.get(name);
      expect(
        definition,
        `${name} must exist in TOOL_DEFINITIONS`,
      ).toBeDefined();
      expect(definition?.usesEngineEndpoint, name).not.toBe(true);
      expect(definition?.subagentOnly, name).not.toBe(true);
    }
  });

  it("accounts for serialized Build tool declarations", async () => {
    const baseOptions = {
      enableAppBlueprint: false,
      isDyadPro: false,
      frameworkType: "vite" as const,
      supabaseProjectId: null,
      neonProjectId: null,
      neonActiveBranchId: null,
    };

    const withoutBlueprint = await estimateBuildModeToolTokens(baseOptions);
    const withBlueprint = await estimateBuildModeToolTokens({
      ...baseOptions,
      enableAppBlueprint: true,
    });

    expect(withoutBlueprint).toBeGreaterThan(1_000);
    expect(withBlueprint).toBeGreaterThan(withoutBlueprint);
  });
});
