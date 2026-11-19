import { describe, expect, it } from "vitest";
import type { McpTool } from "@/ipc/types";
import { mcpConsentKey } from "@/hooks/useMcp";
import {
  appConfigConnection,
  pluginConnection,
} from "@/shared/mcp_connection_ref";
import { pluginToolSummary } from "./pluginToolSummary";

const plugin = pluginConnection(1);
const lab = appConfigConnection(1, 3);
const prod = appConfigConnection(1, 4);

function tools(...names: string[]): McpTool[] {
  return names.map((name) => ({ name, description: null }));
}

describe("pluginToolSummary", () => {
  it("counts an app-specific configuration's tools when the default failed", () => {
    const summary = pluginToolSummary(
      [plugin, lab],
      { "1:3": tools("deploy", "logs") },
      { "1": "unauthorized", "1:3": "ok" },
      {},
    );

    expect(summary).toEqual({
      toolCount: 2,
      enabledToolCount: 2,
      discoveryFailed: false,
      discovering: false,
    });
  });

  it("takes both counts from the configuration with the most tools", () => {
    const summary = pluginToolSummary(
      [plugin, lab, prod],
      {
        "1": tools("deploy"),
        "1:3": tools("deploy", "logs", "restart"),
        "1:4": tools("deploy", "logs"),
      },
      { "1": "ok", "1:3": "ok", "1:4": "ok" },
      {
        // Denied in the configuration with the most tools, and in one
        // that isn't, which must not affect the count.
        [mcpConsentKey(lab, "restart")]: "denied",
        [mcpConsentKey(prod, "logs")]: "denied",
      },
    );

    expect(summary.toolCount).toBe(3);
    expect(summary.enabledToolCount).toBe(2);
  });

  it("reports failure only once every configuration failed", () => {
    expect(
      pluginToolSummary(
        [plugin, lab],
        {},
        { "1": "unauthorized", "1:3": "error" },
        {},
      ),
    ).toMatchObject({ toolCount: null, discoveryFailed: true });

    expect(
      pluginToolSummary([plugin, lab], {}, { "1": "unauthorized" }, {}),
    ).toMatchObject({
      toolCount: null,
      discoveryFailed: false,
      discovering: true,
    });
  });
});
