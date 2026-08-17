import { describe, expect, it } from "vitest";
import {
  SECTION_IDS,
  SETTING_IDS,
  SETTINGS_SEARCH_INDEX,
} from "./settingsSearchIndex";

describe("SETTINGS_SEARCH_INDEX", () => {
  it("includes the Lovable MCP plugin", () => {
    expect(
      SETTINGS_SEARCH_INDEX.find((item) => item.id === SETTING_IDS.lovable),
    ).toEqual({
      id: SETTING_IDS.lovable,
      label: "Lovable MCP",
      description: "Connect Lovable projects, builds, and published websites",
      keywords: [
        "lovable",
        "mcp",
        "plugin",
        "website",
        "deploy",
        "project",
        "agent",
      ],
      sectionId: SECTION_IDS.plugins,
      sectionLabel: "Plugins",
    });
  });

  it("includes the Canva MCP plugin", () => {
    expect(
      SETTINGS_SEARCH_INDEX.find((item) => item.id === SETTING_IDS.canva),
    ).toEqual({
      id: SETTING_IDS.canva,
      label: "Canva MCP",
      description: "Create, edit, search and export Canva designs",
      keywords: [
        "canva",
        "mcp",
        "plugin",
        "design",
        "presentation",
        "slides",
        "export",
      ],
      sectionId: SECTION_IDS.plugins,
      sectionLabel: "Plugins",
    });
  });

  it("includes Chat Agent research plugins", () => {
    const pluginIds = new Set(
      SETTINGS_SEARCH_INDEX.filter(
        (item) => item.sectionId === SECTION_IDS.plugins,
      ).map((item) => item.id),
    );
    expect(pluginIds).toContain(SETTING_IDS.duckDuckGo);
    expect(pluginIds).toContain(SETTING_IDS.coinGecko);
    expect(pluginIds).toContain(SETTING_IDS.weather);
    expect(pluginIds).toContain(SETTING_IDS.maps);
    expect(pluginIds).toContain(SETTING_IDS.travelSearch);
    expect(pluginIds).toContain(SETTING_IDS.skyscanner);
    expect(pluginIds).toContain(SETTING_IDS.amadeus);
    expect(pluginIds).toContain(SETTING_IDS.duffel);
  });

  it("includes the cloud sandbox experiment", () => {
    expect(
      SETTINGS_SEARCH_INDEX.find(
        (item) => item.id === SETTING_IDS.enableCloudSandbox,
      ),
    ).toEqual({
      id: SETTING_IDS.enableCloudSandbox,
      label: "Enable Cloud Sandbox (Pro)",
      description:
        "Run your app on the Cloud for a more secure runtime that uses fewer local system resources",
      keywords: [
        "cloud",
        "sandbox",
        "runtime",
        "experiment",
        "pro",
        "credits",
        "secure",
      ],
      sectionId: SECTION_IDS.experiments,
      sectionLabel: "Experiments",
    });
  });

  it("includes the block unsafe npm packages experiment", () => {
    expect(
      SETTINGS_SEARCH_INDEX.find(
        (item) => item.id === SETTING_IDS.blockUnsafeNpmPackages,
      ),
    ).toEqual({
      id: SETTING_IDS.blockUnsafeNpmPackages,
      label: "Block unsafe npm packages",
      description: "Uses socket.dev to detect unsafe packages and blocks them",
      keywords: ["socket", "npm", "firewall", "package", "unsafe", "security"],
      sectionId: SECTION_IDS.experiments,
      sectionLabel: "Experiments",
    });
  });

  it("includes the sandbox script execution experiment", () => {
    expect(
      SETTINGS_SEARCH_INDEX.find(
        (item) => item.id === SETTING_IDS.enableSandboxScriptExecution,
      ),
    ).toEqual({
      id: SETTING_IDS.enableSandboxScriptExecution,
      label: "Enable sandbox script execution",
      description:
        "Allow local-agent attachment scripts to inspect files with execute_sandbox_script",
      keywords: [
        "script",
        "scripts",
        "sandbox",
        "attachments",
        "mustard",
        "agent",
        "experiment",
      ],
      sectionId: SECTION_IDS.experiments,
      sectionLabel: "Experiments",
    });
  });

  it("includes Chat Agent MCP server selection", () => {
    expect(
      SETTINGS_SEARCH_INDEX.find(
        (item) => item.id === SETTING_IDS.chatAgentMcpServers,
      ),
    ).toEqual({
      id: SETTING_IDS.chatAgentMcpServers,
      label: "Chat Agent MCP servers",
      description: "Choose which configured MCP servers Chat Agent can use",
      keywords: ["mcp", "chat agent", "tools", "server", "n8n", "select"],
      sectionId: SECTION_IDS.toolsMcp,
      sectionLabel: "Tools (MCP)",
    });
  });

  it("includes Chat Agent MCP tool selection", () => {
    expect(
      SETTINGS_SEARCH_INDEX.find(
        (item) => item.id === SETTING_IDS.chatAgentMcpTools,
      ),
    ).toEqual({
      id: SETTING_IDS.chatAgentMcpTools,
      label: "Chat Agent MCP tools",
      description:
        "Choose which n8n workflows and MCP tools Chat Agent can use",
      keywords: [
        "mcp",
        "chat agent",
        "tools",
        "workflow",
        "workflows",
        "n8n",
        "select",
      ],
      sectionId: SECTION_IDS.toolsMcp,
      sectionLabel: "Tools (MCP)",
    });
  });

  it("includes Chat Agent n8n workflow selection", () => {
    expect(
      SETTINGS_SEARCH_INDEX.find(
        (item) => item.id === SETTING_IDS.chatAgentMcpWorkflows,
      ),
    ).toEqual({
      id: SETTING_IDS.chatAgentMcpWorkflows,
      label: "Chat Agent n8n workflows",
      description:
        "Choose which discovered n8n workflows Chat Agent may execute",
      keywords: [
        "mcp",
        "chat agent",
        "workflow",
        "workflows",
        "n8n",
        "execute",
        "select",
      ],
      sectionId: SECTION_IDS.toolsMcp,
      sectionLabel: "Tools (MCP)",
    });
  });
});
