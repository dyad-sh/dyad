import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getProjectApiKeys } from "./supabase_management_client";
import {
  detectLegacyAppKey,
  switchAppToPublishableKey,
} from "./supabase_app_key";

vi.mock("./supabase_management_client", () => ({
  getProjectApiKeys: vi.fn(),
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}));

const getProjectApiKeysMock = vi.mocked(getProjectApiKeys);

const LEGACY_ANON = "eyJhbGciOiJIUzI1NiJ9.legacy-anon";
const PUBLISHABLE = "sb_publishable_abc123";

// A migrated project still lists the legacy pair alongside the new keys.
const PROJECT_API_KEYS = [
  { name: "anon", type: "legacy" as const, api_key: LEGACY_ANON },
  {
    name: "service_role",
    type: "legacy" as const,
    api_key: "eyJhbGciOiJIUzI1NiJ9.legacy-service-role",
  },
  { name: "default", type: "publishable" as const, api_key: PUBLISHABLE },
  { name: "default", type: "secret" as const, api_key: "sb_secret_xyz789" },
];

const appDirs: string[] = [];

function makeApp(key: string | null): string {
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-app-key-"));
  appDirs.push(appPath);
  if (key !== null) {
    const clientDir = path.join(appPath, "src", "integrations", "supabase");
    fs.mkdirSync(clientDir, { recursive: true });
    fs.writeFileSync(
      path.join(clientDir, "client.ts"),
      `import { createClient } from '@supabase/supabase-js';\n\nconst SUPABASE_URL = "https://proj-1.supabase.co";\nconst SUPABASE_PUBLISHABLE_KEY = "${key}";\n\nexport const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);\n`,
    );
  }
  return appPath;
}

function readClient(appPath: string): string {
  return fs.readFileSync(
    path.join(appPath, "src", "integrations", "supabase", "client.ts"),
    "utf8",
  );
}

const args = (appPath: string) => ({
  appPath,
  projectId: "proj-1",
  organizationSlug: "org-1",
});

beforeEach(() => {
  vi.clearAllMocks();
  getProjectApiKeysMock.mockResolvedValue(PROJECT_API_KEYS);
});

afterEach(() => {
  for (const dir of appDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("detectLegacyAppKey", () => {
  it("reports an app still on the project's legacy anon key", async () => {
    const appPath = makeApp(LEGACY_ANON);

    await expect(detectLegacyAppKey(args(appPath))).resolves.toMatchObject({
      legacyKey: LEGACY_ANON,
      publishableKey: PUBLISHABLE,
    });
  });

  it("stays quiet — and off the network — for an app already on a publishable key", async () => {
    await expect(
      detectLegacyAppKey(args(makeApp(PUBLISHABLE))),
    ).resolves.toBeUndefined();
    expect(getProjectApiKeysMock).not.toHaveBeenCalled();
  });

  it("stays quiet when the app has no generated client", async () => {
    await expect(
      detectLegacyAppKey(args(makeApp(null))),
    ).resolves.toBeUndefined();
  });

  // Classifying against the project's own key list, not the key's shape, keeps
  // a rotated or foreign key from being mislabelled as this project's legacy one.
  it("stays quiet for a key the project doesn't list", async () => {
    await expect(
      detectLegacyAppKey(args(makeApp("eyJhbGciOiJIUzI1NiJ9.some-other-key"))),
    ).resolves.toBeUndefined();
  });

  // Nothing to switch to, so a warning could only say "go make one".
  it("stays quiet when the project has no publishable key", async () => {
    getProjectApiKeysMock.mockResolvedValue([
      { name: "anon", type: "legacy", api_key: LEGACY_ANON },
    ]);

    await expect(
      detectLegacyAppKey(args(makeApp(LEGACY_ANON))),
    ).resolves.toBeUndefined();
  });

  it("stays quiet when the project's keys can't be fetched", async () => {
    getProjectApiKeysMock.mockRejectedValue(new Error("management API down"));

    await expect(
      detectLegacyAppKey(args(makeApp(LEGACY_ANON))),
    ).resolves.toBeUndefined();
  });
});

describe("switchAppToPublishableKey", () => {
  it("replaces only the key and leaves the rest of the file intact", async () => {
    const appPath = makeApp(LEGACY_ANON);
    const before = readClient(appPath);

    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(true);

    const after = readClient(appPath);
    expect(after).toContain(`"${PUBLISHABLE}"`);
    expect(after).not.toContain(LEGACY_ANON);
    // Everything except the key literal survives — the file may carry user edits.
    expect(after).toBe(before.replace(LEGACY_ANON, PUBLISHABLE));
  });

  it("preserves surrounding customizations", async () => {
    const appPath = makeApp(LEGACY_ANON);
    const clientPath = path.join(
      appPath,
      "src",
      "integrations",
      "supabase",
      "client.ts",
    );
    fs.writeFileSync(
      clientPath,
      `const SUPABASE_PUBLISHABLE_KEY = "${LEGACY_ANON}";\nexport const supabase = createClient(URL, SUPABASE_PUBLISHABLE_KEY, {\n  auth: { persistSession: false },\n});\n`,
    );

    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(true);

    const after = fs.readFileSync(clientPath, "utf8");
    expect(after).toContain("persistSession: false");
    expect(after).toContain(`"${PUBLISHABLE}"`);
  });

  it("is a no-op for an app already on a publishable key", async () => {
    const appPath = makeApp(PUBLISHABLE);
    const before = readClient(appPath);

    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(false);
    expect(readClient(appPath)).toBe(before);
  });

  it("is a no-op when there is no generated client to rewrite", async () => {
    await expect(switchAppToPublishableKey(args(makeApp(null)))).resolves.toBe(
      false,
    );
  });
});
