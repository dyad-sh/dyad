import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("credential startup ordering", () => {
  it("starts cloud reconciliation inside onReady after database and settings initialization", () => {
    const main = fs.readFileSync("src/main.ts", "utf8");
    const handlers = fs.readFileSync(
      "src/ipc/handlers/app_handlers.ts",
      "utf8",
    );
    const onReady = main.indexOf("export async function onReady()");
    const reconcile = main.indexOf("reconcileCloudSandboxes()");
    expect(onReady).toBeGreaterThan(-1);
    expect(reconcile).toBeGreaterThan(onReady);
    expect(reconcile).toBeGreaterThan(
      main.indexOf("initializeDatabase();", onReady),
    );
    expect(reconcile).toBeGreaterThan(
      main.indexOf("await readEffectiveSettings();", onReady),
    );
    expect(handlers).not.toContain("reconcileCloudSandboxes");
    expect(main).toContain("app.whenReady().then(onReady)");
  });
});
