import { describe, expect, it } from "vitest";
import { shouldAutoApproveAgentTool } from "./tool_definitions";

describe("shouldAutoApproveAgentTool", () => {
  it("auto-approves execute_sql that does not mutate schema when enabled", () => {
    expect(
      shouldAutoApproveAgentTool({
        toolName: "execute_sql",
        metadata: { sqlMutatesSchema: false },
        autoApproveNonSchemaSql: true,
      }),
    ).toBe(true);
  });

  it("still asks for schema-mutating execute_sql when enabled", () => {
    expect(
      shouldAutoApproveAgentTool({
        toolName: "execute_sql",
        metadata: { sqlMutatesSchema: true },
        autoApproveNonSchemaSql: true,
      }),
    ).toBe(false);
  });

  it("does not auto-approve when the setting is off", () => {
    expect(
      shouldAutoApproveAgentTool({
        toolName: "execute_sql",
        metadata: { sqlMutatesSchema: false },
        autoApproveNonSchemaSql: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoApproveAgentTool({
        toolName: "execute_sql",
        metadata: { sqlMutatesSchema: false },
        autoApproveNonSchemaSql: undefined,
      }),
    ).toBe(false);
  });

  it("does not auto-approve when schema-mutation metadata is missing", () => {
    expect(
      shouldAutoApproveAgentTool({
        toolName: "execute_sql",
        metadata: null,
        autoApproveNonSchemaSql: true,
      }),
    ).toBe(false);
  });

  it("never auto-approves a tool other than execute_sql", () => {
    expect(
      shouldAutoApproveAgentTool({
        toolName: "write_file",
        metadata: { sqlMutatesSchema: false },
        autoApproveNonSchemaSql: true,
      }),
    ).toBe(false);
  });
});
