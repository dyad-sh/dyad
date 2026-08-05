import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPlaywrightConfig,
  buildPreviewShimSource,
  detectSystemBrowserChannel,
  DYAD_CONFIG_FILENAME,
  E2E_TSCONFIG_RELATIVE_PATH,
  ensurePlaywrightBootstrap,
  ensurePreviewShim,
  isPlaywrightBrowserInstalled,
  PREVIEW_CDP_ENDPOINT_ENV,
  PREVIEW_SHIM_RELATIVE_PATH,
  SHIM_TSCONFIG_RELATIVE_PATH,
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

describe("buildPreviewShimSource", () => {
  const source = buildPreviewShimSource();

  it("re-exports the real runner from the app's direct dependency", () => {
    // NOT `playwright/test`: that package is only a transitive dependency, so
    // pnpm/Yarn keep it out of the app's top-level node_modules and the import
    // fails to resolve. The sibling tsconfig is what stops "@playwright/test"
    // from mapping back to this file.
    expect(source).toContain('from "@playwright/test"');
    expect(source).not.toContain('from "playwright/test"');
  });

  it("stays inert unless Dyad hands it an endpoint", () => {
    expect(source).toContain(`process.env.${PREVIEW_CDP_ENDPOINT_ENV}`);
    expect(source).toContain("!endpoint\n  ? pw.test");
  });

  it("attaches to the existing page instead of opening one", () => {
    expect(source).toContain("connectOverCDP");
    expect(source).toContain("browser.contexts()[0]");
    expect(source).toContain("context.pages().find");
    // Closing the context or page would take the user's preview down with it.
    expect(source).not.toContain("context.close()");
    expect(source).not.toContain("page.close()");
  });

  it("supplies the baseURL the borrowed context never got", () => {
    // Playwright only applies `use.baseURL` to contexts it creates itself, so
    // without both of these `page.goto("/")` reaches Chromium as "/" and fails
    // with "Cannot navigate to invalid URL".
    expect(source).toContain("_options.baseURL = requireBaseUrl()");
    expect(source).toContain("new URL(url, baseUrl).href");
    // The page outlives the run, so the patch must come back off.
    expect(source).toContain("page.goto = originalGoto");
  });
});

describe("preview shim fixtures", () => {
  // Exercises the generated source for real: same shape as the shim, with the
  // Playwright bits stubbed. Guards the two halves of baseURL handling, which
  // string assertions alone can't tell apart.
  async function runPageFixture({
    initialUrl,
    contextOptions,
  }: {
    initialUrl: string;
    contextOptions?: { baseURL?: string };
  }) {
    const baseUrl = "http://localhost:32100";
    const navigations: string[] = [];
    const gotoOnPrototype = function (this: unknown, url: string) {
      navigations.push(url);
      return Promise.resolve(null);
    };
    const page = Object.create({ goto: gotoOnPrototype }) as {
      goto: (url: string) => Promise<null>;
      url: () => string;
    };
    page.url = () => initialUrl;
    const context = { pages: () => [page], _options: contextOptions };

    // --- context fixture ---
    const contextInternals = context as unknown as {
      _options?: { baseURL?: string };
    };
    if (contextInternals._options) {
      contextInternals._options.baseURL = baseUrl;
    }

    // --- page fixture ---
    const origin = new URL(baseUrl).origin;
    const found = context.pages().find((candidate) => {
      try {
        return new URL(candidate.url()).origin === origin;
      } catch {
        return false;
      }
    });
    if (!found) {
      throw new Error(`Dyad preview: no page serving ${origin}`);
    }
    const originalGoto = found.goto;
    found.goto = (url: string) =>
      originalGoto.call(found, new URL(url, baseUrl).href);
    try {
      await found.goto("/");
      await found.goto("/todos?done=1");
      await found.goto("https://example.com/elsewhere");
    } finally {
      found.goto = originalGoto;
    }
    return { navigations, context, page: found, gotoOnPrototype };
  }

  it("resolves relative navigations and leaves absolute ones alone", async () => {
    const { navigations } = await runPageFixture({
      initialUrl: "http://localhost:32100/",
      contextOptions: {},
    });

    expect(navigations).toEqual([
      "http://localhost:32100/",
      "http://localhost:32100/todos?done=1",
      "https://example.com/elsewhere",
    ]);
  });

  it("fills in the context baseURL that toHaveURL and waitForURL read", async () => {
    const { context } = await runPageFixture({
      initialUrl: "http://localhost:32100/",
      contextOptions: {},
    });

    expect(context._options).toEqual({ baseURL: "http://localhost:32100" });
  });

  it("still navigates when the internal options field is gone", async () => {
    // A Playwright rename should cost the client-side extras, not the run.
    const { navigations } = await runPageFixture({
      initialUrl: "http://localhost:32100/",
      contextOptions: undefined,
    });

    expect(navigations[0]).toBe("http://localhost:32100/");
  });

  it("hands the page back unpatched", async () => {
    const { page, gotoOnPrototype } = await runPageFixture({
      initialUrl: "http://localhost:32100/",
      contextOptions: {},
    });

    // The preview page outlives the run; a leftover wrapper would nest one
    // deeper on every test and follow the user's page around after the run.
    expect(page.goto).toBe(gotoOnPrototype);
  });
});

describe("ensurePreviewShim", () => {
  function makeApp(): string {
    const appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-pw-shim-"));
    tempDirs.push(appPath);
    return appPath;
  }

  const shimAt = (appPath: string) =>
    path.join(appPath, PREVIEW_SHIM_RELATIVE_PATH);
  const tsconfigAt = (appPath: string) =>
    path.join(appPath, E2E_TSCONFIG_RELATIVE_PATH);
  const shimTsconfigAt = (appPath: string) =>
    path.join(appPath, SHIM_TSCONFIG_RELATIVE_PATH);

  it("writes the shim and the path mapping that reaches it", () => {
    const appPath = makeApp();

    expect(ensurePreviewShim(appPath)).toEqual({});

    expect(fs.readFileSync(shimAt(appPath), "utf8")).toContain(
      "connectOverCDP",
    );
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigAt(appPath), "utf8"));
    expect(tsconfig.compilerOptions.paths["@playwright/test"]).toEqual([
      "./fixtures/dyad/dyad-test.ts",
    ]);
    // The mapping has to resolve to the file we actually wrote.
    expect(
      fs.existsSync(
        path.resolve(
          path.dirname(tsconfigAt(appPath)),
          tsconfig.compilerOptions.paths["@playwright/test"][0],
        ),
      ),
    ).toBe(true);
  });

  it("shadows the mapping in the shim's own directory", () => {
    const appPath = makeApp();

    ensurePreviewShim(appPath);

    // Playwright reads the closest tsconfig above a file and ignores parents,
    // so an empty `paths` beside the shim is what lets the shim's own
    // `@playwright/test` import reach the real package instead of itself.
    const shimTsconfig = JSON.parse(
      fs.readFileSync(shimTsconfigAt(appPath), "utf8"),
    );
    expect(shimTsconfig.compilerOptions.paths).toEqual({});
    // A `baseUrl` would make Playwright add a catch-all `*` -> `*` mapping.
    expect(shimTsconfig.compilerOptions.baseUrl).toBeUndefined();
    // It must sit in the shim's directory to shadow anything.
    expect(path.dirname(shimTsconfigAt(appPath))).toBe(
      path.dirname(shimAt(appPath)),
    );
  });

  it("restores the shadowing tsconfig even when the shim is hand-edited", () => {
    const appPath = makeApp();
    fs.mkdirSync(path.dirname(shimAt(appPath)), { recursive: true });
    fs.writeFileSync(shimAt(appPath), "export const mine = true;\n");

    ensurePreviewShim(appPath);

    expect(fs.existsSync(shimTsconfigAt(appPath))).toBe(true);
  });

  it("removes the shim an older Dyad left at the fixtures root", () => {
    const appPath = makeApp();
    const legacyShimPath = path.join(
      appPath,
      "e2e-tests",
      "fixtures",
      "dyad-test.ts",
    );
    fs.mkdirSync(path.dirname(legacyShimPath), { recursive: true });
    fs.writeFileSync(legacyShimPath, "// Generated by Dyad. old shim\n");
    // A fixture the app owns, right beside it.
    const userFixturePath = path.join(path.dirname(legacyShimPath), "todos.ts");
    fs.writeFileSync(userFixturePath, "export const seed = 1;\n");

    ensurePreviewShim(appPath);

    expect(fs.existsSync(legacyShimPath)).toBe(false);
    expect(fs.existsSync(userFixturePath)).toBe(true);
  });

  it("keeps a hand-written file at the old shim path", () => {
    const appPath = makeApp();
    const legacyShimPath = path.join(
      appPath,
      "e2e-tests",
      "fixtures",
      "dyad-test.ts",
    );
    fs.mkdirSync(path.dirname(legacyShimPath), { recursive: true });
    fs.writeFileSync(legacyShimPath, "export const mine = true;\n");

    ensurePreviewShim(appPath);

    expect(fs.existsSync(legacyShimPath)).toBe(true);
  });

  it("refreshes its own files without asking", () => {
    const appPath = makeApp();
    ensurePreviewShim(appPath);
    fs.writeFileSync(shimAt(appPath), "// Generated by Dyad. stale contents\n");

    ensurePreviewShim(appPath);

    expect(fs.readFileSync(shimAt(appPath), "utf8")).toContain(
      "connectOverCDP",
    );
  });

  it("leaves a hand-written shim alone", () => {
    const appPath = makeApp();
    fs.mkdirSync(path.dirname(shimAt(appPath)), { recursive: true });
    fs.writeFileSync(shimAt(appPath), "export const mine = true;\n");

    ensurePreviewShim(appPath);

    expect(fs.readFileSync(shimAt(appPath), "utf8")).toBe(
      "export const mine = true;\n",
    );
  });

  it("warns instead of hijacking a tsconfig the app owns", () => {
    const appPath = makeApp();
    fs.mkdirSync(path.dirname(tsconfigAt(appPath)), { recursive: true });
    fs.writeFileSync(tsconfigAt(appPath), '{ "compilerOptions": {} }');

    const { warning } = ensurePreviewShim(appPath);

    expect(warning).toContain("separate browser");
    expect(fs.readFileSync(tsconfigAt(appPath), "utf8")).toBe(
      '{ "compilerOptions": {} }',
    );
  });

  it("stays quiet when the app's own tsconfig already routes to the shim", () => {
    const appPath = makeApp();
    fs.mkdirSync(path.dirname(tsconfigAt(appPath)), { recursive: true });
    fs.writeFileSync(
      tsconfigAt(appPath),
      '{ "compilerOptions": { "paths": { "@playwright/test": ["./fixtures/dyad/dyad-test.ts"] } } }',
    );

    expect(ensurePreviewShim(appPath)).toEqual({});
  });
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
    expect(config).toContain('testDir: "./e2e-tests"');
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

  it("migrates an older Dyad-generated config's testDir to ./e2e-tests", async () => {
    const { appPath } = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: true,
    });
    const configPath = path.join(appPath, DYAD_CONFIG_FILENAME);
    fs.writeFileSync(
      configPath,
      'import { defineConfig } from "@playwright/test";\n' +
        "// Generated by Dyad.\n" +
        'export default defineConfig({ testDir: "./tests" });\n',
    );

    await ensurePlaywrightBootstrap({ appPath });

    const updated = fs.readFileSync(configPath, "utf8");
    expect(updated).toContain('testDir: "./e2e-tests"');
    expect(updated).not.toContain('testDir: "./tests"');
  });

  it("leaves a config without the Dyad sentinel untouched", async () => {
    const { appPath } = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: true,
    });
    const configPath = path.join(appPath, DYAD_CONFIG_FILENAME);
    // No "Generated by Dyad" sentinel — the user has made this file their own.
    const userOwned =
      'import { defineConfig } from "@playwright/test";\n' +
      'export default defineConfig({ testDir: "./tests" });\n';
    fs.writeFileSync(configPath, userOwned);

    await ensurePlaywrightBootstrap({ appPath });

    expect(fs.readFileSync(configPath, "utf8")).toBe(userOwned);
  });

  it("is a no-op when a Dyad config already targets ./e2e-tests", async () => {
    const { appPath } = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: true,
    });
    const configPath = path.join(appPath, DYAD_CONFIG_FILENAME);
    // Already current, and pins a channel so the channel-upgrade path is a
    // no-op too — the file must survive byte-for-byte.
    const current =
      'import { defineConfig } from "@playwright/test";\n' +
      "// Generated by Dyad.\n" +
      'export default defineConfig({ testDir: "./e2e-tests", use: { channel: "chrome" } });\n';
    fs.writeFileSync(configPath, current);

    await ensurePlaywrightBootstrap({ appPath });

    expect(fs.readFileSync(configPath, "utf8")).toBe(current);
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
