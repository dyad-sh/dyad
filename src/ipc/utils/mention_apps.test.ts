import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      apps: {
        findMany: dbMocks.findMany,
      },
    },
    update: () => ({
      set: (values: unknown) => {
        dbMocks.set(values);
        return {
          where: (condition: unknown) => {
            dbMocks.where(condition);
            return Promise.resolve();
          },
        };
      },
    }),
  },
}));

const invalidationMocks = vi.hoisted(() => ({
  publishQueryInvalidations: vi.fn(),
}));

vi.mock("@/ipc/utils/query_invalidation_delivery", () => ({
  publishQueryInvalidations: invalidationMocks.publishQueryInvalidations,
}));

vi.mock("@/paths/paths", () => ({
  getDyadAppPath: vi.fn((appPath: string) => `/dyad-apps/${appPath}`),
}));

vi.mock("@/utils/codebase", () => ({
  extractCodebase: vi.fn(),
}));

vi.mock("@/ipc/utils/context_paths_utils", () => ({
  validateChatContext: vi.fn((chatContext) => chatContext),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: vi.fn(() => ({
      error: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    })),
  },
}));

import { eq } from "drizzle-orm";
import { chats } from "@/db/schema";
import {
  persistReferencedAppIds,
  readStoredReferencedAppIds,
  resolveStickyReferencedApps,
} from "@/ipc/utils/mention_apps";

const FOO_APP = { id: 1, name: "foo.app.com", path: "foo-app" };
const BAR_APP = { id: 2, name: "bar", path: "bar-app" };
const SPACED_APP = { id: 3, name: "App With Spaces", path: "spaced-app" };

describe("mention app utilities", () => {
  beforeEach(() => {
    dbMocks.findMany.mockReset();
    dbMocks.set.mockReset();
    dbMocks.where.mockReset();
    invalidationMocks.publishQueryInvalidations.mockReset();
  });

  it("does not query apps when there are no mentions and nothing stored", async () => {
    const result = await resolveStickyReferencedApps({
      prompt: "Please update the landing page",
      persistedAppIds: [],
    });

    expect(result).toEqual({ references: [], appIds: [], changed: false });
    expect(dbMocks.findMany).not.toHaveBeenCalled();
  });

  it("queries apps when the prompt has an app mention", async () => {
    dbMocks.findMany.mockResolvedValue([FOO_APP]);

    const result = await resolveStickyReferencedApps({
      prompt: "Please compare @app:foo.app.com.",
      persistedAppIds: [],
    });

    expect(dbMocks.findMany).toHaveBeenCalledTimes(1);
    expect(result.references).toEqual([
      { appName: "foo.app.com", appPath: "/dyad-apps/foo-app" },
    ]);
    expect(result.appIds).toEqual([1]);
    expect(result.changed).toBe(true);
  });

  it("resolves an app mention whose known name contains spaces", async () => {
    dbMocks.findMany.mockResolvedValue([SPACED_APP]);

    const result = await resolveStickyReferencedApps({
      prompt: "Please compare @app:App With Spaces.",
      persistedAppIds: [],
    });

    expect(result.references).toEqual([
      {
        appName: "App With Spaces",
        appPath: "/dyad-apps/spaced-app",
      },
    ]);
    expect(result.appIds).toEqual([3]);
    expect(result.changed).toBe(true);
  });

  it("keeps stored references available when the prompt does not mention them", async () => {
    dbMocks.findMany.mockResolvedValue([FOO_APP]);

    const result = await resolveStickyReferencedApps({
      prompt: "Now apply the same change here",
      persistedAppIds: [1],
    });

    expect(result.references).toEqual([
      { appName: "foo.app.com", appPath: "/dyad-apps/foo-app" },
    ]);
    expect(result.appIds).toEqual([1]);
    // Nothing new, so the chat row does not need rewriting.
    expect(result.changed).toBe(false);
  });

  it("appends newly mentioned apps after the stored ones without duplicating", async () => {
    dbMocks.findMany.mockResolvedValue([FOO_APP, BAR_APP]);

    const result = await resolveStickyReferencedApps({
      prompt: "Also look at @app:bar and @app:foo.app.com",
      persistedAppIds: [1],
    });

    expect(result.references.map((ref) => ref.appName)).toEqual([
      "foo.app.com",
      "bar",
    ]);
    expect(result.appIds).toEqual([1, 2]);
    expect(result.changed).toBe(true);
  });

  it("prunes stored references whose app no longer exists", async () => {
    dbMocks.findMany.mockResolvedValue([FOO_APP]);

    const result = await resolveStickyReferencedApps({
      prompt: "Keep going",
      persistedAppIds: [1, 99],
    });

    expect(result.appIds).toEqual([1]);
    expect(result.changed).toBe(true);
  });

  it("never references the current app, even if it was stored earlier", async () => {
    dbMocks.findMany.mockResolvedValue([FOO_APP, BAR_APP]);

    const result = await resolveStickyReferencedApps({
      prompt: "Keep going",
      persistedAppIds: [1, 2],
      excludeCurrentAppId: 2,
    });

    expect(result.appIds).toEqual([1]);
  });

  it("resolves stored app paths fresh so renames and moves are picked up", async () => {
    dbMocks.findMany.mockResolvedValue([
      { ...FOO_APP, name: "renamed", path: "moved-app" },
    ]);

    const result = await resolveStickyReferencedApps({
      prompt: "Keep going",
      persistedAppIds: [1],
    });

    expect(result.references).toEqual([
      { appName: "renamed", appPath: "/dyad-apps/moved-app" },
    ]);
    expect(result.changed).toBe(false);
  });

  it("invalidates the chat when references are persisted mid-turn", async () => {
    await persistReferencedAppIds(7, [1, 2]);

    expect(dbMocks.set).toHaveBeenCalledWith({ referencedAppIds: [1, 2] });
    // Without the id predicate the UPDATE would rewrite every chat row.
    expect(dbMocks.where).toHaveBeenCalledExactlyOnceWith(eq(chats.id, 7));
    // The turn only invalidates the chat once it terminates, so the write has
    // to announce itself or the composer's chip row lags a whole turn behind.
    expect(
      invalidationMocks.publishQueryInvalidations,
    ).toHaveBeenCalledExactlyOnceWith([{ family: "chat", chatId: 7 }]);
  });

  it("ignores malformed stored values", () => {
    expect(readStoredReferencedAppIds(null)).toEqual([]);
    expect(readStoredReferencedAppIds(undefined)).toEqual([]);
    expect(
      readStoredReferencedAppIds(["1", 2, null] as unknown as number[]),
    ).toEqual([2]);
  });
});
