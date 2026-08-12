import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DyadErrorKind } from "@/errors/dyad_error";
import { activeRecordings } from "@/ipc/services/recording_registry";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: {
    getPath: vi.fn(() =>
      path.join(os.tmpdir(), "dyad-supabase-handler-user-data"),
    ),
    getAppPath: vi.fn(() => process.cwd()),
  },
}));

const { registerSupabaseHandlers } = await import("./supabase_handlers");

describe("Supabase app recording admission", () => {
  let harness: HandlerTestHarness;

  beforeEach(() => {
    activeRecordings.clear();
    harness = setupHandlerTestHarness();
    registerSupabaseHandlers();
    activeRecordings.set(7, {
      appId: 7,
      stop: () => {},
      done: Promise.resolve({ envRestored: true }),
    });
  });

  afterEach(() => {
    activeRecordings.clear();
    harness.dispose();
  });

  it.each([
    [
      "associating a project",
      "supabase:set-app-project",
      { appId: 7, projectId: "project", organizationSlug: "org" },
    ],
    ["removing a project", "supabase:unset-app-project", { app: 7 }],
    [
      "switching to a publishable key",
      "supabase:switch-app-to-publishable-key",
      { appId: 7 },
    ],
  ])("refuses %s while recording", async (_label, channel, input) => {
    await expect(harness.invokeHandler(channel, input)).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
    });
  });
});
