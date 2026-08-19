import type { CreateMcpServer, McpServer } from "@/ipc/types";

export type DesktopMcpPluginId = "godot" | "blender";
export type DesktopMcpConnectionMode = "local" | "remote";

export type DesktopMcpPluginDraft = {
  mode: DesktopMcpConnectionMode;
  command: string;
  executablePath: string;
  remoteHost: string;
  remotePort: string;
  remoteMcpUrl: string;
  disableTelemetry: boolean;
};

export const DESKTOP_MCP_PLUGIN_DEFINITIONS = {
  godot: {
    title: "Godot",
    serverName: "Godot MCP",
    packageName: "@coding-solo/godot-mcp",
    repositoryUrl: "https://github.com/Coding-Solo/godot-mcp",
    softwareUrl: "https://godotengine.org/download/",
  },
  blender: {
    title: "Blender",
    serverName: "Blender MCP",
    packageName: "blender-mcp",
    repositoryUrl: "https://github.com/ahujasid/blender-mcp",
    softwareUrl: "https://www.blender.org/download/",
  },
} as const;

export function defaultDesktopMcpPluginDraft(
  plugin: DesktopMcpPluginId,
): DesktopMcpPluginDraft {
  return {
    mode: "local",
    command: plugin === "godot" ? "npx" : "uvx",
    executablePath: "",
    remoteHost: "",
    remotePort: plugin === "godot" ? "7878" : "9876",
    remoteMcpUrl: "",
    disableTelemetry: plugin === "blender",
  };
}

function validPort(port: string) {
  const parsed = Number(port);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535;
}

function validHttpUrl(url: string) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function buildDesktopMcpServerConfig(
  plugin: DesktopMcpPluginId,
  draft: DesktopMcpPluginDraft,
): CreateMcpServer {
  const definition = DESKTOP_MCP_PLUGIN_DEFINITIONS[plugin];

  if (plugin === "godot" && draft.mode === "remote") {
    const url = draft.remoteMcpUrl.trim();
    if (!validHttpUrl(url)) {
      throw new Error(
        "Enter the HTTP MCP address running on the Godot machine.",
      );
    }
    return {
      name: definition.serverName,
      transport: "http",
      url,
      enabled: true,
    };
  }

  const command = draft.command.trim();
  if (!command) {
    throw new Error(
      plugin === "godot" ? "Enter the path to npx." : "Enter the path to uvx.",
    );
  }

  if (plugin === "godot") {
    return {
      name: definition.serverName,
      transport: "stdio",
      command,
      args: ["-y", definition.packageName],
      envJson: draft.executablePath.trim()
        ? { GODOT_PATH: draft.executablePath.trim() }
        : null,
      enabled: true,
    };
  }

  const remoteHost =
    draft.mode === "remote" ? draft.remoteHost.trim() : "127.0.0.1";
  if (!remoteHost || /\s/.test(remoteHost)) {
    throw new Error("Enter the hostname or IP address of the Blender machine.");
  }
  if (!validPort(draft.remotePort)) {
    throw new Error("Enter a Blender port between 1 and 65535.");
  }

  return {
    name: definition.serverName,
    transport: "stdio",
    command,
    args: ["--python", "3.11", definition.packageName],
    envJson: {
      BLENDER_HOST: remoteHost,
      BLENDER_PORT: draft.remotePort,
      ...(draft.disableTelemetry ? { DISABLE_TELEMETRY: "true" } : {}),
    },
    enabled: true,
  };
}

export function isDesktopMcpPluginServer(
  plugin: DesktopMcpPluginId,
  server: Pick<McpServer, "name" | "args">,
) {
  const definition = DESKTOP_MCP_PLUGIN_DEFINITIONS[plugin];
  return (
    server.name === definition.serverName ||
    server.args?.includes(definition.packageName) === true
  );
}

export function draftFromDesktopMcpServer(
  plugin: DesktopMcpPluginId,
  server: Pick<McpServer, "transport" | "command" | "envJson" | "url">,
): DesktopMcpPluginDraft {
  const defaults = defaultDesktopMcpPluginDraft(plugin);
  if (plugin === "godot") {
    return {
      ...defaults,
      mode: server.transport === "http" ? "remote" : "local",
      command: server.command || defaults.command,
      executablePath: server.envJson?.GODOT_PATH ?? "",
      remoteMcpUrl: server.url ?? "",
    };
  }

  const host = server.envJson?.BLENDER_HOST ?? "127.0.0.1";
  return {
    ...defaults,
    mode: ["127.0.0.1", "localhost"].includes(host) ? "local" : "remote",
    command: server.command || defaults.command,
    remoteHost: ["127.0.0.1", "localhost"].includes(host) ? "" : host,
    remotePort: server.envJson?.BLENDER_PORT ?? defaults.remotePort,
    disableTelemetry: server.envJson?.DISABLE_TELEMETRY === "true",
  };
}
