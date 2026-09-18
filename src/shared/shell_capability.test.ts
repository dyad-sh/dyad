import { describe, expect, it } from "vitest";
import {
  isShellExperimentAvailable,
  shellExecutionGuidance,
} from "./shell_capability";

const eligible = { settings: { enableShellTool: true }, isDyadPro: true };
describe("shell experiment eligibility", () => {
  it("allows opted-in Pro root Agent on host", () =>
    expect(isShellExperimentAvailable(eligible)).toBe(true));
  it.each([
    { settings: {} },
    { isDyadPro: false },
    { freeModelMode: true },
    { readOnly: true },
    { planModeOnly: true },
    { toolProfile: "build" as const },
    { isChild: true },
    { settings: { enableShellTool: true, runtimeMode2: "docker" as const } },
    { settings: { enableShellTool: true, runtimeMode2: "cloud" as const } },
    {
      settings: {
        enableShellTool: true,
        agentToolConsents: { run_shell: "never" as const },
      },
    },
  ])("denies incompatible context %j", (override) =>
    expect(isShellExperimentAvailable({ ...eligible, ...override })).toBe(
      false,
    ),
  );
  it("names the platform shell and execution limits", () => {
    expect(shellExecutionGuidance("win32", "C:\\App")).toContain(
      "Use PowerShell syntax, not Bash or cmd.exe syntax",
    );
    const bash = shellExecutionGuidance("darwin", "/app");
    expect(bash).toContain("Bash, without startup profiles");
    expect(bash).toContain('"/app"');
    expect(bash).toContain("maximum five minutes");
  });
});
