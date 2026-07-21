import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPlaywrightConfig,
  detectSystemBrowserChannel,
  DYAD_CONFIG_FILENAME,
  ensurePlaywrightBootstrap,
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
    expect(config).toContain('testDir: "./tests"');
    expect(config).toContain(`process.env.${TEST_BASE_URL_ENV}`);
    expect(config).toContain(TEST_RESULTS_JSON);
    // baseURL points at the running proxy, never a webServer config block.
    expect(config).not.toContain("webServer:");
  });
});

describe("ensurePlaywrightBootstrap", () => {
  // The fixture has @playwright/test and a valid browser marker, so bootstrap
  // reaches the config step without spawning an install.
  it("writes its own config and never touches the app's playwright.config.ts", async () => {
    const { appPath } = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: true,
    });
    // An app that already ships a legitimate Playwright setup of its own.
    const userConfigPath = path.join(appPath, "playwright.config.ts");
    const userConfig =
      'import { defineConfig } from "@playwright/test";\n' +
      'export default defineConfig({ testDir: "./e2e", use: { baseURL: "http://127.0.0.1:8080" } });\n';
    fs.writeFileSync(userConfigPath, userConfig);

    await ensurePlaywrightBootstrap({ appPath });

    // Ours lands under its own name, wired to the env var.
    const dyadConfigPath = path.join(appPath, DYAD_CONFIG_FILENAME);
    expect(fs.existsSync(dyadConfigPath)).toBe(true);
    expect(fs.readFileSync(dyadConfigPath, "utf8")).toContain(
      TEST_BASE_URL_ENV,
    );
    // The user's config survives byte-for-byte, with no backup left behind —
    // Dyad no longer takes over the canonical config name.
    expect(fs.readFileSync(userConfigPath, "utf8")).toBe(userConfig);
    expect(fs.existsSync(`${userConfigPath}.backup`)).toBe(false);
  });

  it("points the package.json test script at Dyad's config", async () => {
    const { appPath } = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: true,
    });
    fs.writeFileSync(
      path.join(appPath, "package.json"),
      JSON.stringify({ name: "app", scripts: {} }),
    );

    await ensurePlaywrightBootstrap({ appPath });

    // Playwright only auto-resolves `playwright.config.ts`, so a bare
    // `playwright test` would pick the app's config (or none) instead of ours.
    const pkg = JSON.parse(
      fs.readFileSync(path.join(appPath, "package.json"), "utf8"),
    );
    expect(pkg.scripts.test).toBe(
      `playwright test --config ${DYAD_CONFIG_FILENAME}`,
    );
  });

  it("migrates the old Dyad-generated bare test script", async () => {
    const { appPath } = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: true,
    });
    fs.writeFileSync(
      path.join(appPath, "package.json"),
      JSON.stringify({ name: "app", scripts: { test: "playwright test" } }),
    );

    await ensurePlaywrightBootstrap({ appPath });

    const pkg = JSON.parse(
      fs.readFileSync(path.join(appPath, "package.json"), "utf8"),
    );
    expect(pkg.scripts.test).toBe(
      `playwright test --config ${DYAD_CONFIG_FILENAME}`,
    );
  });

  it("leaves a bare test script alone when the app owns a playwright.config", async () => {
    const { appPath } = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: true,
    });
    fs.writeFileSync(
      path.join(appPath, "package.json"),
      JSON.stringify({ name: "app", scripts: { test: "playwright test" } }),
    );
    // With a config of their own, `playwright test` is the user's script
    // targeting the user's config — repointing it would bypass their projects
    // and global setup, and break `npm test` outside Dyad.
    fs.writeFileSync(
      path.join(appPath, "playwright.config.ts"),
      'import { defineConfig } from "@playwright/test";\nexport default defineConfig({});\n',
    );

    await ensurePlaywrightBootstrap({ appPath });

    const pkg = JSON.parse(
      fs.readFileSync(path.join(appPath, "package.json"), "utf8"),
    );
    expect(pkg.scripts.test).toBe("playwright test");
  });

  it("preserves user-authored test scripts", async () => {
    const { appPath } = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: true,
    });
    const script = "playwright test --project chromium";
    fs.writeFileSync(
      path.join(appPath, "package.json"),
      JSON.stringify({ name: "app", scripts: { test: script } }),
    );

    await ensurePlaywrightBootstrap({ appPath });

    const pkg = JSON.parse(
      fs.readFileSync(path.join(appPath, "package.json"), "utf8"),
    );
    expect(pkg.scripts.test).toBe(script);
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

  it("uses the replacement Playwright package after a symlink swap", () => {
    const { appPath } = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      markerText: JSON.stringify({ playwrightVersion: "1.2.3" }),
    });
    const playwrightLinkPath = path.join(appPath, "node_modules", "playwright");
    const writePlaywrightTarget = (name: string) => {
      const targetPath = path.join(appPath, name);
      const executablePath = path.join(targetPath, "chromium");
      fs.mkdirSync(targetPath);
      fs.writeFileSync(
        path.join(targetPath, "package.json"),
        JSON.stringify({ main: "index.js" }),
      );
      fs.writeFileSync(
        path.join(targetPath, "index.js"),
        `module.exports = { chromium: { executablePath: () => ${JSON.stringify(executablePath)} } };`,
      );
      fs.writeFileSync(executablePath, "");
      return { targetPath, executablePath };
    };
    const first = writePlaywrightTarget("playwright-1");
    const second = writePlaywrightTarget("playwright-2");
    const linkTarget = (targetPath: string) =>
      fs.symlinkSync(
        process.platform === "win32" ? path.resolve(targetPath) : targetPath,
        playwrightLinkPath,
        process.platform === "win32" ? "junction" : "dir",
      );

    linkTarget(first.targetPath);
    expect(isPlaywrightBrowserInstalled(appPath)).toBe(true);

    fs.rmSync(playwrightLinkPath, { recursive: true });
    fs.rmSync(first.executablePath);
    linkTarget(second.targetPath);

    expect(isPlaywrightBrowserInstalled(appPath)).toBe(true);
  });
});
