/**
 * Agent Builder MCP wiring tests.
 *
 * The agent editor saves `mcpToolsAllow` on the agent's `config` blob,
 * which goes through `handleUpdateAgent` -> `agents.config_json`. The
 * runtime in `autonomous_agent.ts` then reads that allow-list and
 * passes it as `toolAllowList` to `buildMcpToolSet` via the shared
 * `planMcpAllowList` helper.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}));

// ─── handleUpdateAgent persistence ────────────────────────────────────

const updateSetMock = vi.hoisted(() => vi.fn());
const returningMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue([
    {
      id: 1,
      name: "test",
      description: null,
      type: "chatbot",
      status: "draft",
      systemPrompt: null,
      modelId: null,
      temperature: null,
      maxTokens: null,
      configJson: { mcpToolsAllow: ["mcp__github__create_issue"] },
      version: "1.0.0",
      publishStatus: "local",
      marketplaceId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      appId: null,
    },
  ]),
);

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  sql: () => ({}),
  relations: () => ({}),
}));

vi.mock("../db", () => ({
  db: {
    update: () => ({
      set: (data: Record<string, unknown>) => {
        updateSetMock(data);
        return {
          where: () => ({ returning: returningMock }),
        };
      },
    }),
  },
}));

vi.mock("../db/schema", () => ({
  agents: { id: "id" },
  agentTools: {},
  agentWorkflows: {},
  agentDeployments: {},
  agentKnowledgeBases: {},
}));

import { handleUpdateAgent } from "../ipc/handlers/agent_builder_handlers";

describe("Agent Builder — MCP allow-list persistence", () => {
  beforeEach(() => {
    updateSetMock.mockClear();
    returningMock.mockClear();
  });

  it("writes config (with mcpToolsAllow) to configJson on update", async () => {
    const fakeEvent = {} as unknown as Electron.IpcMainInvokeEvent;
    await handleUpdateAgent(fakeEvent, {
      id: 1,
      name: "my agent",
      config: {
        mcpToolsAllow: [
          "mcp__github__create_issue",
          "mcp__slack__post_message",
        ],
      },
    });

    expect(updateSetMock).toHaveBeenCalledTimes(1);
    const written = updateSetMock.mock.calls[0][0] as Record<string, unknown>;
    expect(written.configJson).toEqual({
      mcpToolsAllow: [
        "mcp__github__create_issue",
        "mcp__slack__post_message",
      ],
    });
  });

  it("surfaces the saved allow-list in the returned Agent record", async () => {
    const fakeEvent = {} as unknown as Electron.IpcMainInvokeEvent;
    const agent = await handleUpdateAgent(fakeEvent, {
      id: 1,
      config: { mcpToolsAllow: ["mcp__github__create_issue"] },
    });
    // The mocked DB row carries the allow-list back — the handler exposes
    // it via `config` on the returned Agent.
    expect(agent.config).toEqual({
      mcpToolsAllow: ["mcp__github__create_issue"],
    });
  });
});

// ─── Runtime path forwards the allow-list ──────────────────────────────

// `planMcpAllowList` is the SHARED helper that the agent runtime
// (`autonomous_agent.ts`) uses to translate `mcpToolsAllow` into
// `BuildMcpToolSetOptions`. By driving it directly (rather than
// reimplementing the logic in the test), this test will genuinely fail
// if a future refactor stops forwarding the allow-list.
import { planMcpAllowList } from "../lib/mcp_ai_bridge";

describe("autonomous_agent runtime — MCP allow-list forwarding", () => {
  it("undefined → unrestricted (no toolAllowList in options)", () => {
    const plan = planMcpAllowList(undefined);
    expect(plan.skip).toBe(false);
    if (!plan.skip) {
      expect(plan.options).toEqual({});
    }
  });

  it("empty array → explicit opt-out (skip MCP entirely)", () => {
    const plan = planMcpAllowList([]);
    expect(plan.skip).toBe(true);
  });

  it("non-empty array → forwarded as toolAllowList", () => {
    const plan = planMcpAllowList([
      "mcp__github__create_issue",
      "mcp__slack__post_message",
    ]);
    expect(plan.skip).toBe(false);
    if (!plan.skip) {
      expect(plan.options).toEqual({
        toolAllowList: [
          "mcp__github__create_issue",
          "mcp__slack__post_message",
        ],
      });
    }
  });

  it("defensive: returns a fresh array (caller can't mutate the original)", () => {
    const original = ["mcp__a__b"];
    const plan = planMcpAllowList(original);
    expect(plan.skip).toBe(false);
    if (!plan.skip) {
      // Mutating the returned options must not bleed back into the input.
      (plan.options.toolAllowList as string[]).push("mcp__hacked");
      expect(original).toEqual(["mcp__a__b"]);
    }
  });
});
