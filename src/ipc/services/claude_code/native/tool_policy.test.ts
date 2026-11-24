import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS } from "@/pro/main/ipc/handlers/local_agent/tool_definitions";
import {
  DYAD_TOOL_NATIVE_POLICY,
  NATIVE_TOOL_ALLOWLIST,
  WORKSPACE_DEPENDENT_DYAD_TOOLS,
  keepsDyadMcpTool,
  validateNativeInventory,
} from "./tool_policy";

describe("native tool policy", () => {
  it("classifies every Dyad tool exactly once", () => {
    // A new Dyad tool must be classified before native turns can ship it.
    expect(Object.keys(DYAD_TOOL_NATIVE_POLICY).sort()).toEqual(
      TOOL_DEFINITIONS.map((tool) => tool.name).sort(),
    );
  });

  it("only gates Dyad tools that stay on the MCP server", () => {
    for (const name of WORKSPACE_DEPENDENT_DYAD_TOOLS)
      expect(keepsDyadMcpTool(name)).toBe(true);
  });

  it("drops tools Claude Code replaces and keeps Dyad-only ones", () => {
    expect(keepsDyadMcpTool("write_file")).toBe(false);
    expect(keepsDyadMcpTool("run_shell")).toBe(false);
    expect(keepsDyadMcpTool("spawn_agent")).toBe(false);
    expect(keepsDyadMcpTool("execute_sandbox_script")).toBe(false);
    expect(keepsDyadMcpTool("restart_app")).toBe(true);
    expect(keepsDyadMcpTool("execute_sql")).toBe(true);
    expect(keepsDyadMcpTool("update_todos")).toBe(true);
    expect(keepsDyadMcpTool("planning_questionnaire")).toBe(true);
  });

  it("keeps Dyad-proxied third-party MCP tools on the bridge", () => {
    expect(keepsDyadMcpTool("linear__create_issue")).toBe(true);
  });

  it("never allows tools that would leave the app or outlive the turn", () => {
    for (const name of [
      "EnterWorktree",
      "ExitWorktree",
      "EnterPlanMode",
      "ExitPlanMode",
      "AskUserQuestion",
      "TodoWrite",
      "CronCreate",
      "ScheduleWakeup",
      "RemoteTrigger",
      "PushNotification",
      "Workflow",
      "SendMessage",
    ])
      expect(NATIVE_TOOL_ALLOWLIST).not.toContain(name);
  });
});

describe("validateNativeInventory", () => {
  const servers = [{ name: "dyad", status: "connected" }];
  const dyad = ["mcp__dyad__restart_app"];

  it("accepts the allowlisted core plus the user's own MCP tools", () => {
    expect(
      validateNativeInventory(
        [
          "Read",
          "Write",
          "Edit",
          "Bash",
          "Task",
          "mcp__dyad__restart_app",
          "mcp__github__create_pr",
        ],
        [...servers, { name: "github", status: "connected" }],
        dyad,
      ),
    ).toBeUndefined();
  });

  it("accepts PowerShell as the shell on Windows-only inventories", () => {
    expect(
      validateNativeInventory(
        ["Read", "Write", "Edit", "PowerShell", ...dyad],
        servers,
        dyad,
      ),
    ).toBeUndefined();
  });

  it("rejects built-ins that Dyad did not allow", () => {
    expect(
      validateNativeInventory(
        ["Read", "Write", "Edit", "Bash", "EnterWorktree", ...dyad],
        servers,
        dyad,
      ),
    ).toMatch(/EnterWorktree/);
  });

  it("rejects a missing shell, missing core tool or missing Dyad tool", () => {
    expect(
      validateNativeInventory(
        ["Read", "Write", "Edit", ...dyad],
        servers,
        dyad,
      ),
    ).toMatch(/Bash/);
    expect(
      validateNativeInventory(
        ["Read", "Write", "Bash", ...dyad],
        servers,
        dyad,
      ),
    ).toMatch(/Edit/);
    expect(
      validateNativeInventory(["Read", "Write", "Edit", "Bash"], servers, dyad),
    ).toMatch(/restart_app/);
  });

  it("requires Dyad's own server to be connected", () => {
    expect(
      validateNativeInventory(
        ["Read", "Write", "Edit", "Bash", ...dyad],
        [{ name: "dyad", status: "failed" }],
        dyad,
      ),
    ).toMatch(/connect/);
  });
});
