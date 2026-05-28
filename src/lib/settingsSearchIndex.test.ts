import { describe, expect, it } from "vitest";
import {
  SECTION_IDS,
  SETTING_IDS,
  SETTINGS_SEARCH_INDEX,
} from "./settingsSearchIndex";

describe("SETTINGS_SEARCH_INDEX", () => {
  it("includes the cloud sandbox experiment", () => {
    expect(
      SETTINGS_SEARCH_INDEX.find(
        (item) => item.id === SETTING_IDS.enableCloudSandbox,
      ),
    ).toEqual({
      id: SETTING_IDS.enableCloudSandbox,
      label: "Enable Cloud Sandbox (Pro)",
      description:
        "Run your app on the Cloud for a more secure runtime that uses fewer local system resources",
      keywords: [
        "cloud",
        "sandbox",
        "runtime",
        "experiment",
        "pro",
        "credits",
        "secure",
      ],
      sectionId: SECTION_IDS.experiments,
      sectionLabel: "Experiments",
    });
  });

  it("includes the block unsafe npm packages experiment", () => {
    expect(
      SETTINGS_SEARCH_INDEX.find(
        (item) => item.id === SETTING_IDS.blockUnsafeNpmPackages,
      ),
    ).toEqual({
      id: SETTING_IDS.blockUnsafeNpmPackages,
      label: "Block unsafe npm packages",
      description: "Uses socket.dev to detect unsafe packages and blocks them",
      keywords: ["socket", "npm", "firewall", "package", "unsafe", "security"],
      sectionId: SECTION_IDS.advanced,
      sectionLabel: "Advanced",
    });
  });

  it("includes the pnpm upgrade warning experiment", () => {
    expect(
      SETTINGS_SEARCH_INDEX.find(
        (item) => item.id === SETTING_IDS.enablePnpmMinimumReleaseAgeWarning,
      ),
    ).toEqual({
      id: SETTING_IDS.enablePnpmMinimumReleaseAgeWarning,
      label: "Enable pnpm upgrade warning",
      description:
        "Show the pnpm release-age warning toast and one-click pnpm upgrade action",
      keywords: [
        "pnpm",
        "npm",
        "package",
        "release",
        "warning",
        "toast",
        "upgrade",
        "experiment",
      ],
      sectionId: SECTION_IDS.experiments,
      sectionLabel: "Experiments",
    });
  });

  it("includes the sandbox script execution setting", () => {
    expect(
      SETTINGS_SEARCH_INDEX.find(
        (item) => item.id === SETTING_IDS.enableSandboxScriptExecution,
      ),
    ).toEqual({
      id: SETTING_IDS.enableSandboxScriptExecution,
      label: "Enable sandbox script execution",
      description:
        "Allow local-agent attachment scripts to inspect files with execute_sandbox_script",
      keywords: [
        "script",
        "scripts",
        "sandbox",
        "attachments",
        "mustard",
        "agent",
      ],
      sectionId: SECTION_IDS.advanced,
      sectionLabel: "Advanced",
    });
  });
});
