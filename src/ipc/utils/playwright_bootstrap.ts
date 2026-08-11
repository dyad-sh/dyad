import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import log from "electron-log/main";
import { spawnStreaming } from "./spawn_streaming";
import {
  PNPM_INSTALL_POLICY_ARGS,
  getPackageManagerCommandEnv,
} from "./socket_firewall";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  clearNodeModuleCache,
  getNodeModuleEntryPath,
  resolveNodeModulePackageJsonPathSync,
} from "../../../shared/node_module_resolution";
import { E2E_TEST_DIR } from "../types/tests";

const logger = log.scope("playwright_bootstrap");

/**
 * The command + args that add `@playwright/test` as a dev dependency using the
 * app's OWN package manager, detected from its lockfile. Matching the app's
 * package manager avoids dirtying a pnpm/yarn project with npm artifacts (a
 * stray `package-lock.json` and a divergent dependency tree vs. the dev server).
 * Defaults to npm when no lockfile is recognized.
 */
function playwrightInstallCommand(appPath: string): {
  command: string;
  args: string[];
} {
  const has = (file: string) => fs.existsSync(path.join(appPath, file));
  if (has("pnpm-lock.yaml")) {
    return {
      command: "pnpm",
      args: [
        ...PNPM_INSTALL_POLICY_ARGS,
        "add",
        // Dyad can generate a pnpm-workspace.yaml (for install policy), which
        // makes pnpm treat the app as a workspace root and refuse a plain
        // `pnpm add` without this opt-in. Matches the add-dependency path.
        "--ignore-workspace-root-check",
        "--save-dev",
        "@playwright/test",
      ],
    };
  }
  if (has("yarn.lock")) {
    return { command: "yarn", args: ["add", "--dev", "@playwright/test"] };
  }
  // npm (package-lock.json) or unknown — mirror the app runtime's npm install.
  return {
    command: "npm",
    args: [
      "install",
      "--save-dev",
      "@playwright/test",
      // Match the app runtime's npm install (app_runtime_service): tolerate the
      // peer-dependency conflicts common in generated apps instead of failing
      // or prompting on ERESOLVE.
      "--legacy-peer-deps",
      // Skip the audit/funding passes and the progress spinner: pure noise
      // here, and the audit step adds a slow extra network round-trip.
      "--no-audit",
      "--no-fund",
      "--progress=false",
    ],
  };
}

/** Environment variable the generated config reads for baseURL. */
export const TEST_BASE_URL_ENV = "DYAD_TEST_BASE_URL";

/**
 * Environment variable carrying the slow-motion delay, in milliseconds between
 * actions. Read by the generated config (browser runs) and the fixture shim
 * (preview runs); unset means full speed, so a run that doesn't opt in is
 * unaffected. Playwright has no CLI flag for `slowMo`, hence the env var.
 */
export const TEST_SLOW_MO_ENV = "DYAD_TEST_SLOW_MO";

/**
 * How long Playwright pauses between actions when slow motion is on. Slow
 * enough to follow each click by eye, short enough that a normal spec doesn't
 * turn into a multi-minute run.
 */
export const SLOW_MO_DELAY_MS = 500;

/**
 * Per-test timeout for a slow-motion run, replacing Playwright's 30s default.
 * The inserted delays are wall-clock time inside the test, so at
 * `SLOW_MO_DELAY_MS` a spec only needs ~60 actions to blow the default budget —
 * a green spec would start failing purely from the toggle. Passed as
 * `--timeout` on slow-motion runs only, so ordinary runs keep the default.
 */
export const SLOW_MO_TEST_TIMEOUT_MS = 120_000;

/**
 * The generated config's slow-motion lines. Shared by the template and the
 * migration below so a migrated config comes out byte-identical to a freshly
 * written one.
 */
const SLOW_MO_CONFIG_LINES = `    // Slow motion: Dyad sets ${TEST_SLOW_MO_ENV} (milliseconds between
    // actions) while the Tests panel's slow-motion toggle is on, so a run is
    // easy to follow. Unset means full speed.
    launchOptions: { slowMo: Number(process.env.${TEST_SLOW_MO_ENV}) || 0 },`;

/**
 * Dyad's own Playwright config. Deliberately NOT `playwright.config.ts`: that
 * name is the user's (some apps ship a legitimate Playwright setup of their
 * own), and Playwright auto-resolves it. Ours sits beside it under a distinct
 * name and is selected explicitly with `--config` on every run, so Dyad never
 * has to rename, back up, or overwrite a config it doesn't own.
 */
export const DYAD_CONFIG_FILENAME = "playwright-dyad.config.ts";

// Every config filename Playwright auto-resolves — an app with any of these
// owns its own config, so its bare `playwright test` script is not ours.
const PLAYWRIGHT_CONFIG_FILENAMES = [
  "playwright.config.ts",
  "playwright.config.js",
  "playwright.config.mjs",
  "playwright.config.cjs",
  "playwright.config.mts",
  "playwright.config.cts",
];

const GITIGNORE_ENTRIES = [
  "/test-results/",
  "/playwright-report/",
  "/playwright/.cache/",
  ".last-run.json",
];

/** Where the JSON reporter writes results, relative to the app root. */
export const TEST_RESULTS_JSON = "test-results/results.json";

/**
 * Sentinel comment in the generated config. Lets us recognize a config we
 * created (and may safely regenerate) vs. one the user hand-wrote.
 */
const DYAD_CONFIG_SENTINEL = "Generated by Dyad";

/**
 * Environment variable carrying Dyad's CDP endpoint. Only set for preview
 * runs; the generated fixture shim stays inert without it, so every other run
 * launches its own browser exactly as before.
 */
export const PREVIEW_CDP_ENDPOINT_ENV = "DYAD_PREVIEW_CDP_ENDPOINT";

/**
 * Directory holding the fixture shim and nothing else. It gets its own tsconfig
 * (see below), which must not cover any file the user writes — hence a folder
 * of its own rather than sitting directly in `fixtures/`, where the model is
 * told to put the app's real fixtures.
 */
const PREVIEW_SHIM_DIR = `${E2E_TEST_DIR}/fixtures/dyad`;

/**
 * Fixture shim that reroutes the default `page` onto the page already loaded in
 * Dyad's preview panel. Specs reach it through the tsconfig path mapping below
 * rather than by importing it, so existing specs need no edits.
 */
export const PREVIEW_SHIM_RELATIVE_PATH = `${PREVIEW_SHIM_DIR}/dyad-test.ts`;

/**
 * Where the shim lived before it moved into its own directory. Apps bootstrapped
 * by an older Dyad still have this file; it is dead once the mapping below
 * points at the new location, so we clean it up.
 */
const LEGACY_PREVIEW_SHIM_RELATIVE_PATH = `${E2E_TEST_DIR}/fixtures/dyad-test.ts`;

/**
 * Turns the path mapping back off for the shim itself. Playwright resolves
 * `paths` from the CLOSEST tsconfig above a file and does not merge in parents,
 * so this one shadows the mapping below and lets the shim import the real
 * `@playwright/test` instead of resolving to itself.
 */
export const SHIM_TSCONFIG_RELATIVE_PATH = `${PREVIEW_SHIM_DIR}/tsconfig.json`;

/** Maps `@playwright/test` to the shim for specs in the test directory. */
export const E2E_TSCONFIG_RELATIVE_PATH = `${E2E_TEST_DIR}/tsconfig.json`;

/** The shim's location, relative to `E2E_TSCONFIG_RELATIVE_PATH`. */
const SHIM_PATH_FROM_E2E_TSCONFIG = `./${PREVIEW_SHIM_RELATIVE_PATH.slice(
  `${E2E_TEST_DIR}/`.length,
)}`;

/** A browser channel that drives a system-installed browser, or bundled. */
export type BrowserChannel = "chrome" | "msedge";

/**
 * Builds the `playwright-dyad.config.ts` source. When `channel` is set, the
 * config drives the user's already-installed Chrome/Edge (no bundled-Chromium
 * download); when null, it uses Playwright's downloaded Chromium.
 */
export function buildPlaywrightConfig(channel: BrowserChannel | null): string {
  const channelLine = channel ? `\n    channel: "${channel}",` : "";
  const browserNote = channel
    ? `// Uses your installed ${channel === "chrome" ? "Google Chrome" : "Microsoft Edge"} (no extra browser download).`
    : `// Uses Playwright's bundled Chromium (downloaded on first run).`;
  return `import { defineConfig } from "@playwright/test";

// ${DYAD_CONFIG_SENTINEL}. The dev server is started separately by Dyad's
// preview, so we point baseURL at the already-running proxy URL (passed via
// env) rather than using Playwright's \`webServer\` (which would double-start
// the app).
// ${browserNote}
export default defineConfig({
  testDir: "./${E2E_TEST_DIR}",
  // Run serially against the single dev server.
  workers: 1,
  fullyParallel: false,
  reporter: [["json", { outputFile: "${TEST_RESULTS_JSON}" }]],
  use: {
    baseURL: process.env.${TEST_BASE_URL_ENV} || "http://localhost:32100",
${SLOW_MO_CONFIG_LINES}${channelLine}
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
`;
}

/**
 * Builds the fixture shim source.
 *
 * Specs import `@playwright/test`; the generated tsconfig maps that specifier
 * here, so unmodified specs pick this up. The shim imports `@playwright/test`
 * too — the sibling tsconfig turns the mapping off for this directory, so the
 * specifier reaches the real package instead of pointing back at this file.
 *
 * It deliberately does NOT go through the `playwright` package (which
 * `@playwright/test` re-exports): that package is a transitive dependency, so
 * pnpm and Yarn keep it out of the app's top-level `node_modules` and the
 * import fails to resolve.
 *
 * Without the endpoint env var it re-exports Playwright's own `test` verbatim,
 * so normal runs are unaffected.
 */
export function buildPreviewShimSource(): string {
  return `// ${DYAD_CONFIG_SENTINEL}. Do not edit — Dyad regenerates this file.
//
// Lets "Run in preview" drive the page already open in Dyad's preview panel
// instead of launching a separate browser. Inert unless Dyad sets
// ${PREVIEW_CDP_ENDPOINT_ENV}, so ordinary test runs behave exactly as before.
import * as pw from "@playwright/test";

export * from "@playwright/test";

const endpoint = process.env.${PREVIEW_CDP_ENDPOINT_ENV};
// No browser is launched here, so the config's \`launchOptions.slowMo\` never
// applies — the connection carries it instead.
const slowMo = Number(process.env.${TEST_SLOW_MO_ENV}) || 0;

function requireBaseUrl(): string {
  const baseUrl = process.env.${TEST_BASE_URL_ENV};
  if (!baseUrl) {
    throw new Error("Dyad preview: ${TEST_BASE_URL_ENV} is not set.");
  }
  return baseUrl;
}

export const test = !endpoint
  ? pw.test
  : pw.test.extend({
      browser: [
        async ({}, use) => {
          const browser = await pw.chromium.connectOverCDP(endpoint, { slowMo });
          try {
            await use(browser);
          } finally {
            // Disconnects this client; it never closes Dyad itself.
            await browser.close();
          }
        },
        { scope: "worker" },
      ],
      context: async ({ browser }, use) => {
        const context = browser.contexts()[0];
        if (!context) {
          throw new Error("Dyad preview: no browser context available over CDP.");
        }
        // Playwright applies the config's \`baseURL\` when IT creates a context.
        // Dyad's preview created this one, so the option is missing and every
        // relative URL would have nothing to resolve against. Everything that
        // reads it on the client — expect(page).toHaveURL("/x"),
        // page.waitForURL, route globs, context.request — is fixed by filling
        // it in. (page.goto resolves elsewhere; see below.) Best-effort: it's
        // internal, so a rename should cost the extras, not the run.
        const contextInternals = context as unknown as {
          _options?: { baseURL?: string };
        };
        if (contextInternals._options) {
          contextInternals._options.baseURL = requireBaseUrl();
        }
        // Pre-existing context: hand it over without closing it afterwards.
        await use(context);
      },
      page: async ({ context }, use) => {
        const baseUrl = requireBaseUrl();
        const origin = new URL(baseUrl).origin;
        const page = context.pages().find((candidate) => {
          try {
            return new URL(candidate.url()).origin === origin;
          } catch {
            return false;
          }
        });
        if (!page) {
          throw new Error(
            \`Dyad preview: no page serving \${origin} — is the preview panel showing this app?\`,
          );
        }
        // page.goto resolves relative URLs in Playwright's server half, from
        // the options the context was CREATED with — out of reach of the
        // assignment above, so "/" would reach Chromium verbatim and fail as an
        // invalid URL. Resolve it here instead. Absolute URLs pass through
        // untouched, and the original is restored so the page we hand back to
        // the user is the one we borrowed.
        const originalGoto = page.goto;
        page.goto = (url, options) =>
          originalGoto.call(page, new URL(url, baseUrl).href, options);
        try {
          // Pre-existing page: leave it open for the next test and the user.
          await use(page);
        } finally {
          page.goto = originalGoto;
        }
      },
    });

export const expect = pw.expect;
`;
}

export function buildE2eTsconfigSource(): string {
  return `${JSON.stringify(
    {
      _comment: `${DYAD_CONFIG_SENTINEL}. Routes @playwright/test through Dyad's fixture shim so tests can run inside the preview panel. Delete this file to opt out.`,
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@playwright/test": [SHIM_PATH_FROM_E2E_TSCONFIG],
        },
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * Config for the shim's own directory. Playwright picks the closest tsconfig
 * above a file and ignores parents entirely, so an empty `paths` here is what
 * stops the mapping above from swallowing the shim's own import of the real
 * `@playwright/test`. No `baseUrl`: setting one makes Playwright add a
 * catch-all `*` -> `*` mapping, which is exactly what we're avoiding.
 */
export function buildShimTsconfigSource(): string {
  return `${JSON.stringify(
    {
      _comment: `${DYAD_CONFIG_SENTINEL}. Turns off the @playwright/test path mapping from ../../tsconfig.json so the shim beside this file can import the real package. Do not add sources to this directory.`,
      compilerOptions: {
        paths: {},
      },
    },
    null,
    2,
  )}\n`;
}

function readFileOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Writes the preview fixture shim and the tsconfig that routes specs through
 * it. Idempotent, and never clobbers a tsconfig the app owns.
 *
 * Returns a warning when the app has its own `e2e-tests/tsconfig.json`: the run
 * still produces valid results, it just launches a normal browser instead of
 * using the preview.
 */
export function ensurePreviewShim(appPath: string): { warning?: string } {
  const shimPath = path.join(appPath, PREVIEW_SHIM_RELATIVE_PATH);
  const existingShim = readFileOrNull(shimPath);
  if (existingShim === null || existingShim.includes(DYAD_CONFIG_SENTINEL)) {
    fs.mkdirSync(path.dirname(shimPath), { recursive: true });
    fs.writeFileSync(shimPath, buildPreviewShimSource());
  }

  // Written even when the shim itself is hand-edited: without it the mapping
  // below points the shim's own import back at the shim.
  const shimTsconfigPath = path.join(appPath, SHIM_TSCONFIG_RELATIVE_PATH);
  const existingShimTsconfig = readFileOrNull(shimTsconfigPath);
  if (
    existingShimTsconfig === null ||
    existingShimTsconfig.includes(DYAD_CONFIG_SENTINEL)
  ) {
    fs.mkdirSync(path.dirname(shimTsconfigPath), { recursive: true });
    fs.writeFileSync(shimTsconfigPath, buildShimTsconfigSource());
  }

  // Drop the shim an older Dyad left one directory up, but only if it's still
  // ours — nothing points at it anymore, and leaving it there invites edits to
  // a file that no longer runs.
  const legacyShimPath = path.join(appPath, LEGACY_PREVIEW_SHIM_RELATIVE_PATH);
  if (readFileOrNull(legacyShimPath)?.includes(DYAD_CONFIG_SENTINEL)) {
    fs.rmSync(legacyShimPath, { force: true });
  }

  const tsconfigPath = path.join(appPath, E2E_TSCONFIG_RELATIVE_PATH);
  const existingTsconfig = readFileOrNull(tsconfigPath);
  if (
    existingTsconfig === null ||
    existingTsconfig.includes(DYAD_CONFIG_SENTINEL)
  ) {
    fs.writeFileSync(tsconfigPath, buildE2eTsconfigSource());
    return {};
  }

  if (existingTsconfig.includes("dyad-test")) {
    // The app kept its own tsconfig but still routes to the shim.
    return {};
  }

  return {
    warning: `Your app has its own ${E2E_TSCONFIG_RELATIVE_PATH}, so Dyad can't route tests through the preview. The run will use a separate browser instead. Add a "@playwright/test" path mapping to "./fixtures/dyad-test.ts" to enable preview runs.\n`,
  };
}

/**
 * Detects a system-installed Chrome or Edge so Playwright can drive it via
 * `channel` instead of downloading its own ~100MB Chromium. Prefers Chrome.
 * Returns null when neither is found (caller falls back to bundled Chromium).
 */
export function detectSystemBrowserChannel(): BrowserChannel | null {
  const platform = process.platform;
  const exists = (p: string) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  };

  if (platform === "darwin") {
    if (
      exists("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ) {
      return "chrome";
    }
    if (
      exists("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")
    ) {
      return "msedge";
    }
    return null;
  }

  if (platform === "win32") {
    const programFiles = process.env["PROGRAMFILES"] || "C:\\Program Files";
    const programFilesX86 =
      process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env["LOCALAPPDATA"] || "";
    const chromeCandidates = [
      path.join(programFiles, "Google/Chrome/Application/chrome.exe"),
      path.join(programFilesX86, "Google/Chrome/Application/chrome.exe"),
      localAppData
        ? path.join(localAppData, "Google/Chrome/Application/chrome.exe")
        : "",
    ].filter(Boolean);
    if (chromeCandidates.some(exists)) return "chrome";
    const edgeCandidates = [
      path.join(programFilesX86, "Microsoft/Edge/Application/msedge.exe"),
      path.join(programFiles, "Microsoft/Edge/Application/msedge.exe"),
    ];
    if (edgeCandidates.some(exists)) return "msedge";
    return null;
  }

  // Linux. Only real Google Chrome counts — `channel: "chrome"` won't drive a
  // distro `chromium` package, so we leave that to the bundled fallback.
  const chromeCandidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/opt/google/chrome/chrome",
  ];
  if (chromeCandidates.some(exists)) return "chrome";
  if (exists("/usr/bin/microsoft-edge")) return "msedge";
  return null;
}

export function isPlaywrightInstalled(appPath: string): boolean {
  return fs.existsSync(
    path.join(appPath, "node_modules", "@playwright", "test", "package.json"),
  );
}

/**
 * Marker written after a successful `playwright install chromium`. Lives inside
 * node_modules so it's gitignored and disappears if node_modules is wiped
 * (which would also drop the package, forcing a clean reinstall). The browser
 * binary itself lives in a global cache, so we can't detect it from the app
 * dir — the marker is how we avoid re-running the (idempotent but slow) install
 * on every run.
 */
const BROWSER_MARKER = path.join(
  "node_modules",
  ".dyad-playwright-chromium-installed",
);

function playwrightPackageVersion(appPath: string): string | null {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(
        path.join(
          appPath,
          "node_modules",
          "@playwright",
          "test",
          "package.json",
        ),
        "utf8",
      ),
    ) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : null;
  } catch {
    return null;
  }
}

function chromiumExecutablePath(appPath: string): string | null {
  try {
    const requireFromApp = createRequire(path.join(appPath, "package.json"));
    const packageJsonPath = resolveNodeModulePackageJsonPathSync(appPath, [
      "playwright",
    ]);
    const realPackageRootPath = fs.realpathSync(path.dirname(packageJsonPath));
    const entryPath = fs.realpathSync(
      getNodeModuleEntryPath(packageJsonPath, "index.js"),
    );
    clearNodeModuleCache(realPackageRootPath, requireFromApp.cache);
    const playwright = requireFromApp(entryPath) as {
      chromium?: { executablePath?: () => string };
    };
    const executablePath = playwright.chromium?.executablePath?.();
    return typeof executablePath === "string" ? executablePath : null;
  } catch (error) {
    logger.warn(`Failed to resolve Playwright Chromium executable: ${error}`);
    return null;
  }
}

export function isPlaywrightBrowserInstalled(appPath: string): boolean {
  const markerPath = path.join(appPath, BROWSER_MARKER);
  if (!fs.existsSync(markerPath)) {
    return false;
  }

  const currentVersion = playwrightPackageVersion(appPath);
  if (!currentVersion) {
    return false;
  }

  let marker: { playwrightVersion?: unknown; executablePath?: unknown };
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as {
      playwrightVersion?: unknown;
      executablePath?: unknown;
    };
  } catch {
    return false;
  }

  if (marker.playwrightVersion !== currentVersion) {
    return false;
  }

  const executablePath =
    typeof marker.executablePath === "string"
      ? marker.executablePath
      : chromiumExecutablePath(appPath);
  return !!executablePath && fs.existsSync(executablePath);
}

function markBrowserInstalled(appPath: string): void {
  try {
    const marker = {
      playwrightVersion: playwrightPackageVersion(appPath),
      executablePath: chromiumExecutablePath(appPath),
    };
    fs.writeFileSync(
      path.join(appPath, BROWSER_MARKER),
      `${JSON.stringify(marker, null, 2)}\n`,
    );
  } catch (err) {
    logger.warn(`Failed to write browser marker: ${err}`);
  }
}

/** Absolute path of Dyad's own config. The user's config is never touched. */
function dyadConfigPath(appPath: string): string {
  return path.join(appPath, DYAD_CONFIG_FILENAME);
}

function hasDyadPlaywrightConfig(appPath: string): boolean {
  return fs.existsSync(dyadConfigPath(appPath));
}

/** Read Dyad's config source, or null if we haven't written one yet. */
function readDyadConfigText(appPath: string): string | null {
  const file = dyadConfigPath(appPath);
  if (!fs.existsSync(file)) return null;
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** True when Dyad's config drives a system browser via `channel`. */
function configUsesChannel(appPath: string): boolean {
  const text = readDyadConfigText(appPath);
  return (
    text != null &&
    /(?:^|[,{ \t\r\n])(?:channel|["']channel["'])\s*:/.test(text)
  );
}

/** True when Dyad's config is still pure template output (safe to rewrite). */
function isDyadGeneratedConfig(appPath: string): boolean {
  const text = readDyadConfigText(appPath);
  return text != null && text.includes(DYAD_CONFIG_SENTINEL);
}

function writePlaywrightConfig(
  appPath: string,
  channel: BrowserChannel | null,
): void {
  fs.writeFileSync(dyadConfigPath(appPath), buildPlaywrightConfig(channel));
  logger.info(
    `Wrote ${DYAD_CONFIG_FILENAME} (${channel ? `channel: ${channel}` : "bundled chromium"})`,
  );
}

/**
 * Rewrite a Dyad-generated config that still points `testDir` at the legacy
 * `./tests` directory so it targets the current `./${E2E_TEST_DIR}`. Only touches
 * configs carrying the sentinel (so a hand-written user config is never
 * modified) and changes exactly that one line to preserve any `channel:` the
 * config already has. A no-op when the config is already current — including
 * when the fresh-write/channel-upgrade paths just emitted the latest template.
 */
function migrateConfigTestDir(appPath: string): void {
  if (!isDyadGeneratedConfig(appPath)) return;
  const text = readDyadConfigText(appPath);
  const legacy = 'testDir: "./tests"';
  const current = `testDir: "./${E2E_TEST_DIR}"`;
  if (text && text.includes(legacy)) {
    fs.writeFileSync(dyadConfigPath(appPath), text.replace(legacy, current));
    logger.info(
      `Migrated ${DYAD_CONFIG_FILENAME} testDir to ./${E2E_TEST_DIR}`,
    );
  }
}

/**
 * Add the slow-motion `launchOptions` to a Dyad-generated config written before
 * the Tests panel had that toggle — without it the toggle would silently do
 * nothing for apps bootstrapped by an older Dyad. Splices in just those lines
 * (rather than rewriting the file) so a `channel:` the config already selected
 * survives. Only touches configs carrying the sentinel, and only while the
 * generated `baseURL` line is still intact — a config edited past that point is
 * the user's to change.
 */
function migrateConfigSlowMo(appPath: string): void {
  if (!isDyadGeneratedConfig(appPath)) return;
  const text = readDyadConfigText(appPath);
  if (!text || text.includes(TEST_SLOW_MO_ENV)) return;
  const baseUrlLine = `    baseURL: process.env.${TEST_BASE_URL_ENV} || "http://localhost:32100",`;
  if (!text.includes(baseUrlLine)) return;
  fs.writeFileSync(
    dyadConfigPath(appPath),
    text.replace(baseUrlLine, `${baseUrlLine}\n${SLOW_MO_CONFIG_LINES}`),
  );
  logger.info(`Added slow-motion support to ${DYAD_CONFIG_FILENAME}`);
}

function appendGitignoreEntries(appPath: string): void {
  const gitignorePath = path.join(appPath, ".gitignore");
  let existing = "";
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, "utf8");
  }
  const existingLines = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_ENTRIES.filter((e) => !existingLines.has(e));
  if (missing.length === 0) return;

  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  const block = `${prefix}\n# Playwright test artifacts\n${missing.join("\n")}\n`;
  fs.appendFileSync(gitignorePath, block);
  logger.info(`Appended ${missing.length} gitignore entries`);
}

function ensureTestScript(appPath: string): void {
  const packageJsonPath = path.join(appPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    pkg.scripts = pkg.scripts || {};
    if (!pkg.scripts.test) {
      // Point at Dyad's config explicitly — Playwright only auto-resolves
      // `playwright.config.ts`, which is the app's own file, not ours.
      pkg.scripts.test = `playwright test --config ${DYAD_CONFIG_FILENAME}`;
      fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
      logger.info("Added test script to package.json");
    } else if (
      pkg.scripts.test === "playwright test" &&
      !PLAYWRIGHT_CONFIG_FILENAMES.some((name) =>
        fs.existsSync(path.join(appPath, name)),
      )
    ) {
      // Migrate the old Dyad-generated bare script, but only when the app has
      // no Playwright config of its own. A bare `playwright test` alongside a
      // user-authored playwright.config.ts is the user's script targeting the
      // user's config — repointing it at ours would bypass their projects and
      // global setup, and break `npm test` outside Dyad. With no config of
      // their own, the bare script can only be Dyad's older template output.
      // (Scripts with flags, env vars, or extra commands are never touched.)
      pkg.scripts.test = `playwright test --config ${DYAD_CONFIG_FILENAME}`;
      fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
      logger.info("Updated Dyad test script to use explicit config");
    }
  } catch (err) {
    logger.warn(`Failed to update package.json test script: ${err}`);
  }
}

/**
 * Ensures Playwright is installed and the app is configured to run tests.
 * Streams install output through `onOutput`. Cancellable via `signal`.
 *
 * Throws a DyadError (kind External) on install failure — typically offline,
 * since the Chromium download needs the network. Callers should classify this
 * as an infra/inconclusive failure (amber).
 *
 * Returns whether a fresh install was performed (first-run setup).
 */
export async function ensurePlaywrightBootstrap({
  appPath,
  signal,
  onOutput,
  ensurePreviewShim: writePreviewShim,
}: {
  appPath: string;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  /**
   * Generate the preview fixture shim + tsconfig mapping. Only set for preview
   * runs, so apps that never use the experiment don't get a tsconfig that
   * changes how their editor resolves `@playwright/test`.
   */
  ensurePreviewShim?: boolean;
}): Promise<{ installed: boolean }> {
  // Yarn Plug'n'Play has no node_modules, so the installed-check below and the
  // `npx playwright` runner can't work with it: every run would reinstall and
  // then fail to resolve the runner. Dead-end with an actionable message
  // instead. (Yarn classic and `nodeLinker: node-modules` apps are unaffected.)
  if (
    fs.existsSync(path.join(appPath, ".pnp.cjs")) ||
    fs.existsSync(path.join(appPath, ".pnp.js"))
  ) {
    throw new DyadError(
      "This app uses Yarn Plug'n'Play, which isn't supported for tests yet. Set `nodeLinker: node-modules` in .yarnrc.yml, reinstall dependencies, and try again.",
      DyadErrorKind.Precondition,
    );
  }

  const packageInstalled = isPlaywrightInstalled(appPath);

  if (!packageInstalled) {
    onOutput?.("Installing @playwright/test...\n");
    const { command, args } = playwrightInstallCommand(appPath);
    const installDep = await spawnStreaming({
      command,
      args,
      cwd: appPath,
      signal,
      onOutput,
      // Disable Corepack's project spec so a stale `packageManager` pin can't
      // fail the install before @playwright/test lands, mirroring the other
      // Dyad-managed package-manager paths (executeAddDependency, runtime).
      env: getPackageManagerCommandEnv(),
      // Don't let a stuck registry/network hang the whole test flow forever.
      timeoutMs: 5 * 60 * 1000,
    });
    if (installDep.aborted) {
      throw new DyadError("Test setup cancelled.", DyadErrorKind.Precondition);
    }
    if (installDep.code !== 0) {
      throw new DyadError(
        "Couldn't install @playwright/test. Check your connection and try again.",
        DyadErrorKind.External,
      );
    }
  }

  // Decide how tests get a browser: prefer the user's system Chrome/Edge (no
  // download) and fall back to Playwright's bundled Chromium.
  // Dyad's config lives under its own name and every run selects it with
  // `--config`, so whatever the app's own playwright.config.ts says (or whether
  // it exists at all) is irrelevant here — we only ever manage our own file.
  const detectedChannel = detectSystemBrowserChannel();
  let usesChannel: boolean;
  if (!hasDyadPlaywrightConfig(appPath)) {
    usesChannel = detectedChannel !== null;
    writePlaywrightConfig(appPath, usesChannel ? detectedChannel : null);
  } else {
    usesChannel = configUsesChannel(appPath);
    // Upgrade a bundled config to the system browser when one is now available,
    // so existing apps stop needing the big download. Skipped once the sentinel
    // is gone: the user has made the file their own.
    if (!usesChannel && detectedChannel && isDyadGeneratedConfig(appPath)) {
      writePlaywrightConfig(appPath, detectedChannel);
      usesChannel = true;
      onOutput?.(
        `Using your installed ${detectedChannel === "chrome" ? "Chrome" : "Edge"} — no browser download needed.\n`,
      );
    }
  }

  // Bring an older Dyad config's testDir up to date (./tests -> ./e2e-tests) so
  // existing apps' runs target the new directory after the convention switch,
  // and teach it the slow-motion option added later. Both are no-ops once the
  // config is current, including right after the writes above.
  migrateConfigTestDir(appPath);
  migrateConfigSlowMo(appPath);

  // The bundled Chromium binary is downloaded separately from the npm package,
  // so we track it apart (a present package does NOT mean the browser is
  // there). Only needed when we're NOT driving a system browser.
  let downloadedBrowser = false;
  if (!usesChannel && !isPlaywrightBrowserInstalled(appPath)) {
    onOutput?.("\nDownloading the Chromium test browser...\n");
    const installBrowser = await spawnStreaming({
      command: "npx",
      args: ["playwright", "install", "chromium"],
      cwd: appPath,
      signal,
      onOutput,
      // Same Corepack guard as the package install above.
      env: getPackageManagerCommandEnv(),
      // The Chromium download is large; give it a generous ceiling but never
      // let it hang indefinitely on a stalled connection.
      timeoutMs: 10 * 60 * 1000,
    });
    if (installBrowser.aborted) {
      throw new DyadError("Test setup cancelled.", DyadErrorKind.Precondition);
    }
    if (installBrowser.code !== 0) {
      throw new DyadError(
        "Couldn't download the test browser. Check your connection and try again.",
        DyadErrorKind.External,
      );
    }
    markBrowserInstalled(appPath);
    downloadedBrowser = true;
  }

  // Idempotent app configuration — cheap, runs every time.
  appendGitignoreEntries(appPath);
  ensureTestScript(appPath);

  if (writePreviewShim) {
    try {
      const { warning } = ensurePreviewShim(appPath);
      if (warning) {
        onOutput?.(warning);
      }
    } catch (err) {
      // Losing the preview routing is not worth failing an otherwise fine run.
      logger.warn(`Failed to write the preview test shim: ${err}`);
      onOutput?.(
        "Couldn't set up the preview test shim; running in a separate browser instead.\n",
      );
    }
  }

  return { installed: !packageInstalled || downloadedBrowser };
}
