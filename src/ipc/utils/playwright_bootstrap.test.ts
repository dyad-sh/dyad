import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as esbuild from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  spawnStreaming: vi.fn(),
}));

vi.mock("./spawn_streaming", () => ({
  spawnStreaming: h.spawnStreaming,
}));

import {
  buildPlaywrightConfig,
  buildPreviewShimSource,
  configSetsTimeout,
  detectSystemBrowserChannel,
  DYAD_CONFIG_FILENAME,
  E2E_TSCONFIG_RELATIVE_PATH,
  ensurePlaywrightBootstrap,
  ensurePreviewShim,
  isPlaywrightBrowserInstalled,
  refreshGeneratedE2eTsconfig,
  PREVIEW_CDP_ENDPOINT_ENV,
  PREVIEW_CDP_TOKEN_ENV,
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
  h.spawnStreaming.mockReset();
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
    expect(source).toContain("connectOverCDP(endpoint, {");
    expect(source).toContain("headers: { Authorization:");
  });

  it("attaches to the existing page instead of opening one", () => {
    expect(source).toContain("connectOverCDP");
    expect(source).toContain("requirePreviewContext(browser)");
    expect(source).toContain("contexts.length !== 1");
    expect(source).toContain("context.pages().find");
    // Closing the context or page would take the user's preview down with it.
    expect(source).not.toContain("context.close()");
    expect(source).not.toContain("page.close()");
  });

  it("fails closed if the broker exposes more than the preview context", () => {
    expect(source).toContain("instead of exactly one");
    expect(source).not.toContain("protectNonPreviewContexts");
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
  /**
   * Compiles and runs the REAL generated shim against a stubbed
   * `@playwright/test`, then drives the fixtures it registered.
   *
   * Reimplementing the fixture bodies here would be worse than no test: the
   * string assertions above can't tell the two halves of baseURL handling
   * apart, so a change to `buildPreviewShimSource()` would leave a hand-copied
   * version green while the shipped shim was broken.
   */
  async function loadShimFixtures(
    browserToConnect: unknown = { close: async () => {} },
  ) {
    const source = buildPreviewShimSource();
    const { code } = await esbuild.transform(source, {
      loader: "ts",
      format: "cjs",
      target: "node20",
    });

    let registered: Record<string, unknown> = {};
    const pwStub = {
      test: {
        extend: (fixtures: Record<string, unknown>) => {
          registered = fixtures;
          return fixtures;
        },
      },
      expect: () => {},
      chromium: { connectOverCDP: async () => browserToConnect },
    };

    const module = { exports: {} as Record<string, unknown> };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function("require", "module", "exports", "process", code)(
      (specifier: string) => {
        if (specifier !== "@playwright/test") {
          throw new Error(`Unexpected import in the shim: ${specifier}`);
        }
        return pwStub;
      },
      module,
      module.exports,
      {
        ...process,
        env: {
          ...process.env,
          [PREVIEW_CDP_ENDPOINT_ENV]: "http://127.0.0.1:9222",
          [PREVIEW_CDP_TOKEN_ENV]: "test-token",
          [TEST_BASE_URL_ENV]: BASE_URL,
        },
      },
    );

    return registered as {
      browser: [FixtureFn, { scope: "worker" }];
      context: FixtureFn;
      page: FixtureFn;
    };
  }

  type FixtureFn = (
    deps: Record<string, unknown>,
    use: (value: unknown) => Promise<void>,
    testInfo: unknown,
  ) => Promise<void>;

  const BASE_URL = "http://localhost:32100";

  const PASSING_TEST_INFO = {
    status: "passed",
    expectedStatus: "passed",
    attach: async () => {},
  };

  function makeApiStub() {
    const calls: string[] = [];
    const record = (name: string) => (url: unknown, _options?: unknown) => {
      calls.push(`${name}:${String(url)}`);
      return Promise.resolve(
        name === "post"
          ? {
              ok: () => true,
            }
          : null,
      );
    };
    return {
      calls,
      api: {
        fetch: record("fetch"),
        get: record("get"),
        post: record("post"),
        put: record("put"),
        patch: record("patch"),
        delete: record("delete"),
        head: record("head"),
      },
    };
  }

  it("rejects a broker that exposes any extra browser context", async () => {
    const browser = { contexts: () => [{}, {}] };
    const fixtures = await loadShimFixtures(browser);

    await expect(
      fixtures.context({ browser }, async () => {}, PASSING_TEST_INFO),
    ).rejects.toThrow("instead of exactly one");
  });

  async function runPageFixture({
    initialUrl,
    contextOptions,
  }: {
    initialUrl: string;
    contextOptions?: { baseURL?: string };
  }) {
    const fixtures = await loadShimFixtures();

    const navigations: string[] = [];
    const gotoOnPrototype = function (this: unknown, url: string) {
      navigations.push(url);
      return Promise.resolve(null);
    };
    const page = Object.create({ goto: gotoOnPrototype }) as {
      goto: (url: string) => Promise<null>;
      url: () => string;
      evaluate: (fn: unknown, arg: unknown) => Promise<unknown>;
    };
    const browserAuthRequests: unknown[] = [];
    page.url = () => initialUrl;
    page.evaluate = async (_fn, arg) => {
      if (typeof arg === "string") return arg === "selected-preview";
      browserAuthRequests.push(arg);
      return { ok: true, status: 200 };
    };

    const { calls, api } = makeApiStub();
    const originalApi = { ...api };
    const context = {
      pages: () => [page],
      _options: contextOptions,
      request: api,
    };
    const browser = { contexts: () => [context] };

    // Run the real context fixture, then the real page fixture nested inside
    // it, exactly as Playwright would.
    let result!: {
      navigations: string[];
      apiCalls: string[];
      browserAuthRequests: unknown[];
      context: typeof context;
      page: typeof page;
      gotoOnPrototype: typeof gotoOnPrototype;
      apiDuringRun: Record<string, unknown>;
      originalApi: Record<string, unknown>;
    };

    await fixtures.context(
      { browser },
      async (usedContext) => {
        const apiDuringRun = { ...(api as unknown as Record<string, unknown>) };
        await fixtures.page(
          { context: usedContext },
          async (usedPage) => {
            const target = usedPage as typeof page;
            await target.goto("/");
            await target.goto("/todos?done=1");
            await target.goto("https://example.com/elsewhere");
            await api.get("/api/health");
            await api.post("/api/auth/sign-in/email", {
              data: { email: "test@dyad.test", password: "secret" },
            });
            await api.fetch("https://example.com/api/health");
            result = {
              navigations,
              apiCalls: calls,
              browserAuthRequests,
              context,
              page: target,
              gotoOnPrototype,
              apiDuringRun,
              originalApi,
            };
          },
          PASSING_TEST_INFO,
        );
      },
      PASSING_TEST_INFO,
    );

    return result;
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

  it("resolves relative API request URLs and restores the methods after", async () => {
    const { apiCalls, apiDuringRun, originalApi, browserAuthRequests } =
      await runPageFixture({
        initialUrl: "http://localhost:32100/",
        contextOptions: {},
      });

    expect(apiCalls).toEqual([
      "get:http://localhost:32100/api/health",
      "post:http://localhost:32100/api/auth/sign-in/email",
      "fetch:https://example.com/api/health",
    ]);
    // Patched for the duration of the fixture...
    expect(apiDuringRun.get).not.toBe(originalApi.get);
    // ...and handed back as it was found, since the context outlives the run.
    for (const name of Object.keys(originalApi)) {
      expect(apiDuringRun[name]).toBeDefined();
    }
    expect(browserAuthRequests).toEqual([
      {
        signInUrl: "http://localhost:32100/api/auth/sign-in/email",
        data: { email: "test@dyad.test", password: "secret" },
      },
    ]);
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
    expect(tsconfig.compilerOptions.allowJs).toBe(true);
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

  it("falls back when a closer tsconfig shadows the preview mapping", () => {
    const appPath = makeApp();
    const nestedDir = path.join(appPath, "e2e-tests", "nested");
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      path.join(nestedDir, "auth.spec.ts"),
      'import { test } from "@playwright/test";\n',
    );
    fs.writeFileSync(
      path.join(nestedDir, "tsconfig.json"),
      '{ "compilerOptions": {} }',
    );

    const { warning } = ensurePreviewShim(appPath);

    expect(warning).toContain("e2e-tests/nested/tsconfig.json");
    expect(warning).toContain("separate browser");
  });

  it("allows a closer tsconfig that inherits the preview mapping", () => {
    const appPath = makeApp();
    const nestedDir = path.join(appPath, "e2e-tests", "nested");
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      path.join(nestedDir, "auth.spec.ts"),
      'import { test } from "@playwright/test";\n',
    );
    fs.writeFileSync(
      path.join(nestedDir, "tsconfig.json"),
      '{ "extends": "../tsconfig.json" }',
    );

    expect(ensurePreviewShim(appPath)).toEqual({});
  });

  it("refreshes a generated tsconfig whose snapshot has gone stale", () => {
    const appPath = makeApp();
    const rootTsconfig = path.join(appPath, "tsconfig.json");
    fs.writeFileSync(
      rootTsconfig,
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
      }),
    );
    ensurePreviewShim(appPath);

    // The app gains an alias after the preview run that wrote the snapshot.
    fs.writeFileSync(
      rootTsconfig,
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["./src/*"], "~test/*": ["./testing/*"] },
        },
      }),
    );

    refreshGeneratedE2eTsconfig(appPath);

    // Without this the new alias resolves everywhere except under e2e-tests/,
    // where a generated file nothing points at is quietly shadowing it.
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigAt(appPath), "utf8"));
    expect(tsconfig.compilerOptions.paths["~test/*"]).toEqual(["../testing/*"]);
    expect(tsconfig.compilerOptions.paths["@playwright/test"]).toEqual([
      "./fixtures/dyad/dyad-test.ts",
    ]);
  });

  it("never creates or rewrites a tsconfig it doesn't own", () => {
    const appPath = makeApp();

    // No preview run has happened, so there is nothing to keep in step and
    // writing one would change how the app's editor resolves imports.
    refreshGeneratedE2eTsconfig(appPath);
    expect(fs.existsSync(tsconfigAt(appPath))).toBe(false);

    fs.mkdirSync(path.dirname(tsconfigAt(appPath)), { recursive: true });
    const appOwned = JSON.stringify({ compilerOptions: { strict: true } });
    fs.writeFileSync(tsconfigAt(appPath), appOwned);

    refreshGeneratedE2eTsconfig(appPath);
    expect(fs.readFileSync(tsconfigAt(appPath), "utf8")).toBe(appOwned);
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
    expect(tsconfig.include).toEqual([
      "**/*.ts",
      "**/*.tsx",
      "**/*.js",
      "**/*.jsx",
    ]);
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
    // Tracing needs browser-global CDP access, which the restricted preview
    // broker does not expose. The shim attaches a screenshot directly instead.
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

  it("scopes an older Dyad-generated config's recorders away from preview runs", async () => {
    // `--trace=off` is passed on the CLI, but Playwright has no CLI equivalent
    // for `screenshot`. Left unmigrated, a failing test in an app bootstrapped
    // by an older Dyad still captures every page reachable over the borrowed
    // CDP connection — which includes Dyad's own product windows.
    const { appPath } = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: true,
    });
    const configPath = path.join(appPath, DYAD_CONFIG_FILENAME);
    fs.writeFileSync(
      configPath,
      'import { defineConfig } from "@playwright/test";\n' +
        "// Generated by Dyad.\n" +
        "export default defineConfig({\n" +
        '  testDir: "./e2e-tests",\n' +
        "  use: {\n" +
        `    baseURL: process.env.${TEST_BASE_URL_ENV} || "http://localhost:32100",\n` +
        '    channel: "chrome",\n' +
        '    screenshot: "only-on-failure",\n' +
        '    trace: "retain-on-failure",\n' +
        "  },\n" +
        "});\n",
    );

    await ensurePlaywrightBootstrap({ appPath });

    const updated = fs.readFileSync(configPath, "utf8");
    expect(updated).toContain(
      `screenshot: process.env.${PREVIEW_CDP_ENDPOINT_ENV}`,
    );
    expect(updated).toContain(`trace: process.env.${PREVIEW_CDP_ENDPOINT_ENV}`);
    // Still the ordinary behavior when no preview endpoint is set.
    expect(updated).toContain(': "only-on-failure"');
    expect(updated).toContain('"retain-on-failure"');
    // And the app's own channel choice survives the splice.
    expect(updated).toContain('channel: "chrome"');
  });

  it("leaves a hand-edited recorder setting alone", async () => {
    const { appPath } = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: true,
    });
    const configPath = path.join(appPath, DYAD_CONFIG_FILENAME);
    const handEdited =
      'import { defineConfig } from "@playwright/test";\n' +
      "// Generated by Dyad.\n" +
      "export default defineConfig({\n" +
      '  testDir: "./e2e-tests",\n' +
      "  use: {\n" +
      `    baseURL: process.env.${TEST_BASE_URL_ENV} || "http://localhost:32100",\n` +
      '    channel: "chrome",\n' +
      '    screenshot: "on",\n' +
      '    trace: "on",\n' +
      "  },\n" +
      "});\n";
    fs.writeFileSync(configPath, handEdited);

    await ensurePlaywrightBootstrap({ appPath });

    expect(fs.readFileSync(configPath, "utf8")).toContain('screenshot: "on"');
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

  it("skips the browser download when the preview shim is routed", async () => {
    const { appPath } = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: false,
    });
    fs.writeFileSync(
      path.join(appPath, DYAD_CONFIG_FILENAME),
      'export default { testDir: "./e2e-tests" };\n',
    );

    await expect(
      ensurePlaywrightBootstrap({ appPath, ensurePreviewShim: true }),
    ).resolves.toMatchObject({ installed: false, previewRouted: true });
    expect(h.spawnStreaming).not.toHaveBeenCalled();
  });

  it("still downloads a browser when preview routing falls back", async () => {
    const { appPath } = makeAppWithBrowserMarker({
      packageVersion: "1.2.3",
      executableExists: false,
    });
    fs.writeFileSync(
      path.join(appPath, DYAD_CONFIG_FILENAME),
      'export default { testDir: "./e2e-tests" };\n',
    );
    const e2eTsconfigPath = path.join(appPath, E2E_TSCONFIG_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(e2eTsconfigPath), { recursive: true });
    fs.writeFileSync(e2eTsconfigPath, '{ "compilerOptions": {} }');
    h.spawnStreaming.mockResolvedValue({ code: 0, aborted: false });

    await expect(
      ensurePlaywrightBootstrap({ appPath, ensurePreviewShim: true }),
    ).resolves.toMatchObject({ installed: true, previewRouted: false });
    expect(h.spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "npx",
        args: ["playwright", "install", "chromium"],
      }),
    );
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

describe("preview gitignore entries", () => {
  function makeApp(): string {
    const appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-pw-ignore-"));
    tempDirs.push(appPath);
    return appPath;
  }

  const gitignoreOf = (appPath: string) => {
    const file = path.join(appPath, ".gitignore");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  };

  it("ignores the tsconfig it generated itself", () => {
    const appPath = makeApp();

    ensurePreviewShim(appPath);

    expect(gitignoreOf(appPath)).toContain(`/${E2E_TSCONFIG_RELATIVE_PATH}`);
  });

  it("leaves an app-owned e2e tsconfig tracked", () => {
    // ensurePreviewShim explicitly supports an app owning this file — it
    // declines to overwrite it and warns instead. Gitignoring it anyway would
    // mean an untracked one is never committed, so a version restore or a
    // clone loses the config the app's own tests depend on.
    const appPath = makeApp();
    const tsconfigPath = path.join(appPath, E2E_TSCONFIG_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(tsconfigPath), { recursive: true });
    fs.writeFileSync(
      tsconfigPath,
      JSON.stringify({ compilerOptions: { strict: true } }),
    );

    ensurePreviewShim(appPath);

    expect(gitignoreOf(appPath)).not.toContain(
      `/${E2E_TSCONFIG_RELATIVE_PATH}`,
    );
    // The shim directory is Dyad's either way.
    expect(gitignoreOf(appPath)).toContain("/e2e-tests/fixtures/dyad/");
  });
});

describe("app-owned tsconfig routing", () => {
  function makeApp(): string {
    const appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-pw-extends-"));
    tempDirs.push(appPath);
    return appPath;
  }

  it("accepts a mapping the app inherits through extends", () => {
    // TypeScript resolves `paths` from the nearest config that declares them,
    // walking `extends`. Reading only this file's own `compilerOptions` would
    // call an app that keeps its Playwright mapping in a shared base config
    // unrouted — turning preview runs off for it, and making the legacy shim
    // look safe to delete out from under a mapping that still points at it.
    const appPath = makeApp();
    const e2eDir = path.join(appPath, "e2e-tests");
    fs.mkdirSync(e2eDir, { recursive: true });
    fs.writeFileSync(
      path.join(e2eDir, "tsconfig.base.json"),
      JSON.stringify({
        compilerOptions: {
          paths: { "@playwright/test": ["./fixtures/dyad/dyad-test.ts"] },
        },
      }),
    );
    fs.writeFileSync(
      path.join(appPath, E2E_TSCONFIG_RELATIVE_PATH),
      JSON.stringify({ extends: "./tsconfig.base.json" }),
    );

    expect(ensurePreviewShim(appPath)).toEqual({});
  });

  it("still warns when neither the file nor its base maps the specifier", () => {
    const appPath = makeApp();
    const e2eDir = path.join(appPath, "e2e-tests");
    fs.mkdirSync(e2eDir, { recursive: true });
    fs.writeFileSync(
      path.join(e2eDir, "tsconfig.base.json"),
      JSON.stringify({ compilerOptions: { strict: true } }),
    );
    fs.writeFileSync(
      path.join(appPath, E2E_TSCONFIG_RELATIVE_PATH),
      JSON.stringify({ extends: "./tsconfig.base.json" }),
    );

    expect(ensurePreviewShim(appPath).warning).toContain("separate browser");
  });
});

describe("configSetsTimeout", () => {
  function makeAppWithConfig(source: string): string {
    const appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-pw-timeout-"));
    tempDirs.push(appPath);
    fs.writeFileSync(path.join(appPath, DYAD_CONFIG_FILENAME), source);
    return appPath;
  }

  it("sees a plain timeout key", () => {
    expect(configSetsTimeout(makeAppWithConfig("{ timeout: 60000 }"))).toBe(
      true,
    );
  });

  it("sees a quoted timeout key", () => {
    expect(configSetsTimeout(makeAppWithConfig('{ "timeout": 60000 }'))).toBe(
      true,
    );
  });

  it("ignores a timeout mentioned only in a line comment", () => {
    // Reading prose as a setting drops the `--timeout` raise that keeps a
    // slow-motion run from failing at Playwright's 30s default — so a spec
    // that is green at full speed fails purely from the toggle.
    expect(
      configSetsTimeout(
        makeAppWithConfig("// set timeout: here if you need one\nexport {};"),
      ),
    ).toBe(false);
  });

  it("ignores a timeout mentioned only in a block comment", () => {
    expect(
      configSetsTimeout(
        makeAppWithConfig("/*\n * timeout: defaults to 30s\n */\nexport {};"),
      ),
    ).toBe(false);
  });

  it("does not mistake a URL's // for the start of a comment", () => {
    expect(
      configSetsTimeout(
        makeAppWithConfig(
          '{ baseURL: "http://localhost:32100", timeout: 60000 }',
        ),
      ),
    ).toBe(true);
  });

  it("reports no timeout for the generated template", () => {
    expect(
      configSetsTimeout(makeAppWithConfig(buildPlaywrightConfig(null))),
    ).toBe(false);
  });
});
