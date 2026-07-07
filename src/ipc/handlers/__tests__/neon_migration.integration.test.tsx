import fs from "node:fs";
import path from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.hoisted(() => {
  process.env.E2E_TEST_BUILD = "true";
});

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";

import { apps } from "@/db/schema";
import { writeSettings } from "@/main/settings";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("Neon migration actions (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      testBuild: true,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
    writeSettings({ neon: undefined });
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  function connectNeonAccount() {
    writeSettings({
      isTestMode: true,
      neon: {
        accessToken: { value: "fake-neon-access-token" },
        refreshToken: { value: "fake-neon-refresh-token" },
        expiresIn: 3600,
        tokenTimestamp: Math.floor(Date.now() / 1000),
      },
    });
  }

  async function seedNeonApp({
    activeBranchId,
    selectedDatabaseBranchType = null,
  }: {
    activeBranchId: string;
    selectedDatabaseBranchType?: "production" | "development" | null;
  }) {
    connectNeonAccount();
    fs.writeFileSync(
      path.join(harness.appDir, "package.json"),
      JSON.stringify(
        {
          name: "neon-migration-app",
          private: true,
          scripts: { dev: "next dev" },
          dependencies: {
            next: "^15.0.0",
            react: "^19.0.0",
            "react-dom": "^19.0.0",
          },
        },
        null,
        2,
      ) + "\n",
    );
    fs.writeFileSync(
      path.join(harness.appDir, "next.config.ts"),
      "export default {};\n",
    );

    await harness.db
      .update(apps)
      .set({
        neonProjectId: "test-project-id",
        neonDevelopmentBranchId: "test-development-branch-id",
        neonActiveBranchId: activeBranchId,
        selectedDatabaseBranchType,
      })
      .where(eq(apps.id, harness.appId));
  }

  function mountDatabaseSection() {
    harness.mountSurface({
      route: "/database",
      appId: harness.appId,
    });
  }

  async function appRow() {
    return harness.db.query.apps.findFirst({
      where: eq(apps.id, harness.appId),
    });
  }

  it("reviews destructive SQL and applies migration from development to production", async () => {
    await seedNeonApp({ activeBranchId: "test-development-branch-id" });
    mountDatabaseSection();

    const databaseSection = await screen.findByTestId("database-section");
    expect(databaseSection.textContent).toContain(
      "Pick the database your deployed app should connect to.",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /^Separate production database\b/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByRole("button", { name: "Migrate to Production" });
    await waitFor(async () => {
      expect((await appRow())?.selectedDatabaseBranchType).toBe("production");
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Migrate to Production" }),
    );

    await screen.findByRole("dialog", { name: "Review migration SQL" });
    await screen.findByText("Destructive changes detected");
    await screen.findByText("A table will be dropped.");
    await screen.findByText(
      "This statement includes a database hazard such as a permission, lock, dependency, or data-safety risk.",
    );
    await screen.findByText('DROP TABLE "mock_legacy"');
    fireEvent.click(
      screen.getByRole("button", { name: "I understand, continue" }),
    );

    await screen.findByText(
      "This will modify the main schema in Test Project using the schema from development. Are you sure you want to continue?",
    );
    await screen.findByText(
      "This migration includes destructive changes that may result in data loss.",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "I understand, migrate to production",
      }),
    );

    await screen.findByText("Migration applied successfully.");
  }, 60_000);

  it("skips migration and shows production env vars on the production branch", async () => {
    await seedNeonApp({
      activeBranchId: "test-main-branch-id",
      selectedDatabaseBranchType: "production",
    });
    mountDatabaseSection();

    const databaseSection = await screen.findByTestId("database-section");
    await screen.findByText(
      "Your app is on the production branch, so the production database will be used for deployment. No migration is needed.",
    );
    expect(
      screen.queryByRole("button", { name: "Migrate to Production" }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Environment variables" }),
    );

    await waitFor(() => {
      expect(
        (
          screen.getByLabelText("DATABASE_URL", {
            selector: "input",
          }) as HTMLInputElement
        ).value,
      ).toBe("postgresql://test:test@test-main.neon.tech/test");
    });
    expect(databaseSection).toBeTruthy();
  }, 60_000);
});
