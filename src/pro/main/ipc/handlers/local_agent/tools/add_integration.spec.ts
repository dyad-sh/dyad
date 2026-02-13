import { describe, expect, it, vi } from "vitest";
import { addIntegrationTool } from "./add_integration";
import type { AgentContext } from "./types";

function makeMockContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    event: {} as any,
    appId: 1,
    appPath: "/tmp/app",
    chatId: 1,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    convexEnabled: false,
    messageId: 1,
    isSharedModulesChanged: false,
    isDyadPro: false,
    todos: [],
    dyadRequestId: "test-request",
    fileEditTracker: {},
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    requireConsent: vi.fn().mockResolvedValue(true),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
    ...overrides,
  };
}

describe("addIntegrationTool", () => {
  it("supports both supabase and convex providers", () => {
    expect(() =>
      addIntegrationTool.inputSchema.parse({ provider: "supabase" }),
    ).not.toThrow();
    expect(() =>
      addIntegrationTool.inputSchema.parse({ provider: "convex" }),
    ).not.toThrow();
  });

  it("is disabled when Supabase is already connected", () => {
    const ctx = makeMockContext({ supabaseProjectId: "proj_123" });
    expect(addIntegrationTool.isEnabled?.(ctx)).toBe(false);
  });

  it("is disabled when Convex is already enabled", () => {
    const ctx = makeMockContext({ convexEnabled: true });
    expect(addIntegrationTool.isEnabled?.(ctx)).toBe(false);
  });

  it("builds convex integration XML", () => {
    const xml = addIntegrationTool.buildXml?.({ provider: "convex" }, true);
    expect(xml).toBe(
      '<dyad-add-integration provider="convex"></dyad-add-integration>',
    );
  });
});
