import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPlaywrightConfig,
  detectSystemBrowserChannel,
  isPlaywrightBrowserInstalled,
  TEST_BASE_URL_ENV,
  TEST_RESULTS_JSON,
} from "./playwright_bootstrap";

const tempDirs: string[] = [];
const BROWSER_MARKER = path.join(
  "node_modules",
  ".dyad-playwright-chromium-installed",
);

function makeAppWithBrowserMarker({
  packageVersion,
  markerVersion,
  executableExists,
  markerText,
}: {
  packageVersion: string;
  markerVersion?: string;
  executableExists?: boolean;
  markerText?: string;
}): { appPath: string; executablePath: string } {
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-pw-"));
  tempDirs.push(appPath);
  fs.mkdirSync(path.join(appPath, "node_modules", "@playwright", "test"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(appPath, "node_modules", "@playwright", "test", "package.json"),
    JSON.stringify({ version: packageVersion }),
  );
  const executablePath = path.join(appPath, "chromium");
  if (executableExists) {
    fs.writeFileSync(executablePath, "");
  }
  fs.writeFileSync(
    path.join(appPath, BROWSER_MARKER),
    markerText ??
      JSON.stringify({
        playwrightVersion: markerVersion ?? packageVersion,
        executablePath,
      }),
  );
  return { appPath, executablePath };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("buildPlaywrightConfig", () => {
  it("drives the system browser via channel when provided (no download)", () => {
    const config = buildPlaywrightConfig("chrome");
    expect(config).toContain('channel: "chrome"');
    expect(config).toContain("no extra browser download");
  });

  it("omits channel for bundled chromium", () => {
    const config = buildPlaywrightConfig(null);
    expect(config).not.toContain("channel:");
    expect(config).toContain("bundled Chromium");
  });

  it("wires baseURL from env and the json reporter output path", () => {
    const config = buildPlaywrightConfig(null);
    expect(config).toContain(`process.env.${TEST_BASE_URL_ENV}`);
    expect(config).toContain(TEST_RESULTS_JSON);
    // baseURL points at the running proxy, never a webServer config block.
    expect(config).not.toContain("webServer:");
  });
});

describe("detectSystemBrowserChannel", () => {
  it("returns a supported channel or null", () => {
    const channel = detectSystemBrowserChannel();
    expect([null, "chrome", "msedge"]).toContain(channel);
  });
});

describe("isPlaywrightBrowserInstalled", () => {
  it("accepts a marker only when the Playwright version and executable match", () => {
    const { appPath, executablePath } = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: true,
    });

    expect(isPlaywrightBrowserInstalled(appPath)).toBe(true);

    fs.rmSync(executablePath);
    expect(isPlaywrightBrowserInstalled(appPath)).toBe(false);
  });

  it("invalidates stale or legacy markers", () => {
    const stale = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      markerVersion: "1.2.2",
      executableExists: true,
    });
    const legacy = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      markerText: "ok",
      executableExists: true,
    });

    expect(isPlaywrightBrowserInstalled(stale.appPath)).toBe(false);
    expect(isPlaywrightBrowserInstalled(legacy.appPath)).toBe(false);
  });
});
