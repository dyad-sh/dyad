import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import log from "electron-log/main";
import { globSync } from "glob";
import { spawnStreaming } from "./spawn_streaming";
import { findPackageManagerRoot } from "@/ipc/services/isolated_package_install";
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
import { E2E_TEST_DIR, TEST_SPEC_GLOB } from "../types/tests";

const logger = log.scope("playwright_bootstrap");

/**
 * The Git top level containing `appPath`, or `appPath` when there is none.
 *
 * The boundary for the workspace-root walk below, and the same one
 * `createGitOverlayWorkspace` derives from `git rev-parse --show-toplevel` —
 * read from the filesystem here so bootstrap does not need a subprocess.
 */
function findRepoRoot(appPath: string): string {
  let candidate = appPath;
  for (;;) {
    if (fs.existsSync(path.join(candidate, ".git"))) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) return appPath;
    candidate = parent;
  }
}

/**
 * The command + args that add `@playwright/test` as a dev dependency using the
 * package manager that ACTUALLY installs this app.
 *
 * Resolved through the workspace root, not from the app directory alone. A
 * pnpm workspace member has no lockfile of its own — the only `pnpm-lock.yaml`
 * is at the root — so inspecting the app directory would fall through to npm,
 * write a nested `package-lock.json` and a member `node_modules`, and leave the
 * ROOT lockfile without the new dependency. The sandbox then resolves the same
 * ancestor root, runs `pnpm install --frozen-lockfile`, and fails outright
 * because the lockfile needs an update — so the app's very first sandboxed run
 * would break deterministically.
 *
 * Matching the app's real package manager also avoids dirtying a pnpm/yarn
 * project with npm artifacts and a dependency tree that diverges from the dev
 * server's. Defaults to npm when no lockfile is recognized.
 */
async function playwrightInstallCommand(appPath: string): Promise<{
  command: string;
  args: string[];
  cwd: string;
  /** Whether the add lands in a workspace root above the app. */
  viaWorkspaceRoot: boolean;
}> {
  const installRoot = await findPackageManagerRoot(
    appPath,
    findRepoRoot(appPath),
  );
  const has = (directory: string, file: string) =>
    fs.existsSync(path.join(directory, file));
  const ownsLockfile =
    has(appPath, "pnpm-lock.yaml") ||
    has(appPath, "yarn.lock") ||
    has(appPath, "package-lock.json");
  // The app's own lockfile wins when it has one: that is the tree the dev
  // server runs against, workspace membership or not.
  const lockRoot = ownsLockfile ? appPath : installRoot;
  const viaWorkspaceRoot = lockRoot !== appPath;
  if (has(lockRoot, "pnpm-lock.yaml")) {
    return {
      command: "pnpm",
      args: [
        ...PNPM_INSTALL_POLICY_ARGS,
        "add",
        // Dyad can generate a pnpm-workspace.yaml (for install policy), which
        // makes pnpm treat the app as a workspace root and refuse a plain
        // `pnpm add` without this opt-in. Matches the add-dependency path.
        // Omitted for a member: pnpm run from a member directory adds to that
        // member and updates the ROOT lockfile, which is the whole point here.
        ...(viaWorkspaceRoot ? [] : ["--ignore-workspace-root-check"]),
        "--save-dev",
        "@playwright/test",
      ],
      cwd: appPath,
      viaWorkspaceRoot,
    };
  }
  if (has(lockRoot, "yarn.lock")) {
    // Yarn resolves the workspace from the cwd upward and writes the root
    // lockfile, so a member is handled by running in the member directory.
    return {
      command: "yarn",
      args: ["add", "--dev", "@playwright/test"],
      cwd: appPath,
      viaWorkspaceRoot,
    };
  }
  // npm (package-lock.json) or unknown — mirror the app runtime's npm install.
  return {
    command: "npm",
    args: [
      "install",
      "--save-dev",
      "@playwright/test",
      // npm, unlike pnpm and yarn, does not detect the workspace from the cwd:
      // run inside a member it would create a nested lockfile and node_modules
      // instead of updating the root. `-w <path>` from the root is the
      // documented way to add a dependency to one member.
      ...(viaWorkspaceRoot
        ? ["-w", path.relative(lockRoot, appPath).split(path.sep).join("/")]
        : []),
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
    cwd: lockRoot,
    viaWorkspaceRoot,
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

/**
 * Dyad-generated preview plumbing, regenerated on every run. Committing it
 * would hand a teammate who doesn't use Dyad a tsconfig that shadows the app's
 * own path aliases for everything under e2e-tests/.
 *
 * Kept out of GITIGNORE_ENTRIES because that list is appended on every
 * bootstrap for every app. An app owning its own `e2e-tests/tsconfig.json` is
 * a supported configuration here — ensurePreviewShim declines to overwrite it
 * and warns instead — so an unconditional rule would gitignore a file Dyad
 * acknowledges belongs to the user, and one that isn't tracked yet would then
 * never be committed at all. Appended from ensurePreviewShim instead, and only
 * for the files Dyad actually generated.
 */
const PREVIEW_GITIGNORE_ENTRIES = {
  tsconfig: "/e2e-tests/tsconfig.json",
  shim: "/e2e-tests/fixtures/dyad/",
} as const;

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

/** Bearer token for the run-scoped, one-preview CDP broker. */
export const PREVIEW_CDP_TOKEN_ENV = "DYAD_PREVIEW_CDP_TOKEN";

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

/** Where an older Dyad's mapping pointed, relative to the same tsconfig. */
const LEGACY_SHIM_PATH_FROM_E2E_TSCONFIG = `./${LEGACY_PREVIEW_SHIM_RELATIVE_PATH.slice(
  `${E2E_TEST_DIR}/`.length,
)}`;

/** A tsconfig path with the optional "./" prefix and extension removed. */
function shimPathStem(target: string): string {
  return target.replace(/\.tsx?$/, "").replace(/^\.\//, "");
}

/**
 * Whether a tsconfig the app owns routes `@playwright/test` at `shimPath`.
 *
 * Reads the actual mapping rather than searching the file: a stray mention in
 * an `include` or a comment would otherwise read as "routed", and the run
 * would keep the CDP endpoint, drop `--headed`, and go invisible in a browser
 * the shim never loaded. Compares stems, since both the leading "./" and the
 * extension are optional — reading "./fixtures/dyad-test" as "not the legacy
 * shim" is how the file a mapping resolves to ends up deleted. Falls back to a
 * substring test only when the file can't be parsed at all, where guessing
 * "not mapped" is the more destructive answer.
 */
function mapsToShim(tsconfig: string, shimPath: string): boolean {
  const stem = shimPathStem(shimPath);
  const parsed = parseTsconfigJson(tsconfig);
  if (!parsed) return tsconfig.includes(stem);

  const targets = (
    parsed.compilerOptions?.paths as Record<string, unknown> | undefined | null
  )?.["@playwright/test"];
  if (!Array.isArray(targets)) return false;
  return targets.some(
    (target) => typeof target === "string" && shimPathStem(target) === stem,
  );
}

function resolvedPlaywrightTargets(
  configPath: string,
  visited = new Set<string>(),
): string[] | null {
  if (visited.has(configPath) || visited.size >= MAX_TSCONFIG_FILES) return [];
  visited.add(configPath);

  const raw = readFileOrNull(configPath);
  const parsed = raw === null ? null : parseTsconfigJson(raw);
  if (!parsed) return [];

  const paths = parsed.compilerOptions?.paths;
  if (paths && typeof paths === "object") {
    const targets = (paths as Record<string, unknown>)["@playwright/test"];
    if (!Array.isArray(targets)) return [];
    const configDir = path.dirname(configPath);
    const baseUrl = parsed.compilerOptions?.baseUrl;
    const baseDir =
      typeof baseUrl === "string"
        ? path.resolve(configDir, baseUrl)
        : configDir;
    return targets
      .filter((target): target is string => typeof target === "string")
      .map((target) => path.resolve(baseDir, target));
  }

  const parents = Array.isArray(parsed.extends)
    ? parsed.extends
    : [parsed.extends];
  // TypeScript applies later bases after earlier ones. Search in reverse so
  // the first mapping found is the one that survives into this config.
  for (const parent of parents.reverse()) {
    if (typeof parent !== "string" || !parent.startsWith(".")) continue;
    const targets = resolvedPlaywrightTargets(
      resolveTsconfigRef(configPath, parent, "extends"),
      visited,
    );
    if (targets !== null) return targets;
  }
  return null;
}

function tsconfigRoutesToShim(configPath: string, shimPath: string): boolean {
  const shimStem = shimPathStem(path.resolve(shimPath));
  return (resolvedPlaywrightTargets(configPath) ?? []).some(
    (target) => shimPathStem(path.normalize(target)) === shimStem,
  );
}

/**
 * Whether the app's own `e2e-tests/tsconfig.json` routes `@playwright/test` at
 * `shimPath`, by its own `paths` or one inherited through `extends`.
 *
 * Both halves earn their place. `mapsToShim` reads the text it was handed, so
 * it still answers when the file can't be parsed (where the substring fallback
 * is the safe guess). `tsconfigRoutesToShim` re-reads from disk and walks the
 * `extends` chain, resolving each mapping against its own `baseUrl` — without
 * it an app that keeps its Playwright mapping in a shared base config reads as
 * unrouted, which both turns preview runs off and makes the legacy shim look
 * safe to delete out from under a mapping that still points at it.
 */
function appTsconfigRoutesToShim(
  appPath: string,
  tsconfigText: string,
  relativeShimPath: string,
  absoluteShimPath: string,
): boolean {
  return (
    mapsToShim(tsconfigText, relativeShimPath) ||
    tsconfigRoutesToShim(
      path.join(appPath, E2E_TSCONFIG_RELATIVE_PATH),
      absoluteShimPath,
    )
  );
}

function findUnroutedCloserTsconfig(
  appPath: string,
  shimPath: string,
): string | null {
  const e2eRoot = path.join(appPath, E2E_TEST_DIR);
  const specs = globSync(TEST_SPEC_GLOB, {
    cwd: appPath,
    absolute: true,
    nodir: true,
  }).sort();

  for (const spec of specs) {
    let directory = path.dirname(spec);
    while (directory !== e2eRoot) {
      const relative = path.relative(e2eRoot, directory);
      if (relative.startsWith("..") || path.isAbsolute(relative)) break;
      const candidate = path.join(directory, "tsconfig.json");
      if (fs.existsSync(candidate)) {
        if (!tsconfigRoutesToShim(candidate, shimPath)) {
          return path.relative(appPath, candidate).split(path.sep).join("/");
        }
        break;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return null;
}

/** A browser channel that drives a system-installed browser, or bundled. */
export type BrowserChannel = "chrome" | "msedge";

/**
 * The `use.screenshot`/`use.trace` block. Kept as a named constant so the
 * migration for older generated configs splices in exactly what a fresh
 * bootstrap writes.
 */
const PREVIEW_RECORDER_CONFIG_LINES = `    // Off for a preview run: tracing expects browser-global CDP access, which
    // the preview-only automation broker deliberately rejects. The fixture
    // shim attaches a screenshot of the selected page instead.
    screenshot: process.env.${PREVIEW_CDP_ENDPOINT_ENV}
      ? "off"
      : "only-on-failure",
    trace: process.env.${PREVIEW_CDP_ENDPOINT_ENV} ? "off" : "retain-on-failure",`;

/** What that block looked like before preview runs existed. */
const LEGACY_RECORDER_CONFIG_LINES = `    screenshot: "only-on-failure",
    trace: "retain-on-failure",`;

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

// ${DYAD_CONFIG_SENTINEL}. Dyad starts the server for the run itself — an
// isolated run-scoped one when sandboxing is on, otherwise your normal preview
// — so we point baseURL at whichever it selected (passed via env) rather than
// using Playwright's \`webServer\` (which would double-start the app).
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
${PREVIEW_RECORDER_CONFIG_LINES}
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
// Lets a headed run drive the page already open in Dyad's preview panel
// instead of launching a separate browser. Inert unless Dyad sets
// ${PREVIEW_CDP_ENDPOINT_ENV}, so ordinary test runs behave exactly as before.
import * as pw from "@playwright/test";

export * from "@playwright/test";

const endpoint = process.env.${PREVIEW_CDP_ENDPOINT_ENV};
const cdpToken = process.env.${PREVIEW_CDP_TOKEN_ENV};
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

function requirePreviewContext(browser: pw.Browser) {
  const contexts = browser.contexts();
  if (contexts.length !== 1) {
    throw new Error(
      \`Dyad preview: the automation broker exposed \${contexts.length} browser contexts instead of exactly one.\`,
    );
  }
  return contexts[0];
}

async function ensurePreviewBetterAuthSession({
  context,
  origin,
  requestUrl,
  requestData,
}: {
  context: pw.BrowserContext;
  origin: string;
  requestUrl: string;
  requestData: unknown;
}): Promise<void> {
  const page = context.pages().find((candidate) => {
    try {
      return new URL(candidate.url()).origin === origin;
    } catch {
      return false;
    }
  });
  if (!page) return;

  const result = await page.evaluate(
    async ({ signInUrl, data }) => {
      const hasSession = async () => {
        const response = await fetch("/api/auth/get-session", {
          credentials: "include",
        });
        if (!response.ok) return false;
        const body = await response.json().catch(() => null);
        return !!(
          body &&
          (body.user || (body.session && body.session.user))
        );
      };

      // A normal Playwright-owned context receives APIRequestContext cookies
      // automatically. Electron's pre-existing CDP context can report a
      // successful sign-in without exposing that cookie to the page. Avoid a
      // second request when the native session already has it.
      if (await hasSession()) return { ok: true, status: 200 };

      const response = await fetch(signInUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: typeof data === "string" ? data : JSON.stringify(data),
      });
      if (!response.ok) {
        return { ok: false, status: response.status };
      }
      return { ok: await hasSession(), status: response.status };
    },
    { signInUrl: requestUrl, data: requestData },
  );

  if (!result.ok) {
    throw new Error(
      \`Dyad preview: Better Auth sign-in returned \${result.status}, but no browser session was established.\`,
    );
  }
}

export const test = !endpoint
  ? pw.test
  : pw.test.extend({
      browser: [
        async ({}, use) => {
          if (!cdpToken) {
            throw new Error("Dyad preview: ${PREVIEW_CDP_TOKEN_ENV} is not set.");
          }
          const browser = await pw.chromium.connectOverCDP(endpoint, {
            slowMo,
            headers: { Authorization: \`Bearer \${cdpToken}\` },
          });
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
        const baseUrl = requireBaseUrl();
        const origin = new URL(baseUrl).origin;
        // The broker is the security boundary: it must represent exactly the
        // isolated preview context and nothing from Dyad's privileged session.
        const context = requirePreviewContext(browser);
        // Playwright applies the config's \`baseURL\` when IT creates a context.
        // Dyad's preview created this one, so the option is missing and every
        // relative URL would have nothing to resolve against. The checks that
        // read it on the client — expect(page).toHaveURL("/x"),
        // page.waitForURL, route globs — are fixed by filling it in.
        // Best-effort: it's internal, so a rename should cost the extras, not
        // the run. Navigation and API requests resolve in Playwright's server
        // half instead, from the options the context was CREATED with, so they
        // are handled separately (below, and in the page fixture).
        const contextInternals = context as unknown as {
          _options?: { baseURL?: string };
        };
        if (contextInternals._options) {
          contextInternals._options.baseURL = baseUrl;
        }
        // context.request.get("/api/health") — and page.request, which is the
        // same object — would otherwise reach the server half as "/api/health"
        // and throw "Invalid URL", but only under a preview run. Resolve here
        // so a spec behaves the same whichever way Dyad runs it.
        type ApiCall = (url: unknown, options?: unknown) => unknown;
        const api = context.request as unknown as Record<string, ApiCall>;
        const originalApiMethods = new Map<string, ApiCall>();
        const apiMethodNames = ["fetch", "get", "post", "put", "patch", "delete", "head"];
        for (const name of apiMethodNames) {
          const original = api[name];
          if (typeof original !== "function") continue;
          originalApiMethods.set(name, original);
          // A Request object (fetch's other overload) carries its own URL.
          api[name] = async (url, options) => {
            const resolvedUrl =
              typeof url === "string" ? new URL(url, baseUrl).href : url;
            const response = await original.call(
              api,
              resolvedUrl,
              options,
            );

            // Better Auth depends on a first-party HttpOnly cookie. Playwright's
            // API client can return success under connectOverCDP while Electron's
            // native preview session remains signed out. Verify in the page and,
            // only when necessary, repeat this one idempotent credential exchange
            // through browser fetch so Chromium accepts Set-Cookie itself.
            if (typeof resolvedUrl === "string") {
              const parsedUrl = new URL(resolvedUrl);
              const requestData = (
                options as { data?: unknown } | undefined
              )?.data;
              if (
                name === "post" &&
                parsedUrl.origin === origin &&
                parsedUrl.pathname === "/api/auth/sign-in/email" &&
                requestData !== undefined &&
                response &&
                typeof (response as { ok?: unknown }).ok === "function" &&
                (response as { ok: () => boolean }).ok()
              ) {
                await ensurePreviewBetterAuthSession({
                  context,
                  origin,
                  requestUrl: resolvedUrl,
                  requestData,
                });
              }
            }

            return response;
          };
        }
        try {
          // Pre-existing context: hand it over without closing it afterwards.
          await use(context);
        } finally {
          // It outlives this fixture, so the patches have to come back off.
          for (const [name, original] of originalApiMethods) {
            api[name] = original;
          }
        }
      },
      page: async ({ context }, use, testInfo) => {
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
          // Pre-existing page: leave it open for Dyad to replace after this
          // single-test process finishes.
          await use(page);
        } finally {
          page.goto = originalGoto;
          // Playwright's built-in screenshot/trace recorder is off for preview
          // runs (see the config) because tracing needs browser-global CDP
          // commands the preview-only broker rejects. Attach the selected page
          // directly instead. It lands
          // first because auto fixtures tear down last, so it is the one
          // Dyad picks up even in an app whose config predates that change.
          if (testInfo.status !== testInfo.expectedStatus) {
            try {
              await testInfo.attach("screenshot", {
                body: await page.screenshot(),
                contentType: "image/png",
              });
            } catch {
              // A screenshot is a nicety; never fail teardown over it.
            }
          }
        }
      },
    });

export const expect = pw.expect;
`;
}

/** How many tsconfig files to open looking for the app's `paths`. */
const MAX_TSCONFIG_FILES = 8;

interface ParsedTsconfig {
  extends?: unknown;
  references?: unknown;
  compilerOptions?: { baseUrl?: unknown; paths?: unknown };
}

/**
 * Parses a tsconfig, which is JSONC rather than JSON: comments and trailing
 * commas are legal there and fatal to `JSON.parse`, and the templates most apps
 * start from are full of both. Strips them while tracking string literals, so a
 * "//" inside a URL survives.
 */
export function parseTsconfigJson(text: string): ParsedTsconfig | null {
  let out = "";
  let i = 0;
  // Held back until the next meaningful character says whether it's a
  // separator (keep) or a trailing comma (drop).
  let pendingComma = false;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (pendingComma) {
        pendingComma = false;
        out += ",";
      }
      out += ch;
      i++;
      while (i < text.length) {
        const inner = text[i];
        out += inner;
        i++;
        if (inner === "\\") {
          out += text[i] ?? "";
          i++;
          continue;
        }
        if (inner === '"') break;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === ",") {
      pendingComma = true;
      i++;
      continue;
    }
    if (pendingComma && !/\s/.test(ch)) {
      pendingComma = false;
      if (ch !== "}" && ch !== "]") out += ",";
    }
    out += ch;
    i++;
  }
  try {
    const parsed: unknown = JSON.parse(out);
    return parsed && typeof parsed === "object"
      ? (parsed as ParsedTsconfig)
      : null;
  } catch {
    return null;
  }
}

/** Resolves a tsconfig `extends`/`references` entry to a file path. */
function resolveTsconfigRef(
  fromConfig: string,
  target: string,
  kind: "extends" | "references",
): string {
  const resolved = path.resolve(path.dirname(fromConfig), target);
  if (target.endsWith(".json")) return resolved;
  // The two spell an extension-less target differently: TypeScript appends
  // `.json` to an `extends` ("./tsconfig.base" is a file), and looks for a
  // `tsconfig.json` inside a `references` path (it names a project directory).
  return kind === "extends"
    ? `${resolved}.json`
    : path.join(resolved, "tsconfig.json");
}

/**
 * The app's own `paths` mappings, with the directory they resolve against.
 *
 * Starts at the app's tsconfig and, if that one declares no `paths`, follows
 * relative `extends` parents and then `references` — solution-style roots
 * (`create-vite` and friends) keep the aliases in a referenced project. A
 * package specifier (`@tsconfig/...`) is not followed: resolving it goes
 * through node resolution, which isn't worth reimplementing for a best-effort
 * copy. Returns null when there is genuinely nothing to copy.
 */
function readAppPathMappings(
  appPath: string,
): { mappings: Record<string, unknown>; baseDir: string } | null {
  const queue = [path.join(appPath, "tsconfig.json")];
  const visited = new Set<string>();
  while (queue.length > 0 && visited.size < MAX_TSCONFIG_FILES) {
    const configPath = queue.shift()!;
    if (visited.has(configPath)) continue;
    visited.add(configPath);

    const raw = readFileOrNull(configPath);
    if (raw === null) continue;
    const parsed = parseTsconfigJson(raw);
    if (!parsed) continue;

    const paths = parsed.compilerOptions?.paths;
    if (paths && typeof paths === "object") {
      const baseUrl = parsed.compilerOptions?.baseUrl;
      const dir = path.dirname(configPath);
      return {
        mappings: paths as Record<string, unknown>,
        // TypeScript resolves `paths` against `baseUrl` when it's set, and
        // against the config's own directory otherwise.
        baseDir: typeof baseUrl === "string" ? path.resolve(dir, baseUrl) : dir,
      };
    }

    // A parent is this same project's configuration, so it comes first; a
    // reference is a sibling project that usually shares the app's aliases.
    const parents = Array.isArray(parsed.extends)
      ? parsed.extends
      : [parsed.extends];
    for (const parent of parents) {
      if (typeof parent === "string" && parent.startsWith(".")) {
        queue.push(resolveTsconfigRef(configPath, parent, "extends"));
      }
    }
    if (Array.isArray(parsed.references)) {
      for (const reference of parsed.references) {
        const target = (reference as { path?: unknown })?.path;
        if (typeof target === "string") {
          queue.push(resolveTsconfigRef(configPath, target, "references"));
        }
      }
    }
  }
  return null;
}

/**
 * The app's `paths`, rewritten to resolve from the generated tsconfig's
 * directory.
 *
 * Playwright — and the editor — read `paths` from the CLOSEST tsconfig above a
 * file and never merge in parents, so the file written beside the specs
 * SHADOWS the app's root tsconfig: without this, a spec importing
 * `@/lib/routes` stops resolving the moment a preview run writes that file, in
 * every later run (preview or not) and in the editor, permanently. `extends`
 * is not a fix — a child's `paths` replaces the parent's outright rather than
 * merging with it.
 */
function rebasedAppPathMappings(appPath: string): Record<string, string[]> {
  const found = readAppPathMappings(appPath);
  if (!found) return {};
  const e2eDir = path.join(appPath, E2E_TEST_DIR);
  const rebased: Record<string, string[]> = {};
  for (const [alias, targets] of Object.entries(found.mappings)) {
    if (!Array.isArray(targets)) continue;
    const rewritten = targets
      .filter((target): target is string => typeof target === "string")
      .map((target) =>
        path.isAbsolute(target)
          ? target
          : path
              .relative(e2eDir, path.resolve(found.baseDir, target))
              .split(path.sep)
              .join("/"),
      );
    if (rewritten.length > 0) rebased[alias] = rewritten;
  }
  return rebased;
}

export function buildE2eTsconfigSource(appPath: string): string {
  const extendsApp = fs.existsSync(path.join(appPath, "tsconfig.json"));
  return `${JSON.stringify(
    {
      _comment: `${DYAD_CONFIG_SENTINEL}. Routes @playwright/test through Dyad's fixture shim so tests can run inside the preview panel. The other entries keep this app's own tsconfig settings, which this file would otherwise shadow. Delete this file to opt out.`,
      // This file is the closest tsconfig to the specs, so on its own it would
      // replace the app's compiler options wholesale — target, lib, jsx,
      // strict, the lot — with the bare defaults, and turn green specs red.
      ...(extendsApp ? { extends: "../tsconfig.json" } : {}),
      // `extends` also carries `files`, which a solution-style root sets to []:
      // without this the specs would belong to no project at all.
      ...(extendsApp
        ? { include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"] }
        : {}),
      compilerOptions: {
        // Playwright deliberately skips tsconfig path mappings for JavaScript
        // unless allowJs is enabled. Without this, supported .js/.jsx specs
        // import the real runner and silently open a separate browser.
        allowJs: true,
        baseUrl: ".",
        // `paths` is the one option `extends` can't merge — a child replaces
        // the parent's outright — so the app's own aliases are copied in.
        paths: {
          ...rebasedAppPathMappings(appPath),
          // Last, so the shim wins if the app maps this specifier too.
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
/**
 * Stand-in for the shim at its old location, for an app whose own tsconfig
 * still maps `@playwright/test` there.
 *
 * It must NOT be a copy of the shim: the mapping that leads here is the closest
 * one above this file, so the shim's own `import ... from "@playwright/test"`
 * would resolve straight back to itself. A relative import is never
 * path-mapped, so forwarding is the one shape that can't loop — and the real
 * shim keeps the sibling tsconfig that shadows the mapping for its own import.
 */
export function buildLegacyShimForwarderSource(): string {
  const forwardTo = `./${PREVIEW_SHIM_RELATIVE_PATH.slice(
    `${E2E_TEST_DIR}/fixtures/`.length,
  ).replace(/\.ts$/, "")}`;
  return `// ${DYAD_CONFIG_SENTINEL}. Do not edit — Dyad regenerates this file.
//
// The shim moved to ${PREVIEW_SHIM_RELATIVE_PATH}, but your
// ${E2E_TSCONFIG_RELATIVE_PATH} still maps "@playwright/test" here, so this
// file forwards to its new home. Point that mapping at
// "${SHIM_PATH_FROM_E2E_TSCONFIG}" to drop this hop.
export * from "${forwardTo}";
`;
}

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
/**
 * Rewrites the Dyad-generated `e2e-tests/tsconfig.json` from the app's current
 * `paths`, if one is there.
 *
 * That file snapshots the app's aliases rebased onto the test directory, and as
 * the closest tsconfig above the specs it replaces the app's mappings outright
 * for both Playwright and the editor. Written only by preview runs, it would
 * otherwise keep serving a snapshot from whenever the last preview run happened
 * — so an alias added afterwards (or the experiment being switched back off)
 * silently stops resolving, with a generated file nothing points at as the
 * cause. Run from the ordinary bootstrap path too, so it tracks the app.
 *
 * A no-op when the file is absent or the app owns it: this must never create
 * the mapping for an app that has not opted into preview runs.
 */
export function refreshGeneratedE2eTsconfig(appPath: string): void {
  const tsconfigPath = path.join(appPath, E2E_TSCONFIG_RELATIVE_PATH);
  const existing = readFileOrNull(tsconfigPath);
  if (existing === null || !existing.includes(DYAD_CONFIG_SENTINEL)) return;

  const refreshed = buildE2eTsconfigSource(appPath);
  if (refreshed === existing) return;
  fs.writeFileSync(tsconfigPath, refreshed);
  logger.info(
    `Refreshed ${E2E_TSCONFIG_RELATIVE_PATH} from the app's current tsconfig paths`,
  );
}

export function ensurePreviewShim(appPath: string): { warning?: string } {
  // Only the files this run actually generated get a gitignore rule; see
  // PREVIEW_GITIGNORE_ENTRIES.
  const generatedEntries: string[] = [];

  const shimPath = path.join(appPath, PREVIEW_SHIM_RELATIVE_PATH);
  const existingShim = readFileOrNull(shimPath);
  if (existingShim === null || existingShim.includes(DYAD_CONFIG_SENTINEL)) {
    fs.mkdirSync(path.dirname(shimPath), { recursive: true });
    fs.writeFileSync(shimPath, buildPreviewShimSource());
    generatedEntries.push(PREVIEW_GITIGNORE_ENTRIES.shim);
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

  const tsconfigPath = path.join(appPath, E2E_TSCONFIG_RELATIVE_PATH);
  const existingTsconfig = readFileOrNull(tsconfigPath);
  // A tsconfig carrying the sentinel is ours to rewrite; anything else is the
  // app's, and its mappings are the ones that decide how a run resolves.
  const appOwnedTsconfig =
    existingTsconfig !== null &&
    !existingTsconfig.includes(DYAD_CONFIG_SENTINEL)
      ? existingTsconfig
      : null;

  // An older Dyad kept the shim one directory up and told users to map to it
  // there. Normally that file is dead and worth removing — nothing points at
  // it, and leaving it invites edits to a file that no longer runs. But if the
  // app's own tsconfig still maps to it, that mapping is what makes
  // `@playwright/test` resolve AT ALL, so deleting it would break every run in
  // the app, preview or not. Leave a forwarder instead (and write one back if
  // an earlier Dyad already deleted the file out from under the mapping).
  const legacyShimPath = path.join(appPath, LEGACY_PREVIEW_SHIM_RELATIVE_PATH);
  const legacyShim = readFileOrNull(legacyShimPath);
  const legacyStillMapped =
    appOwnedTsconfig !== null &&
    appTsconfigRoutesToShim(
      appPath,
      appOwnedTsconfig,
      LEGACY_SHIM_PATH_FROM_E2E_TSCONFIG,
      legacyShimPath,
    );
  if (legacyStillMapped) {
    if (legacyShim === null || legacyShim.includes(DYAD_CONFIG_SENTINEL)) {
      fs.mkdirSync(path.dirname(legacyShimPath), { recursive: true });
      fs.writeFileSync(legacyShimPath, buildLegacyShimForwarderSource());
    }
  } else if (legacyShim?.includes(DYAD_CONFIG_SENTINEL)) {
    fs.rmSync(legacyShimPath, { force: true });
  }

  const rootRoutesToShim =
    appOwnedTsconfig === null ||
    legacyStillMapped ||
    appTsconfigRoutesToShim(
      appPath,
      appOwnedTsconfig,
      SHIM_PATH_FROM_E2E_TSCONFIG,
      shimPath,
    );

  if (appOwnedTsconfig === null) {
    fs.writeFileSync(tsconfigPath, buildE2eTsconfigSource(appPath));
    generatedEntries.push(PREVIEW_GITIGNORE_ENTRIES.tsconfig);
  }

  if (generatedEntries.length > 0) {
    appendGitignoreEntries(appPath, generatedEntries);
  }

  if (rootRoutesToShim) {
    const closerTsconfig = findUnroutedCloserTsconfig(appPath, shimPath);
    if (closerTsconfig) {
      return {
        warning: `${closerTsconfig} takes precedence for at least one test and doesn't route "@playwright/test" through Dyad's preview shim. The run will use a separate browser instead. Extend ${E2E_TSCONFIG_RELATIVE_PATH} or add a mapping to the generated shim to enable preview runs.\n`,
      };
    }
    // The app kept its own root tsconfig, or every closer config, routing to a
    // shim Dyad maintains.
    return {};
  }

  return {
    warning: `Your app has its own ${E2E_TSCONFIG_RELATIVE_PATH}, so Dyad can't route tests through the preview. The run will use a separate browser instead. Add a "@playwright/test" path mapping to "${SHIM_PATH_FROM_E2E_TSCONFIG}" to enable preview runs.\n`,
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
 * Whether the Playwright runner can resolve `@playwright/test` from here, the
 * way Node does: walking up through every parent `node_modules`.
 *
 * Deliberately NOT `isPlaywrightInstalled`. That one answers "should I install
 * into this exact directory?", where a copy hoisted to a monorepo's workspace
 * root is not the answer and a false negative costs a redundant install. This
 * one answers "can the run start at all?", where the same false negative would
 * refuse a sandbox `npx playwright` would have resolved fine.
 */
export function canResolvePlaywrightRunner(appPath: string): boolean {
  try {
    resolveNodeModulePackageJsonPathSync(appPath, ["@playwright", "test"]);
    return true;
  } catch {
    return false;
  }
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

/**
 * Blanks out `//` and block comments, leaving everything else — including
 * string contents — in place.
 *
 * Scans rather than regex-replaces so the two cases can't be confused for each
 * other: a `//` inside a string (the template's own `"http://localhost:32100"`)
 * is consumed as string content instead of starting a comment, and a quote
 * inside a comment can't open a string. Replaced with spaces rather than
 * removed so offsets, and therefore the `(?:^|[,{\s])` boundary below, survive.
 */
function stripJsComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const rest = source.startsWith("//", i)
      ? source.indexOf("\n", i)
      : source.startsWith("/*", i)
        ? (() => {
            const end = source.indexOf("*/", i + 2);
            return end === -1 ? -1 : end + 2;
          })()
        : null;
    if (rest !== null) {
      const stop = rest === -1 ? source.length : rest;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }

    const quote = source[i];
    if (quote === '"' || quote === "'" || quote === "`") {
      out += quote;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        // Keep escape pairs together so a `\"` can't be read as the closer.
        const width = source[i] === "\\" ? 2 : 1;
        out += source.slice(i, i + width);
        i += width;
      }
      if (i < source.length) {
        out += quote;
        i += 1;
      }
      continue;
    }

    out += quote;
    i += 1;
  }
  return out;
}

/**
 * True when Dyad's config names a `timeout` of its own. The template never
 * does, so any occurrence is the user's — and a CLI `--timeout` would override
 * it silently. Deliberately conservative: `expect: { timeout }` counts too,
 * because guessing wrong the other way overrides a deliberate choice.
 *
 * Comments are stripped first: the template ships a paragraph about timeouts,
 * and reading prose as a setting would drop the `--timeout` raise that keeps a
 * slow-motion run from timing out at Playwright's 30s default. Quoted keys
 * (`"timeout":`) count, since JSON-style config is just as much a real setting.
 */
export function configSetsTimeout(appPath: string): boolean {
  const text = readDyadConfigText(appPath);
  return (
    text != null &&
    /(?:^|[,{\s])["']?timeout["']?\s*:/.test(stripJsComments(text))
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
  // A `launchOptions` of the user's own is in the same object literal, so
  // splicing ours in would make one of the two silently win — and the
  // TEST_SLOW_MO_ENV guard above would then call it migrated forever.
  if (text.includes("launchOptions")) return;
  const baseUrlLine = `    baseURL: process.env.${TEST_BASE_URL_ENV} || "http://localhost:32100",`;
  if (!text.includes(baseUrlLine)) return;
  fs.writeFileSync(
    dyadConfigPath(appPath),
    text.replace(baseUrlLine, `${baseUrlLine}\n${SLOW_MO_CONFIG_LINES}`),
  );
  logger.info(`Added slow-motion support to ${DYAD_CONFIG_FILENAME}`);
}

/**
 * Turns Playwright's own screenshot/trace recorders off for preview runs in a
 * Dyad-generated config written before preview runs existed.
 *
 * `--trace=off` is passed on the CLI, so a stale config is already covered
 * there — but Playwright has no CLI equivalent for `screenshot`. Without this,
 * a failing test in an app bootstrapped by an older Dyad still captures every
 * page reachable over the borrowed CDP connection, which includes Dyad's own
 * product windows, and writes them into the run's artifacts directory.
 *
 * Only touches configs carrying the sentinel, and only while the generated
 * lines are still verbatim — anything else is the user's to change.
 */
function migrateConfigPreviewRecorders(appPath: string): void {
  if (!isDyadGeneratedConfig(appPath)) return;
  const text = readDyadConfigText(appPath);
  if (!text || text.includes(PREVIEW_CDP_ENDPOINT_ENV)) return;
  if (!text.includes(LEGACY_RECORDER_CONFIG_LINES)) return;
  fs.writeFileSync(
    dyadConfigPath(appPath),
    text.replace(LEGACY_RECORDER_CONFIG_LINES, PREVIEW_RECORDER_CONFIG_LINES),
  );
  logger.info(
    `Scoped screenshot/trace capture to non-preview runs in ${DYAD_CONFIG_FILENAME}`,
  );
}

function appendGitignoreEntries(
  appPath: string,
  entries: readonly string[] = GITIGNORE_ENTRIES,
): void {
  const gitignorePath = path.join(appPath, ".gitignore");
  let existing = "";
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, "utf8");
  }
  const existingLines = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = entries.filter((e) => !existingLines.has(e));
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
 * Returns whether a fresh install was performed (first-run setup), and whether
 * specs actually reach the preview shim — `ensurePreviewShim` declines when the
 * app owns the tsconfig the mapping would go in, and the caller has to know
 * that its preview run has quietly become an ordinary browser run.
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
}): Promise<{ installed: boolean; previewRouted: boolean }> {
  // Yarn Plug'n'Play has no node_modules, so the installed-check below and the
  // direct Playwright CLI runner can't work with it: every run would reinstall
  // and then fail to resolve the runner. Dead-end with an actionable message
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

  const install = await playwrightInstallCommand(appPath);
  // Which "installed?" question to ask depends on where the add lands. For a
  // workspace member npm hoists to the root and leaves no member symlink, so
  // the exact-directory check would answer false forever and re-run the add on
  // every single test run.
  const packageInstalled = install.viaWorkspaceRoot
    ? canResolvePlaywrightRunner(appPath)
    : isPlaywrightInstalled(appPath);

  if (!packageInstalled) {
    onOutput?.("Installing @playwright/test...\n");
    const { command, args } = install;
    const installDep = await spawnStreaming({
      command,
      args,
      cwd: install.cwd,
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
  // teach it the slow-motion option added later, and scope Playwright's own
  // recorders away from preview runs. All are no-ops once the config is
  // current, including right after the writes above.
  migrateConfigTestDir(appPath);
  migrateConfigSlowMo(appPath);
  migrateConfigPreviewRecorders(appPath);

  let previewRouted = false;
  if (writePreviewShim) {
    try {
      const { warning } = ensurePreviewShim(appPath);
      if (warning) {
        onOutput?.(warning);
      }
      previewRouted = !warning;
    } catch (err) {
      // Losing the preview routing is not worth failing an otherwise fine run.
      logger.warn(`Failed to write the preview test shim: ${err}`);
      onOutput?.(
        "Couldn't set up the preview test shim; running in a separate browser instead.\n",
      );
    }
  }

  // The bundled Chromium binary is downloaded separately from the npm package,
  // so we track it apart (a present package does NOT mean the browser is
  // there). Only needed when we're NOT driving a system browser or Dyad's
  // already-running Electron preview.
  let downloadedBrowser = false;
  if (
    !previewRouted &&
    !usesChannel &&
    !isPlaywrightBrowserInstalled(appPath)
  ) {
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
  // The preview setup above rewrites this file when it owns it. This path keeps
  // a snapshot from an earlier preview run in step with the app for every
  // OTHER kind of run.
  refreshGeneratedE2eTsconfig(appPath);

  return { installed: !packageInstalled || downloadedBrowser, previewRouted };
}
