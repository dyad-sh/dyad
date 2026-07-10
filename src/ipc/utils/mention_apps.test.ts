import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      apps: {
        findMany: dbMocks.findMany,
      },
    },
  },
}));

vi.mock("@/paths/paths", () => ({
  getDyadAppPath: vi.fn((appPath: string) => `/dyad-apps/${appPath}`),
}));

vi.mock("@/utils/codebase", () => ({
  DEFAULT_CODEBASE_EXTRACTION_LIMITS: {
    maxFiles: 2_000,
    maxTotalBytes: 20 * 1024 * 1024,
    ioConcurrency: 16,
  },
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

import {
  extractMentionedAppsCodebasesFromPrompt,
  extractMentionedAppsReferencesFromPrompt,
} from "@/ipc/utils/mention_apps";
import { extractCodebase } from "@/utils/codebase";

describe("mention app utilities", () => {
  beforeEach(() => {
    dbMocks.findMany.mockReset();
    vi.mocked(extractCodebase).mockReset();
  });

  it("does not query apps when the prompt has no app mentions", async () => {
    const result = await extractMentionedAppsReferencesFromPrompt(
      "Please update the landing page",
    );

    expect(result).toEqual([]);
    expect(dbMocks.findMany).not.toHaveBeenCalled();
  });

  it("queries apps when the prompt has an app mention", async () => {
    dbMocks.findMany.mockResolvedValue([
      {
        id: 1,
        name: "foo.app.com",
        path: "foo-app",
      },
    ]);

    const result = await extractMentionedAppsReferencesFromPrompt(
      "Please compare @app:foo.app.com.",
    );

    expect(dbMocks.findMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        appName: "foo.app.com",
        appPath: "/dyad-apps/foo-app",
      },
    ]);
  });

  it("shares one extraction budget across all mentioned apps", async () => {
    dbMocks.findMany.mockResolvedValue([
      {
        id: 1,
        name: "First",
        path: "first",
        chatContext: { contextPaths: [], smartContextAutoIncludes: [] },
      },
      {
        id: 2,
        name: "Second",
        path: "second",
        chatContext: { contextPaths: [], smartContextAutoIncludes: [] },
      },
    ]);
    vi.mocked(extractCodebase)
      .mockResolvedValueOnce({
        formattedOutput: "first",
        files: [{ path: "first.ts", content: "1234567890", force: false }],
        includedContentBytes: 10,
      })
      .mockResolvedValueOnce({
        formattedOutput: "second",
        files: [{ path: "second.ts", content: "12345", force: false }],
        includedContentBytes: 5,
      });

    const result = await extractMentionedAppsCodebasesFromPrompt(
      "Compare @app:First and @app:Second",
    );

    expect(result).toHaveLength(2);
    expect(extractCodebase).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        limits: { maxFiles: 2_000, maxTotalBytes: 20 * 1024 * 1024 },
      }),
    );
    expect(extractCodebase).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        limits: {
          maxFiles: 1_999,
          maxTotalBytes: 20 * 1024 * 1024 - 10,
        },
      }),
    );
  });
});
