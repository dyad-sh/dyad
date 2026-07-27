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
  appendReferencedAppsReminder,
  extractMentionedAppsReferencesFromPrompt,
} from "@/ipc/utils/mention_apps";

describe("mention app utilities", () => {
  beforeEach(() => {
    dbMocks.findMany.mockReset();
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

  it("adds the referenced app allow-list and read-only boundary to the prompt", () => {
    const reminder = appendReferencedAppsReminder(
      "Compare @app:Foo and @app:Bar",
      [{ appName: "Foo" }, { appName: "Bar" }],
    );

    expect(reminder).toContain(
      "following apps in their prompt: `Foo`, `Bar`. These apps are separate from the current app and are READ-ONLY",
    );
    expect(reminder).toContain("`read_file`, `list_files`, `grep`");
    expect(reminder).not.toContain("code_search");
  });

  it("leaves prompts without referenced apps unchanged", () => {
    expect(appendReferencedAppsReminder("Update the page", [])).toBe(
      "Update the page",
    );
  });
});
