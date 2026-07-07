// @vitest-environment node
//
// Migrated from e2e-tests/neon_migration.spec.ts.
//
// The e2e drove the publish panel's unified Database section. Its dialogs
// (SQL review, destructive-change warnings, confirm, success toast) render
// what the migration:* IPC handlers return, so those handlers are exercised
// directly here with E2E_TEST_BUILD=true (same mock Neon client + mock schema
// diff the Playwright suite used).
//
// Ported behaviors:
//  - "neon migration push from publish panel": on the development branch,
//    picking the separate-production-database option persists the deploy
//    branch choice; migration:preview returns the diff SQL with destructive
//    statements flagged (a dropped table + a schema hazard — the two warnings
//    the e2e asserted in the review dialog); migration:migrate applies the
//    previewed plan successfully (the e2e's "Migration applied successfully.").
//  - "neon migration is skipped on the production branch": with main active,
//    migration:preview refuses (no migration step is offered), while the
//    production branch env vars remain available (the e2e's env-vars section
//    showing the main-branch DATABASE_URL).
//
// Dropped as UI-only: dialog layout/aria, button visibility, panel navigation.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  // Routes the Neon management client + schema diff to their mock test-build
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
import { registerNeonHandlers } from "@/ipc/handlers/neon_handlers";
import { registerMigrationHandlers } from "@/ipc/handlers/migration_handlers";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";

function makeEvent() {
  return {
    sender: {
      isDestroyed: () => false,
      isCrashed: () => false,
      send: () => {},
    },
  };
}

async function invoke(channel: string, params?: unknown): Promise<any> {
  const handler = h.ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  const response = await handler(makeEvent(), params);
  return isIpcInvokeEnvelope(response) ? unwrapIpcEnvelope(response) : response;
}

describe("neon migration (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
    // The e2e used the Next.js template. Mark the fixture app as Next.js so
    // the Neon link path matches (no Vite/Nitro server-layer setup).
    fs.writeFileSync(
      path.join(harness.appDir, "next.config.js"),
      "module.exports = {};\n",
    );
    registerNeonHandlers();
    registerMigrationHandlers();

    // Connect Neon and link "Test Project" (the e2e's connect-Neon +
    // select-project flow). The app lands on the development branch.
    await invoke("neon:fake-connect");
    const setResult = await invoke("neon:set-app-project", {
      appId: harness.appId,
      projectId: "test-project-id",
    });
    expect(setResult.success).toBe(true);
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("neon migration push from publish panel", async () => {
    // The app is on the development branch: choosing "Separate production
    // database" + Continue persists the deploy-branch selection.
    const select = await invoke("neon:set-selected-database-branch-type", {
      appId: harness.appId,
      branchType: "production",
    });
    expect(select.success).toBe(true);

    // "Migrate to Production" first computes the preview shown in the
    // "Review migration SQL" dialog.
    const preview = await invoke("migration:preview", {
      appId: harness.appId,
    });

    expect(preview.statements).toEqual([
      'CREATE TABLE "mock" ("id" serial)',
      'ALTER TABLE "mock" ADD COLUMN "name" text',
      'DROP TABLE "mock_legacy"',
      'GRANT SELECT ON TABLE "mock" TO "app_user"',
    ]);
    // "Destructive changes detected" banner.
    expect(preview.hasDataLoss).toBe(true);
    // "A table will be dropped." + "This statement includes a database hazard
    // such as a permission, lock, dependency, or data-safety risk." — the two
    // warning reasons rendered by the review dialog.
    expect(preview.warningReasons).toEqual(["drop_table", "schema_hazard"]);
    expect(preview.destructiveStatements).toEqual([
      { index: 2, reason: "drop_table" },
      { index: 3, reason: "schema_hazard" },
    ]);

    // Confirming ("I understand, migrate to production") applies the plan:
    // "Migration applied successfully."
    const migrate = await invoke("migration:migrate", {
      appId: harness.appId,
      migrationId: preview.migrationId,
    });
    expect(migrate).toEqual({ success: true });

    // The plan is consumed — replaying the same migrationId is rejected.
    await expect(
      invoke("migration:migrate", {
        appId: harness.appId,
        migrationId: preview.migrationId,
      }),
    ).rejects.toThrow(/expired or already applied/);
  }, 30_000);

  it("neon migration is skipped on the production branch", async () => {
    // Switch the app onto the production (main) branch.
    const switchToMain = await invoke("neon:set-active-branch", {
      appId: harness.appId,
      branchId: "test-main-branch-id",
    });
    expect(switchToMain.success).toBe(true);

    // On the production branch there is no migration step: a preview attempt
    // is refused (the publish panel renders the explanatory message instead
    // of the Migrate to Production button).
    await expect(
      invoke("migration:preview", { appId: harness.appId }),
    ).rejects.toThrow(
      "Active branch is the production branch. Create a development branch first.",
    );

    // The env vars section is still available for the production branch.
    const envVars = await invoke("neon:get-branch-env-vars", {
      appId: harness.appId,
      branchType: "production",
    });
    expect(envVars.databaseUrl).toBe(
      "postgresql://test:test@test-main.neon.tech/test",
    );
  }, 30_000);
});
