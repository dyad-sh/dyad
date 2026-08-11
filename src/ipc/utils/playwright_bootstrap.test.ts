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
  TEST_SLOW_MO_ENV,
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

  it("attaches a screenshot of the page under test, not of Dyad", () => {
    // Playwright's own recorder shoots every page the connection can reach,
    // and over CDP that includes Dyad's windows — so a failing preview test
    // would attach a picture of the user's editor and hand it to the model.
    expect(source).toContain("testInfo.status !== testInfo.expectedStatus");
    expect(source).toContain('testInfo.attach("screenshot"');
    expect(source).toContain("await page.screenshot()");
  });

  it("carries the slow-motion delay on the connection", () => {
    // No browser is launched here, so the generated config's
    // `launchOptions.slowMo` never applies to a preview run.
    expect(source).toContain(`process.env.${TEST_SLOW_MO_ENV}`);
    expect(source).toContain("connectOverCDP(endpoint, { slowMo })");
  });

  it("attaches to the existing page instead of opening one", () => {
    expect(source).toContain("connectOverCDP");
    expect(source).toContain("browser.contexts()[0]");
    expect(source).toContain("context.pages().find");
    // Closing the context or page would take the user's preview down with it.
    expect(source).not.toContain("context.close()");
    expect(source).not.toContain("page.close()");
  });

  it("resolves relative URLs for API requests too", () => {
    // page.request/context.request resolve relative URLs in Playwright's
    // SERVER half, from the options the borrowed context was created with —
    // the client-side baseURL below never reaches them, so without this
    // `page.request.get("/api/x")` throws "Invalid URL", but only in a preview
    // run.
    expect(source).toContain("context.request as unknown as");
    expect(source).toContain(
      '["fetch", "get", "post", "put", "patch", "delete", "head"]',
    );
    // The context outlives the run, so the patches have to come back off.
    expect(source).toContain("api[name] = original");
  });

  it("supplies the baseURL the borrowed context never got", () => {
    // Playwright only applies `use.baseURL` to contexts it creates itself, so
    // without both of these `page.goto("/")` reaches Chromium as "/" and fails
    // with "Cannot navigate to invalid URL".
    expect(source).toContain("_options.baseURL = baseUrl");
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

  it("carries the app's own aliases into the mapping it shadows", () => {
    const appPath = makeApp();
    fs.writeFileSync(
      path.join(appPath, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
      }),
    );

    ensurePreviewShim(appPath);

    // Playwright and the editor both read `paths` from the CLOSEST tsconfig
    // and never merge in parents, so this file shadows the app's. Without the
    // copy, a spec importing "@/lib/routes" stops resolving the moment a
    // preview run writes it — for every later run, and in the editor.
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigAt(appPath), "utf8"));
    expect(tsconfig.compilerOptions.paths["@/*"]).toEqual(["../src/*"]);
    expect(tsconfig.compilerOptions.paths["@playwright/test"]).toEqual([
      "./fixtures/dyad/dyad-test.ts",
    ]);
  });

  it("inherits the app's compiler options instead of replacing them", () => {
    const appPath = makeApp();
    fs.writeFileSync(
      path.join(appPath, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
    );

    ensurePreviewShim(appPath);

    // As the closest tsconfig to the specs, this file decides ALL of their
    // compiler options — without `extends` it would swap the app's target,
    // lib, jsx and strictness for tsc's bare defaults.
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigAt(appPath), "utf8"));
    expect(tsconfig.extends).toBe("../tsconfig.json");
    // `extends` carries `files: []` from a solution-style root, which would
    // leave the specs in no project at all.
    expect(tsconfig.include).toContain("**/*.ts");
  });

  it("stands alone when the app has no tsconfig to inherit", () => {
    const appPath = makeApp();

    ensurePreviewShim(appPath);

    const tsconfig = JSON.parse(fs.readFileSync(tsconfigAt(appPath), "utf8"));
    expect(tsconfig.extends).toBeUndefined();
  });

  it("finds aliases a relative extends away", () => {
    const appPath = makeApp();
    fs.writeFileSync(
      path.join(appPath, "tsconfig.base.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: "src", paths: { "~/*": ["./lib/*"] } },
      }),
    );
    fs.writeFileSync(
      path.join(appPath, "tsconfig.json"),
      JSON.stringify({ extends: "./tsconfig.base.json" }),
    );

    ensurePreviewShim(appPath);

    // Rebased through the parent's `baseUrl`, not the file it lives in.
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigAt(appPath), "utf8"));
    expect(tsconfig.compilerOptions.paths["~/*"]).toEqual(["../src/lib/*"]);
  });

  it("reads aliases out of a tsconfig with comments and trailing commas", () => {
    const appPath = makeApp();
    // tsconfig is JSONC, and the templates apps start from are full of both.
    // Failing to parse doesn't leave the app as it was — this file still
    // shadows the app's `paths`, so the aliases would simply vanish.
    fs.writeFileSync(
      path.join(appPath, "tsconfig.json"),
      `{
        // The app's own aliases.
        "compilerOptions": {
          "baseUrl": ".", /* not the docs URL: https://example.com */
          "paths": { "@/*": ["./src/*"], },
        },
      }`,
    );

    ensurePreviewShim(appPath);

    const tsconfig = JSON.parse(fs.readFileSync(tsconfigAt(appPath), "utf8"));
    expect(tsconfig.compilerOptions.paths["@/*"]).toEqual(["../src/*"]);
  });

  it("resolves an extension-less extends as a file, not a directory", () => {
    const appPath = makeApp();
    fs.writeFileSync(
      path.join(appPath, "tsconfig.json"),
      JSON.stringify({ extends: "./tsconfig.base" }),
    );
    fs.writeFileSync(
      path.join(appPath, "tsconfig.base.json"),
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    );

    ensurePreviewShim(appPath);

    // TypeScript appends ".json" to an extends target; reading it as a
    // directory would lose the aliases this file then shadows.
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigAt(appPath), "utf8"));
    expect(tsconfig.compilerOptions.paths["@/*"]).toEqual(["../src/*"]);
  });

  it("finds aliases in a referenced project, as solution-style roots use", () => {
    const appPath = makeApp();
    fs.writeFileSync(
      path.join(appPath, "tsconfig.json"),
      JSON.stringify({
        files: [],
        references: [{ path: "./tsconfig.app.json" }],
      }),
    );
    fs.writeFileSync(
      path.join(appPath, "tsconfig.app.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
      }),
    );

    ensurePreviewShim(appPath);

    const tsconfig = JSON.parse(fs.readFileSync(tsconfigAt(appPath), "utf8"));
    expect(tsconfig.compilerOptions.paths["@/*"]).toEqual(["../src/*"]);
  });

  it("maps only the shim when the app really has no aliases", () => {
    const appPath = makeApp();
    fs.writeFileSync(
      path.join(appPath, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true } }),
    );

    ensurePreviewShim(appPath);

    const tsconfig = JSON.parse(fs.readFileSync(tsconfigAt(appPath), "utf8"));
    expect(Object.keys(tsconfig.compilerOptions.paths)).toEqual([
      "@playwright/test",
    ]);
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

  it("keeps the old shim alive while the app's tsconfig still maps to it", () => {
    const appPath = makeApp();
    const legacyShimPath = path.join(
      appPath,
      "e2e-tests",
      "fixtures",
      "dyad-test.ts",
    );
    fs.mkdirSync(path.dirname(legacyShimPath), { recursive: true });
    fs.writeFileSync(legacyShimPath, "// Generated by Dyad. old shim\n");
    // The mapping an older Dyad's warning told the user to add. Deleting the
    // file underneath it would leave "@playwright/test" resolving to nothing —
    // breaking every run in the app, not just preview ones.
    fs.writeFileSync(
      tsconfigAt(appPath),
      '{ "compilerOptions": { "paths": { "@playwright/test": ["./fixtures/dyad-test.ts"] } } }',
    );

    expect(ensurePreviewShim(appPath)).toEqual({});

    // Kept — but as a forwarder, not a copy of the shim. Their mapping is the
    // closest one above this file, so a copy's own "@playwright/test" import
    // would resolve straight back to itself. Relative imports aren't mapped.
    const forwarder = fs.readFileSync(legacyShimPath, "utf8");
    expect(forwarder).toContain('export * from "./dyad/dyad-test"');
    expect(forwarder).not.toContain('from "@playwright/test"');
    expect(forwarder).not.toContain("connectOverCDP");
  });

  it("restores an old shim a previous Dyad deleted out from under the mapping", () => {
    const appPath = makeApp();
    fs.mkdirSync(path.join(appPath, "e2e-tests"), { recursive: true });
    // Extensionless, which tsconfig paths commonly are: reading this as "not
    // the legacy shim" is what deletes the file the mapping resolves to.
    fs.writeFileSync(
      tsconfigAt(appPath),
      '{ "compilerOptions": { "paths": { "@playwright/test": ["fixtures/dyad-test"] } } }',
    );

    expect(ensurePreviewShim(appPath)).toEqual({});

    expect(
      fs.readFileSync(
        path.join(appPath, "e2e-tests", "fixtures", "dyad-test.ts"),
        "utf8",
      ),
    ).toContain('export * from "./dyad/dyad-test"');
    // And the real shim is where the forwarder points.
    expect(fs.existsSync(shimAt(appPath))).toBe(true);
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
    // The path it tells the user to map has to be the shim we actually wrote —
    // the one at the old location is deleted by this same call.
    expect(warning).toContain("./fixtures/dyad/dyad-test.ts");
    expect(
      fs.existsSync(path.join(appPath, "e2e-tests/fixtures/dyad/dyad-test.ts")),
    ).toBe(true);
    expect(fs.readFileSync(tsconfigAt(appPath), "utf8")).toBe(
      '{ "compilerOptions": {} }',
    );
  });

  it("warns when the app's tsconfig only mentions the shim in passing", () => {
    const appPath = makeApp();
    fs.mkdirSync(path.dirname(tsconfigAt(appPath)), { recursive: true });
    // Named in `include`, but "@playwright/test" is not mapped to it. Reading
    // this as routed would keep the CDP endpoint and drop --headed, leaving
    // the user watching an empty preview while a headless browser ran.
    fs.writeFileSync(
      tsconfigAt(appPath),
      '{ "include": ["./fixtures/dyad/dyad-test.ts"], "compilerOptions": {} }',
    );

    expect(ensurePreviewShim(appPath).warning).toContain("separate browser");
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

  it("takes the slow-motion delay from the env, defaulting to full speed", () => {
    const config = buildPlaywrightConfig(null);
    // Playwright has no CLI flag for slowMo, so the delay arrives as an env
    // var. Unset has to mean 0, or every ordinary run would crawl.
    expect(config).toContain(
      `launchOptions: { slowMo: Number(process.env.${TEST_SLOW_MO_ENV}) || 0 }`,
    );
  });

  it("records no artifacts of its own during a preview run", () => {
    const config = buildPlaywrightConfig(null);
    // Both recorders capture every page in the connection/context, which for a
    // preview run includes Dyad's own windows. The shim attaches a screenshot
    // of the page under test instead.
    expect(config).toContain(
      `screenshot: process.env.${PREVIEW_CDP_ENDPOINT_ENV}`,
    );
    expect(config).toContain(`trace: process.env.${PREVIEW_CDP_ENDPOINT_ENV}`);
    // ...and an ordinary run still gets both.
    expect(config).toContain('"only-on-failure"');
    expect(config).toContain('"retain-on-failure"');
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

  it("teaches an older Dyad-generated config the slow-motion option", async () => {
    const { appPath } = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: true,
    });
    const configPath = path.join(appPath, DYAD_CONFIG_FILENAME);
    // Written before the Tests panel had the toggle. Pins a channel so the
    // channel-upgrade path can't rewrite the whole file instead.
    fs.writeFileSync(
      configPath,
      'import { defineConfig } from "@playwright/test";\n' +
        "// Generated by Dyad.\n" +
        "export default defineConfig({\n" +
        '  testDir: "./e2e-tests",\n' +
        "  use: {\n" +
        `    baseURL: process.env.${TEST_BASE_URL_ENV} || "http://localhost:32100",\n` +
        '    channel: "chrome",\n' +
        "  },\n" +
        "});\n",
    );

    await ensurePlaywrightBootstrap({ appPath });

    const updated = fs.readFileSync(configPath, "utf8");
    // Without this the panel's toggle would silently do nothing for apps
    // bootstrapped by an older Dyad.
    expect(updated).toContain(
      `launchOptions: { slowMo: Number(process.env.${TEST_SLOW_MO_ENV}) || 0 }`,
    );
    // Spliced in, so the channel the config already chose survives.
    expect(updated).toContain('channel: "chrome"');

    // And it's a no-op the second time around.
    await ensurePlaywrightBootstrap({ appPath });
    expect(fs.readFileSync(configPath, "utf8")).toBe(updated);
  });

  it("reports whether specs actually reach the preview shim", async () => {
    const routed = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: true,
    });
    const owned = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: true,
    });
    // An app that owns the tsconfig the mapping would go in: bootstrap won't
    // hijack it, so the specs import the real @playwright/test and launch
    // their own browser. The caller has to know its preview run just became an
    // ordinary one.
    const ownedTsconfig = path.join(owned.appPath, E2E_TSCONFIG_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(ownedTsconfig), { recursive: true });
    fs.writeFileSync(ownedTsconfig, '{ "compilerOptions": {} }');

    expect(
      await ensurePlaywrightBootstrap({
        appPath: routed.appPath,
        ensurePreviewShim: true,
      }),
    ).toMatchObject({ previewRouted: true });
    expect(
      await ensurePlaywrightBootstrap({
        appPath: owned.appPath,
        ensurePreviewShim: true,
      }),
    ).toMatchObject({ previewRouted: false });
    // Not asked for, not routed.
    expect(
      await ensurePlaywrightBootstrap({ appPath: routed.appPath }),
    ).toMatchObject({ previewRouted: false });
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
