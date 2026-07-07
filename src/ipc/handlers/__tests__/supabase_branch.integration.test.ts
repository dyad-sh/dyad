// @vitest-environment node
//
// Migrated from e2e-tests/supabase_branch.spec.ts ("supabase branch selection
// works").
//
// The e2e asserted branch selection through the token bar: the default branch
// has a small Supabase context (~6% of the 128K window) while "Test Branch"
// resolves to project ref test-branch-project-id, whose mock context is 800K
// characters — pushing the estimate to 100% of the context window. The token
// bar renders chat:count-tokens, and the branch dropdown funnels into
// supabase:list-branches + supabase:set-app-project, so those handlers are
// exercised directly (E2E_TEST_BUILD=true routes the Supabase management
// client + context to the same mocks the Playwright suite used).
//
// Dropped as UI-only: token-bar toggling/tooltip mechanics and the exact "6%"
// label (the ported assertions bound the same underlying token counts).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  // Routes the Supabase management client/context to their mock test-build
  // implementations (the same ones the Playwright suite used).
  process.env.E2E_TEST_BUILD = "true";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { registerSupabaseHandlers } from "@/ipc/handlers/supabase_handlers";
import { registerTokenCountHandlers } from "@/ipc/handlers/token_count_handlers";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";

interface SentEvent {
  channel: string;
  payload: any;
}

function makeEvent(sink: SentEvent[] = []) {
  return {
    sender: {
      isDestroyed: () => false,
      isCrashed: () => false,
      send: (channel: string, payload: unknown) =>
        sink.push({ channel, payload }),
    },
  };
}

async function invoke(
  channel: string,
  params?: unknown,
  sink?: SentEvent[],
): Promise<any> {
  const handler = h.ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  const response = await handler(makeEvent(sink), params);
  return isIpcInvokeEnvelope(response) ? unwrapIpcEnvelope(response) : response;
}

describe("supabase branch selection (integration)", () => {
  let harness: ChatFlowHarness;

  const countTokens = () =>
    invoke("chat:count-tokens", { chatId: harness.chatId, input: "" });

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
    registerSupabaseHandlers();
    registerTokenCountHandlers();
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("supabase branch selection works", async () => {
    // The e2e's first turn: the add-supabase fixture streams through the
    // real chat flow.
    const { result } = await harness.streamChat("tc=add-supabase");
    expect(result).toBe(harness.chatId);

    // Connect Supabase (the connect button's test path): stores fake org
    // credentials and links the app to fake-project-id.
    const deepLinkEvents: SentEvent[] = [];
    await invoke(
      "supabase:fake-connect-and-set-project",
      { appId: harness.appId, fakeProjectId: "fake-project-id" },
      deepLinkEvents,
    );
    expect(
      deepLinkEvents.some(
        (e) =>
          e.channel === "deep-link-received" &&
          e.payload?.type === "supabase-oauth-return",
      ),
    ).toBe(true);

    const appRow = await db.query.apps.findFirst({
      where: eq(apps.id, harness.appId),
    });
    expect(appRow?.supabaseProjectId).toBe("fake-project-id");
    expect(appRow?.supabaseOrganizationSlug).toBe("fake-org-id");

    // The default branch has a small context: the token bar showed ~6% of
    // the 128K context window ("Context window: 128K").
    const before = await countTokens();
    expect(before.contextWindow).toBe(128_000);
    expect(before.estimatedTotalTokens).toBeGreaterThan(0);
    // Small context: well under the window (the e2e showed 6%).
    expect(before.estimatedTotalTokens).toBeLessThan(0.2 * 128_000);

    // The branch dropdown lists the mock branches.
    const branches = await invoke("supabase:list-branches", {
      projectId: appRow!.supabaseProjectId,
      organizationSlug: appRow!.supabaseOrganizationSlug,
    });
    expect(branches).toEqual([
      {
        id: "default-branch-id",
        name: "Default Branch",
        isDefault: true,
        projectRef: "fake-project-id",
        parentProjectRef: "fake-project-id",
      },
      {
        id: "test-branch-id",
        name: "Test Branch",
        isDefault: false,
        projectRef: "test-branch-project-id",
        parentProjectRef: "fake-project-id",
      },
    ]);

    // Selecting "Test Branch" sets the branch's project ref on the app
    // (keeping the same organization slug), exactly as the dropdown does.
    const testBranch = branches.find((b: any) => b.name === "Test Branch");
    await invoke("supabase:set-app-project", {
      appId: harness.appId,
      projectId: testBranch.projectRef,
      parentProjectId: testBranch.parentProjectRef,
      organizationSlug: appRow!.supabaseOrganizationSlug,
    });

    const updatedRow = await db.query.apps.findFirst({
      where: eq(apps.id, harness.appId),
    });
    expect(updatedRow?.supabaseProjectId).toBe("test-branch-project-id");
    expect(updatedRow?.supabaseParentProjectId).toBe("fake-project-id");

    // The test branch has a large context (800K chars ≈ 200K tokens) so the
    // token bar hits the 100% limit — proving the right Supabase project is
    // consulted for the selected branch.
    const after = await countTokens();
    expect(after.contextWindow).toBe(128_000);
    expect(after.estimatedTotalTokens).toBeGreaterThanOrEqual(128_000);
    expect(after.systemPromptTokens).toBeGreaterThan(before.systemPromptTokens);
  }, 30_000);
});
