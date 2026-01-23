import { describe, it, expect } from "vitest";
import {
  parseMcpToolKey,
  buildMcpToolKey,
  sanitizeMcpName,
  MCP_TOOL_KEY_SEPARATOR,
} from "@/ipc/utils/mcp_tool_utils";

describe("parseMcpToolKey", () => {
  describe("valid tool keys", () => {
    it("should parse a simple server__tool key", () => {
      const result = parseMcpToolKey("my-server__my-tool");
      expect(result).toEqual({
        serverName: "my-server",
        toolName: "my-tool",
      });
    });

    it("should parse key with underscores in server name", () => {
      const result = parseMcpToolKey("my_server_name__tool");
      expect(result).toEqual({
        serverName: "my_server_name",
        toolName: "tool",
      });
    });

    it("should parse key with underscores in tool name", () => {
      const result = parseMcpToolKey("server__my_tool_name");
      expect(result).toEqual({
        serverName: "server",
        toolName: "my_tool_name",
      });
    });

    it("should use the last separator when multiple exist", () => {
      // This handles edge case where server name contains double underscores
      const result = parseMcpToolKey("server__with__underscores__tool");
      expect(result).toEqual({
        serverName: "server__with__underscores",
        toolName: "tool",
      });
    });

    it("should parse key with hyphens", () => {
      const result = parseMcpToolKey("my-mcp-server__read-file");
      expect(result).toEqual({
        serverName: "my-mcp-server",
        toolName: "read-file",
      });
    });

    it("should handle numeric characters", () => {
      const result = parseMcpToolKey("server123__tool456");
      expect(result).toEqual({
        serverName: "server123",
        toolName: "tool456",
      });
    });
  });

  describe("edge cases", () => {
    it("should return empty serverName when no separator exists", () => {
      const result = parseMcpToolKey("toolWithoutServer");
      expect(result).toEqual({
        serverName: "",
        toolName: "toolWithoutServer",
      });
    });

    it("should handle empty string", () => {
      const result = parseMcpToolKey("");
      expect(result).toEqual({
        serverName: "",
        toolName: "",
      });
    });

    it("should handle key that is just the separator", () => {
      const result = parseMcpToolKey("__");
      expect(result).toEqual({
        serverName: "",
        toolName: "",
      });
    });

    it("should handle separator at the start", () => {
      const result = parseMcpToolKey("__tool");
      expect(result).toEqual({
        serverName: "",
        toolName: "tool",
      });
    });

    it("should handle separator at the end", () => {
      const result = parseMcpToolKey("server__");
      expect(result).toEqual({
        serverName: "server",
        toolName: "",
      });
    });

    it("should handle single underscore (not a separator)", () => {
      const result = parseMcpToolKey("server_tool");
      expect(result).toEqual({
        serverName: "",
        toolName: "server_tool",
      });
    });
  });
});

describe("buildMcpToolKey", () => {
  it("should build a valid tool key from server and tool names", () => {
    const result = buildMcpToolKey("my-server", "my-tool");
    expect(result).toBe("my-server__my-tool");
  });

  it("should handle empty server name", () => {
    const result = buildMcpToolKey("", "tool");
    expect(result).toBe("__tool");
  });

  it("should handle empty tool name", () => {
    const result = buildMcpToolKey("server", "");
    expect(result).toBe("server__");
  });

  it("should handle both empty", () => {
    const result = buildMcpToolKey("", "");
    expect(result).toBe("__");
  });

  it("should be reversible with parseMcpToolKey", () => {
    const serverName = "test-server";
    const toolName = "test-tool";
    const key = buildMcpToolKey(serverName, toolName);
    const parsed = parseMcpToolKey(key);
    expect(parsed).toEqual({ serverName, toolName });
  });
});

describe("sanitizeMcpName", () => {
  it("should pass through alphanumeric characters", () => {
    const result = sanitizeMcpName("myServer123");
    expect(result).toBe("myServer123");
  });

  it("should preserve underscores", () => {
    const result = sanitizeMcpName("my_server_name");
    expect(result).toBe("my_server_name");
  });

  it("should preserve hyphens", () => {
    const result = sanitizeMcpName("my-server-name");
    expect(result).toBe("my-server-name");
  });

  it("should replace spaces with hyphens", () => {
    const result = sanitizeMcpName("My Server Name");
    expect(result).toBe("My-Server-Name");
  });

  it("should replace special characters with hyphens", () => {
    const result = sanitizeMcpName("server@name#test");
    expect(result).toBe("server-name-test");
  });

  it("should replace dots with hyphens", () => {
    const result = sanitizeMcpName("server.name.v1");
    expect(result).toBe("server-name-v1");
  });

  it("should replace slashes with hyphens", () => {
    const result = sanitizeMcpName("path/to/server");
    expect(result).toBe("path-to-server");
  });

  it("should handle unicode characters", () => {
    const result = sanitizeMcpName("서버名前サーバー");
    expect(result).toBe("--------");
  });

  it("should handle empty string", () => {
    const result = sanitizeMcpName("");
    expect(result).toBe("");
  });

  it("should handle string with only special characters", () => {
    const result = sanitizeMcpName("@#$%^&*()");
    // 9 special characters = 9 hyphens
    expect(result).toBe("---------");
  });

  it("should handle mixed valid and invalid characters", () => {
    const result = sanitizeMcpName("Valid123_name-with.special@chars");
    expect(result).toBe("Valid123_name-with-special-chars");
  });
});

describe("MCP_TOOL_KEY_SEPARATOR", () => {
  it("should be the expected separator value", () => {
    expect(MCP_TOOL_KEY_SEPARATOR).toBe("__");
  });
});

describe("integration tests", () => {
  it("should sanitize and build a key, then parse it back", () => {
    const rawServerName = "My MCP Server v1.0";
    const rawToolName = "read_file@v2";

    const sanitizedServer = sanitizeMcpName(rawServerName);
    const sanitizedTool = sanitizeMcpName(rawToolName);
    const key = buildMcpToolKey(sanitizedServer, sanitizedTool);
    const parsed = parseMcpToolKey(key);

    expect(sanitizedServer).toBe("My-MCP-Server-v1-0");
    expect(sanitizedTool).toBe("read_file-v2");
    expect(key).toBe("My-MCP-Server-v1-0__read_file-v2");
    expect(parsed).toEqual({
      serverName: "My-MCP-Server-v1-0",
      toolName: "read_file-v2",
    });
  });

  it("should handle the typical MCP server naming pattern", () => {
    const serverName = "filesystem";
    const toolName = "read_file";

    const key = buildMcpToolKey(
      sanitizeMcpName(serverName),
      sanitizeMcpName(toolName),
    );
    expect(key).toBe("filesystem__read_file");

    const parsed = parseMcpToolKey(key);
    expect(parsed).toEqual({
      serverName: "filesystem",
      toolName: "read_file",
    });
  });
});
