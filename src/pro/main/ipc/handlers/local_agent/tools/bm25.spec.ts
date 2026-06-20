import { describe, expect, it } from "vitest";
import {
  tokenize,
  buildToolDocument,
  bm25Ranker,
  type ToolRanker,
} from "./bm25";
import type { McpToolDef } from "./mcp_type_defs";

function def(
  overrides: Partial<McpToolDef> & { toolName: string },
): McpToolDef {
  return {
    jsName: overrides.toolName,
    toolKey: `srv__${overrides.toolName}`,
    serverId: 1,
    serverName: "srv",
    description: undefined,
    inputSchema: { type: "object" },
    ...overrides,
  };
}

describe("tokenize", () => {
  it("splits camelCase and snake_case into parts", () => {
    expect(tokenize("createIssue")).toEqual(["create", "issue"]);
    expect(tokenize("list_repositories")).toEqual(["list", "repository"]);
  });

  it("folds -ies plurals to singular so queries match", () => {
    expect(tokenize("repositories")).toEqual(tokenize("repository"));
  });

  it("splits letter/digit boundaries", () => {
    expect(tokenize("listV2Repos")).toEqual(
      expect.arrayContaining(["list", "v", "2", "repo"]),
    );
  });

  it("folds simple plurals but leaves short tokens intact", () => {
    expect(tokenize("issues")).toEqual(["issue"]);
    expect(tokenize("ls")).toEqual(["ls"]);
    expect(tokenize("address")).toEqual(["address"]); // -ss not stripped
  });

  it("returns empty for empty input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("buildToolDocument", () => {
  it("includes server, names, description, and property names/descriptions", () => {
    const doc = buildToolDocument(
      def({
        toolName: "create_issue",
        serverName: "github",
        description: "Open a new issue",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "The issue title" },
            labels: { type: "array" },
          },
        },
      }),
    );
    expect(doc).toContain("github");
    expect(doc).toContain("create_issue");
    expect(doc).toContain("Open a new issue");
    expect(doc).toContain("title");
    expect(doc).toContain("The issue title");
    expect(doc).toContain("labels");
  });
});

describe("bm25Ranker", () => {
  const tools = [
    def({
      toolName: "create_issue",
      serverName: "github",
      description: "Create a new issue in a repository",
    }),
    def({
      toolName: "send_message",
      serverName: "slack",
      description: "Post a message to a channel",
    }),
    def({
      toolName: "list_repositories",
      serverName: "github",
      description: "List repositories for the user",
    }),
  ];

  it("ranks the most lexically relevant tool first", () => {
    const ranked = bm25Ranker("create github issue", tools);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].def.toolName).toBe("create_issue");
  });

  it("matches on description vocabulary, not just the name", () => {
    const ranked = bm25Ranker("post channel", tools);
    expect(ranked[0].def.toolName).toBe("send_message");
  });

  it("returns matches sorted by descending score", () => {
    const ranked = bm25Ranker("repository", tools);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  it("omits non-matching tools (score 0)", () => {
    const ranked = bm25Ranker("create issue", tools);
    expect(ranked.every((r) => r.score > 0)).toBe(true);
    expect(ranked.some((r) => r.def.toolName === "send_message")).toBe(false);
  });

  it("returns empty for an empty query or empty corpus", () => {
    expect(bm25Ranker("", tools)).toEqual([]);
    expect(bm25Ranker("anything", [])).toEqual([]);
  });

  it("conforms to the ToolRanker type", () => {
    const ranker: ToolRanker = bm25Ranker;
    expect(typeof ranker).toBe("function");
  });
});
