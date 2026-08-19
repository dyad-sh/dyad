import { describe, expect, it } from "vitest";

import {
  buildDesktopMcpServerConfig,
  defaultDesktopMcpPluginDraft,
  draftFromDesktopMcpServer,
  isDesktopMcpPluginServer,
} from "./desktop_mcp_plugins";

describe("desktop MCP plugin presets", () => {
  it("builds the supported local Godot command", () => {
    expect(
      buildDesktopMcpServerConfig("godot", {
        ...defaultDesktopMcpPluginDraft("godot"),
        executablePath: "/Applications/Godot.app/Contents/MacOS/Godot",
      }),
    ).toEqual({
      name: "Godot MCP",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@coding-solo/godot-mcp"],
      envJson: {
        GODOT_PATH: "/Applications/Godot.app/Contents/MacOS/Godot",
      },
      enabled: true,
    });
  });

  it("uses HTTP for Godot running on another machine", () => {
    expect(
      buildDesktopMcpServerConfig("godot", {
        ...defaultDesktopMcpPluginDraft("godot"),
        mode: "remote",
        remoteMcpUrl: "http://studio-pc:7878/mcp",
      }),
    ).toMatchObject({
      transport: "http",
      url: "http://studio-pc:7878/mcp",
    });
  });

  it("connects the Blender bridge to a remote add-on", () => {
    expect(
      buildDesktopMcpServerConfig("blender", {
        ...defaultDesktopMcpPluginDraft("blender"),
        mode: "remote",
        remoteHost: "192.168.1.80",
      }),
    ).toEqual({
      name: "Blender MCP",
      transport: "stdio",
      command: "uvx",
      args: ["--python", "3.11", "blender-mcp"],
      envJson: {
        BLENDER_HOST: "192.168.1.80",
        BLENDER_PORT: "9876",
        DISABLE_TELEMETRY: "true",
      },
      enabled: true,
    });
  });

  it("rejects unsafe or incomplete remote destinations", () => {
    expect(() =>
      buildDesktopMcpServerConfig("godot", {
        ...defaultDesktopMcpPluginDraft("godot"),
        mode: "remote",
        remoteMcpUrl: "studio-pc:7878",
      }),
    ).toThrow("HTTP MCP address");
    expect(() =>
      buildDesktopMcpServerConfig("blender", {
        ...defaultDesktopMcpPluginDraft("blender"),
        mode: "remote",
        remoteHost: "studio pc",
      }),
    ).toThrow("hostname or IP address");
  });

  it("recognizes and restores previously installed presets", () => {
    expect(
      isDesktopMcpPluginServer("blender", {
        name: "My 3D tools",
        args: ["--python", "3.11", "blender-mcp"],
      }),
    ).toBe(true);
    expect(
      draftFromDesktopMcpServer("blender", {
        transport: "stdio",
        command: "/opt/homebrew/bin/uvx",
        envJson: {
          BLENDER_HOST: "render-box",
          BLENDER_PORT: "9877",
          DISABLE_TELEMETRY: "true",
        },
        url: null,
      }),
    ).toMatchObject({
      mode: "remote",
      command: "/opt/homebrew/bin/uvx",
      remoteHost: "render-box",
      remotePort: "9877",
      disableTelemetry: true,
    });
  });
});
