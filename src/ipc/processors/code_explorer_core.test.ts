import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildCodeExplorerIndex,
  exploreCode,
} from "../../../workers/code_explorer/core";
import {
  clearCodeExplorerWorkerCachesForTests,
  processCodeExplorer,
  processCodeExplorerWithTypeScript,
} from "../../../workers/code_explorer/code_explorer_worker";

const tempDirs: string[] = [];

describe("exploreCode", () => {
  afterEach(() => {
    clearCodeExplorerWorkerCachesForTests();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns cross-file TypeScript symbols and line-numbered windows", () => {
    const appPath = createTempProject({
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
      "src/auth/session.ts": [
        "export interface Session {",
        "  token: string;",
        "}",
        "",
        "export function createSession(userId: string): Session {",
        "  return { token: `session:${userId}` };",
        "}",
        "",
      ].join("\n"),
      "src/auth/AuthService.ts": [
        "import { createSession } from './session';",
        "",
        "export class AuthService {",
        "  login(userId: string) {",
        "    return createSession(userId);",
        "  }",
        "}",
        "",
      ].join("\n"),
    });

    const result = exploreCode(ts, {
      appPath,
      query: "login session auth service flow",
      maxFiles: 4,
      maxDepth: 2,
    });

    expect(result.files.map((file) => file.path)).toContain(
      "src/auth/AuthService.ts",
    );
    expect(result.files.map((file) => file.path)).toContain(
      "src/auth/session.ts",
    );
    expect(result.totalSymbols).toBeGreaterThan(0);
    expect(
      result.files.some((file) =>
        file.windows.some((window) =>
          window.lines.some((line) => line.includes("4   login")),
        ),
      ),
    ).toBe(true);
  });

  it("indexes with bundled TypeScript 6 when an installed TS7 package has no legacy API", async () => {
    const appPath = createTempProject({
      "node_modules/typescript/package.json": JSON.stringify({
        name: "typescript",
        version: "7.0.0",
        exports: { "./package.json": "./package.json" },
      }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext" },
        include: ["src/**/*.ts"],
      }),
      "src/fallback.ts": "export function bundledFallbackSymbol() {}\n",
    });

    const output = await processCodeExplorer({
      appPath,
      query: "bundled fallback symbol",
    });

    expect(output.success).toBe(true);
    if (output.success) {
      expect(output.data.files.map((file) => file.path)).toContain(
        "src/fallback.ts",
      );
      expect(output.data.notes).toContainEqual(
        expect.stringContaining("used bundled TypeScript"),
      );
    }
  });

  it("keeps a useful bundled-compiler index and warns about unsupported TS7 configuration", async () => {
    const appPath = createTempProject({
      "node_modules/typescript/package.json": JSON.stringify({
        name: "typescript",
        version: "7.0.0",
        exports: { "./package.json": "./package.json" },
      }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          deduplicatePackages: false,
        },
        include: ["src/**/*.ts"],
      }),
      "src/fallback.ts": "export function bundledFallbackSymbol() {}\n",
    });

    const output = await processCodeExplorer({
      appPath,
      query: "bundled fallback symbol",
    });

    expect(output.success).toBe(true);
    if (output.success) {
      expect(output.data.files.map((file) => file.path)).toContain(
        "src/fallback.ts",
      );
      const configWarning = output.data.notes.find((note) =>
        note.includes("Some configuration was ignored"),
      );
      expect(configWarning).toContain("deduplicatePackages");
    }
  });

  it("preserves the original error prefix when bundled TypeScript 6 cannot build an index", async () => {
    const appPath = createTempProject({
      "node_modules/typescript/package.json": JSON.stringify({
        name: "typescript",
        version: "7.0.0",
        exports: { "./package.json": "./package.json" },
      }),
    });

    const output = await processCodeExplorer({
      appPath,
      query: "missing config",
    });

    expect(output.success).toBe(false);
    if (!output.success) {
      expect(output.error).toMatch(
        /^No TypeScript configuration file found.* \(Code Explorer used bundled TypeScript .* because the local compiler API was incompatible\)$/,
      );
    }
  });

  it("indexes module-suffixed source files while excluding declarations", () => {
    const appPath = createTempProject({
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            allowJs: true,
            strict: true,
          },
          include: ["src/**/*"],
        },
        null,
        2,
      ),
      "src/badge-esm.mts": [
        "export function loadEsmBadge() {",
        "  return 'esm';",
        "}",
        "",
      ].join("\n"),
      "src/badge-cjs.cts": [
        "export function loadCjsBadge() {",
        "  return 'cjs';",
        "}",
        "",
      ].join("\n"),
      "src/badge-runtime.mjs": [
        "export function loadRuntimeBadge() {",
        "  return 'runtime';",
        "}",
        "",
      ].join("\n"),
      "src/badge-legacy.cjs": [
        "exports.loadLegacyBadge = function loadLegacyBadge() {",
        "  return 'legacy';",
        "};",
        "",
      ].join("\n"),
      "src/badge-types.d.ts": [
        "export declare function loadDeclaredBadge(): string;",
        "",
      ].join("\n"),
      "src/badge-types.d.mts": [
        "export declare function loadDeclaredEsmBadge(): string;",
        "",
      ].join("\n"),
      "src/badge-types.d.cts": [
        "export declare function loadDeclaredCjsBadge(): string;",
        "",
      ].join("\n"),
    });

    const built = buildCodeExplorerIndex(ts, { appPath });
    const indexedPaths = [...built.index.byFile.keys()];

    expect(indexedPaths).toContain("src/badge-esm.mts");
    expect(indexedPaths).toContain("src/badge-cjs.cts");
    expect(indexedPaths).toContain("src/badge-runtime.mjs");
    expect(indexedPaths).toContain("src/badge-legacy.cjs");
    expect(indexedPaths).not.toContain("src/badge-types.d.ts");
    expect(indexedPaths).not.toContain("src/badge-types.d.mts");
    expect(indexedPaths).not.toContain("src/badge-types.d.cts");
  });

  it("writes incremental build info to the provided cache directory", () => {
    const cacheDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "code-explorer-tsbuildinfo-"),
    );
    tempDirs.push(cacheDir);
    const appPath = createTempProject({
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
      "src/session.ts": [
        "export function createSession(userId: string) {",
        "  return { token: `session:${userId}` };",
        "}",
        "",
      ].join("\n"),
    });

    const result = exploreCode(ts, {
      appPath,
      query: "create session",
      tsBuildInfoCacheDir: cacheDir,
    });

    expect(result.files.map((file) => file.path)).toContain("src/session.ts");
    expect(
      fs.readdirSync(cacheDir).some((name) => name.endsWith(".tsbuildinfo")),
    ).toBe(true);
    expect(fs.existsSync(path.join(appPath, "src", "session.js"))).toBe(false);
  });

  it("invalidates the worker index cache when a tsconfig glob gains a new file", async () => {
    const appPath = createTempProject({
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
      "src/index.ts": [
        "export function loadExistingDashboard() {",
        "  return 'dashboard';",
        "}",
        "",
      ].join("\n"),
    });
    fs.mkdirSync(path.join(appPath, "src", "features"), { recursive: true });

    const first = await processCodeExplorerWithTypeScript(ts, {
      appPath,
      query: "new feature panel",
      maxFiles: 4,
      maxDepth: 1,
    });
    if (!first.success) {
      throw new Error(first.error);
    }
    expect(first.data.files.map((file) => file.path)).not.toContain(
      "src/features/newFeature.ts",
    );

    fs.writeFileSync(
      path.join(appPath, "src", "features", "newFeature.ts"),
      [
        "export function loadNewFeaturePanel() {",
        "  return 'new feature panel';",
        "}",
        "",
      ].join("\n"),
    );

    const second = await processCodeExplorerWithTypeScript(ts, {
      appPath,
      query: "new feature panel",
      maxFiles: 4,
      maxDepth: 1,
    });
    if (!second.success) {
      throw new Error(second.error);
    }
    expect(second.data.files.map((file) => file.path)).toContain(
      "src/features/newFeature.ts",
    );
  });

  it("discovers a workspace app tsconfig when the repo root has none", () => {
    const appPath = createTempProject({
      "apps/web/tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
      "apps/web/src/dashboard.ts": [
        "export function loadDashboardMetrics() {",
        "  return ['revenue', 'customers'];",
        "}",
        "",
      ].join("\n"),
    });

    const result = exploreCode(ts, {
      appPath,
      query: "dashboard metrics",
      maxFiles: 2,
      maxDepth: 1,
    });

    expect(result.files.map((file) => file.path)).toContain(
      "apps/web/src/dashboard.ts",
    );
  });

  it("keeps paths relative to a nested git checkout app root", () => {
    const outerRepo = createTempProject({
      "package.json": JSON.stringify({ name: "outer-workspace" }, null, 2),
      "benchmarks/code-explorer/repos/calcom/package.json": JSON.stringify(
        { name: "calcom" },
        null,
        2,
      ),
      "benchmarks/code-explorer/repos/calcom/tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
          },
          include: ["apps/web/**/*.ts"],
        },
        null,
        2,
      ),
      "benchmarks/code-explorer/repos/calcom/apps/web/src/booking.ts": [
        "export function createBookingFromCheckout() {",
        "  return 'booking';",
        "}",
        "",
      ].join("\n"),
    });
    const appPath = path.join(
      outerRepo,
      "benchmarks",
      "code-explorer",
      "repos",
      "calcom",
    );
    fs.mkdirSync(path.join(outerRepo, ".git"));
    fs.mkdirSync(path.join(appPath, ".git"));

    const result = exploreCode(ts, {
      appPath,
      query: "creating booking checkout",
      maxFiles: 2,
      maxDepth: 1,
    });

    expect(result.files.map((file) => file.path)).toContain(
      "apps/web/src/booking.ts",
    );
    expect(result.files.map((file) => file.path)).not.toContain(
      "benchmarks/code-explorer/repos/calcom/apps/web/src/booking.ts",
    );
  });

  it("stems mutation query terms when ranking symbol matches", () => {
    const appPath = createTempProject({
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            jsx: "react-jsx",
          },
          include: ["src/**/*"],
        },
        null,
        2,
      ),
      "src/components/booking/BookingActionsDropdown.tsx": [
        "export interface BookingActionsDropdownProps {",
        "  bookingId: string;",
        "}",
        "",
        "export function BookingActionsDropdown() {",
        "  return null;",
        "}",
        "",
      ].join("\n"),
      "src/server/bookings/createBooking.ts": [
        "export interface CreateBookingInput {",
        "  attendeeEmail: string;",
        "}",
        "",
        "export function createBooking(input: CreateBookingInput) {",
        "  return { id: 'booking-id', attendeeEmail: input.attendeeEmail };",
        "}",
        "",
      ].join("\n"),
    });

    const result = exploreCode(ts, {
      appPath,
      query: "creating booking flow",
      maxFiles: 1,
      maxDepth: 1,
    });

    expect(result.files.map((file) => file.path)).toEqual([
      "src/server/bookings/createBooking.ts",
    ]);
  });

  it("prefers implementation files over test support packages unless tests are requested", () => {
    const appPath = createTempProject({
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
          },
          include: ["packages/**/*.ts"],
        },
        null,
        2,
      ),
      "packages/testing/src/lib/bookingScenario/bookingScenario.ts": [
        "export function createBookingScenarioForTests() {",
        "  return { bookingId: 'test-booking' };",
        "}",
        "",
      ].join("\n"),
      "packages/features/bookings/lib/createBooking.ts": [
        "export function createBookingForEventType() {",
        "  return { bookingId: 'real-booking' };",
        "}",
        "",
      ].join("\n"),
    });

    const result = exploreCode(ts, {
      appPath,
      query: "creating booking implementation flow",
      maxFiles: 1,
      maxDepth: 1,
    });

    expect(result.files.map((file) => file.path)).toEqual([
      "packages/features/bookings/lib/createBooking.ts",
    ]);

    const testResult = exploreCode(ts, {
      appPath,
      query: "creating booking test scenario",
      maxFiles: 1,
      maxDepth: 1,
    });

    expect(testResult.files.map((file) => file.path)).toEqual([
      "packages/testing/src/lib/bookingScenario/bookingScenario.ts",
    ]);
  });

  it("prefers domain mutation implementations over off-domain create handlers and test helpers", () => {
    const appPath = createTempProject({
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            jsx: "react-jsx",
          },
          include: [
            "apps/**/*.ts",
            "apps/**/*.tsx",
            "packages/**/*.ts",
            "packages/**/*.tsx",
          ],
        },
        null,
        2,
      ),
      "apps/web/modules/bookings/lib/bookingSheetKeyboardHandler.test.ts": [
        "export function createMockKeyboardEvent() {",
        "  return new KeyboardEvent('keydown');",
        "}",
        "",
        "export function createBookingSheetKeydownHandler() {",
        "  return null;",
        "}",
        "",
      ].join("\n"),
      "apps/web/app/api/auth/signup/handlers/calcomSignupHandler.ts": [
        "export async function createCustomer() {",
        "  return { stripeCustomerId: 'customer' };",
        "}",
        "",
        "export async function signupHandler() {",
        "  return createCustomer();",
        "}",
        "",
      ].join("\n"),
      "apps/web/modules/bookings/hooks/useBookings.ts": [
        "import { useHandleBookEvent } from '@calcom/atoms/hooks/bookings/useHandleBookEvent';",
        "",
        "export function useBookings() {",
        "  return { handleBookEvent: useHandleBookEvent() };",
        "}",
        "",
      ].join("\n"),
      "apps/web/modules/bookings/components/BookingListContainer.tsx": [
        "export interface BookingListContainerProps {",
        "  bookingId: string;",
        "}",
        "",
        "export function BookingListContainer() {",
        "  return null;",
        "}",
        "",
      ].join("\n"),
      "packages/platform/atoms/hooks/bookings/useHandleBookEvent.ts": [
        "export function useHandleBookEvent() {",
        "  return function handleBookEvent() {",
        "    return fetch('/api/book/event', { method: 'POST' });",
        "  };",
        "}",
        "",
      ].join("\n"),
      "packages/features/bookings/lib/service/RegularBookingService.ts": [
        "export class RegularBookingService {",
        "  async createBooking() {",
        "    return { id: 'booking-id' };",
        "  }",
        "}",
        "",
      ].join("\n"),
    });

    const result = exploreCode(ts, {
      appPath,
      query:
        "booking create hook api handler service form handle submit mutation",
      maxFiles: 3,
      maxDepth: 1,
    });

    const paths = result.files.map((file) => file.path);
    expect(paths).toContain(
      "packages/platform/atoms/hooks/bookings/useHandleBookEvent.ts",
    );
    expect(paths).toContain(
      "packages/features/bookings/lib/service/RegularBookingService.ts",
    );
    expect(paths).not.toContain(
      "apps/web/app/api/auth/signup/handlers/calcomSignupHandler.ts",
    );
    expect(paths).not.toContain(
      "apps/web/modules/bookings/lib/bookingSheetKeyboardHandler.test.ts",
    );
    expect(paths).not.toContain(
      "apps/web/modules/bookings/components/BookingListContainer.tsx",
    );
  });

  it("prefers product app tsconfigs over docs tsconfigs in monorepo roots", () => {
    const appPath = createTempProject({
      "apps/docs/tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
      "apps/docs/src/docs.ts": [
        "export function renderDocsHome() {",
        "  return 'docs';",
        "}",
        "",
      ].join("\n"),
      "apps/web/tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
      "apps/web/src/booking.ts": [
        "export function createBookingFromWeb() {",
        "  return 'booking';",
        "}",
        "",
      ].join("\n"),
    });

    const result = exploreCode(ts, {
      appPath,
      query: "booking create web",
      maxFiles: 2,
      maxDepth: 1,
    });

    expect(result.files.map((file) => file.path)).toContain(
      "apps/web/src/booking.ts",
    );
    expect(result.files.map((file) => file.path)).not.toContain(
      "apps/docs/src/docs.ts",
    );
  });

  it("allows TypeScript project references inside a parent monorepo package", () => {
    const projectRoot = createTempProject({
      "webapp/package.json": JSON.stringify({ private: true }, null, 2),
      "webapp/channels/package.json": JSON.stringify(
        { name: "channels" },
        null,
        2,
      ),
      "webapp/channels/tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            composite: true,
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
          },
          include: ["src/**/*.ts"],
          references: [{ path: "../platform/client" }],
        },
        null,
        2,
      ),
      "webapp/channels/src/send_post.ts": [
        "import { sendPostToServer } from '../../platform/client/src/client';",
        "",
        "export function sendPostFromChannel(message: string) {",
        "  return sendPostToServer(message);",
        "}",
        "",
      ].join("\n"),
      "webapp/platform/client/package.json": JSON.stringify(
        { name: "platform-client" },
        null,
        2,
      ),
      "webapp/platform/client/tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            composite: true,
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
      "webapp/platform/client/src/client.ts": [
        "export function sendPostToServer(message: string) {",
        "  return { id: 'post-id', message };",
        "}",
        "",
      ].join("\n"),
    });

    const result = exploreCode(ts, {
      appPath: path.join(projectRoot, "webapp", "channels"),
      query: "send post server client",
      maxFiles: 4,
      maxDepth: 2,
    });

    expect(result.files.map((file) => file.path)).toContain("src/send_post.ts");
    expect(result.files.map((file) => file.path)).not.toContain(
      "platform/client/src/client.ts",
    );
  });
});

function createTempProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-code-explorer-"));
  tempDirs.push(dir);

  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  }

  return dir;
}
