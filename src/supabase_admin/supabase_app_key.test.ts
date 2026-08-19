import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getProjectApiKeys } from "./supabase_management_client";
import { gitAdd, gitCommit, isGitPathClean } from "@/ipc/utils/git_utils";
import {
  detectLegacyAppKey,
  switchAppToPublishableKey,
} from "./supabase_app_key";

vi.mock("./supabase_management_client", () => ({
  getProjectApiKeys: vi.fn(),
}));
vi.mock("@/ipc/utils/git_utils", () => ({
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  isGitPathClean: vi.fn(),
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}));

const getProjectApiKeysMock = vi.mocked(getProjectApiKeys);
const gitAddMock = vi.mocked(gitAdd);
const gitCommitMock = vi.mocked(gitCommit);
const isGitPathCleanMock = vi.mocked(isGitPathClean);

/**
 * A real-shaped legacy key: three base64url segments carrying the `role` and
 * `ref` claims Supabase issues. The unlisted-key fallback reads those claims,
 * so a stand-in without them wouldn't exercise it.
 */
function legacyJwt(claims: Record<string, string>): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

const LEGACY_ANON = legacyJwt({ role: "anon", ref: "proj-1" });
const LEGACY_SERVICE_ROLE = legacyJwt({ role: "service_role", ref: "proj-1" });
const OTHER_PROJECT_ANON = legacyJwt({ role: "anon", ref: "proj-2" });
const PUBLISHABLE = "sb_publishable_abc123";

// A migrated project still lists the legacy pair alongside the new keys.
const PROJECT_API_KEYS = [
  { name: "anon", type: "legacy" as const, api_key: LEGACY_ANON },
  {
    name: "service_role",
    type: "legacy" as const,
    api_key: LEGACY_SERVICE_ROLE,
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

function clientPathFor(appPath: string): string {
  return path.join(appPath, "src", "integrations", "supabase", "client.ts");
}

function readClient(appPath: string): string {
  return fs.readFileSync(clientPathFor(appPath), "utf8");
}

const args = (appPath: string) => ({
  appPath,
  projectId: "proj-1",
  organizationSlug: "org-1",
});

beforeEach(() => {
  vi.clearAllMocks();
  getProjectApiKeysMock.mockResolvedValue(PROJECT_API_KEYS);
  gitAddMock.mockResolvedValue(undefined);
  gitCommitMock.mockResolvedValue("commit-hash");
  // The common case: the user wasn't editing client.ts, so the rewrite is
  // Dyad's alone to commit.
  isGitPathCleanMock.mockResolvedValue(true);
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

  // A mention of the constant in prose is not the key the app authenticates
  // with; treating it as one would rewrite the comment and leave the live
  // legacy key in place.
  it("ignores the constant when it appears in a comment", async () => {
    const appPath = makeApp(PUBLISHABLE);
    const clientPath = clientPathFor(appPath);
    fs.writeFileSync(
      clientPath,
      `// Was: const SUPABASE_PUBLISHABLE_KEY = "${LEGACY_ANON}";\nconst SUPABASE_PUBLISHABLE_KEY = "${PUBLISHABLE}";\n`,
    );

    await expect(detectLegacyAppKey(args(appPath))).resolves.toBeUndefined();
    expect(getProjectApiKeysMock).not.toHaveBeenCalled();
  });

  // A block-commented example starts at a line boundary just like the real
  // declaration, so the line anchor alone can't tell them apart.
  it("reads past a block-commented example to the live declaration", async () => {
    const appPath = makeApp(LEGACY_ANON);
    fs.writeFileSync(
      clientPathFor(appPath),
      `/*\nconst SUPABASE_PUBLISHABLE_KEY = "sb_publishable_example";\n*/\nconst SUPABASE_PUBLISHABLE_KEY = "${LEGACY_ANON}";\n`,
    );

    // Without masking, the commented sb_publishable_ line would match first and
    // detection would report the app as already migrated.
    await expect(detectLegacyAppKey(args(appPath))).resolves.toMatchObject({
      legacyKey: LEGACY_ANON,
    });
  });

  it("does not mistake a URL inside a string for a comment", async () => {
    const appPath = makeApp(LEGACY_ANON);
    fs.writeFileSync(
      clientPathFor(appPath),
      `const SUPABASE_URL = "https://proj-1.supabase.co";\nconst SUPABASE_PUBLISHABLE_KEY = "${LEGACY_ANON}";\n`,
    );

    await expect(detectLegacyAppKey(args(appPath))).resolves.toMatchObject({
      legacyKey: LEGACY_ANON,
    });
  });

  it("finds a declaration whose value Prettier wrapped onto the next line", async () => {
    const appPath = makeApp(LEGACY_ANON);
    fs.writeFileSync(
      clientPathFor(appPath),
      `const SUPABASE_PUBLISHABLE_KEY =\n  "${LEGACY_ANON}";\n`,
    );

    await expect(detectLegacyAppKey(args(appPath))).resolves.toMatchObject({
      legacyKey: LEGACY_ANON,
    });
  });
});

describe("switchAppToPublishableKey", () => {
  it("replaces only the key and leaves the rest of the file intact", async () => {
    const appPath = makeApp(LEGACY_ANON);
    const before = readClient(appPath);

    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(
      "switched",
    );

    const after = readClient(appPath);
    expect(after).toContain(`"${PUBLISHABLE}"`);
    expect(after).not.toContain(LEGACY_ANON);
    // Everything except the key literal survives — the file may carry user edits.
    expect(after).toBe(before.replace(LEGACY_ANON, PUBLISHABLE));
  });

  it("preserves surrounding customizations", async () => {
    const appPath = makeApp(LEGACY_ANON);
    const clientPath = clientPathFor(appPath);
    fs.writeFileSync(
      clientPath,
      `const SUPABASE_PUBLISHABLE_KEY = "${LEGACY_ANON}";\nexport const supabase = createClient(URL, SUPABASE_PUBLISHABLE_KEY, {\n  auth: { persistSession: false },\n});\n`,
    );

    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(
      "switched",
    );

    const after = fs.readFileSync(clientPath, "utf8");
    expect(after).toContain("persistSession: false");
    expect(after).toContain(`"${PUBLISHABLE}"`);
  });

  // Dyad's own one-line edit shouldn't land the user in the "uncommitted
  // changes" banner over a change they didn't make.
  it("commits the rewritten client, scoped to that file alone", async () => {
    const appPath = makeApp(LEGACY_ANON);
    const relativePath = path.join(
      "src",
      "integrations",
      "supabase",
      "client.ts",
    );

    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(
      "switched",
    );

    expect(gitAddMock).toHaveBeenCalledWith({
      path: appPath,
      filepath: relativePath,
    });
    // A pathspec, so a user editing elsewhere in the app keeps their other
    // changes (and their staged index) out of this commit.
    expect(gitCommitMock).toHaveBeenCalledWith({
      path: appPath,
      message: "switch Supabase client to publishable API key",
      noVerify: true,
      paths: [relativePath],
    });
  });

  // The key is already switched by the time the commit runs, so a repo-less app
  // must still be reported as migrated.
  it("still reports success when the app has no git repo to commit to", async () => {
    const appPath = makeApp(LEGACY_ANON);
    gitCommitMock.mockRejectedValue(new Error("not a git repository"));

    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(
      "switched",
    );
    expect(readClient(appPath)).toContain(`"${PUBLISHABLE}"`);
  });

  it("does not commit when there was nothing to switch", async () => {
    await expect(
      switchAppToPublishableKey(args(makeApp(PUBLISHABLE))),
    ).resolves.toBe("already-current");

    expect(gitCommitMock).not.toHaveBeenCalled();
  });

  it("is a no-op for an app already on a publishable key", async () => {
    const appPath = makeApp(PUBLISHABLE);
    const before = readClient(appPath);

    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(
      "already-current",
    );
    expect(readClient(appPath)).toBe(before);
  });

  // "Nothing to switch" is NOT "already up to date": there is no key here at
  // all, and telling the user their key is current would be a plain falsehood.
  it("reports not-applicable when there is no generated client to rewrite", async () => {
    await expect(switchAppToPublishableKey(args(makeApp(null)))).resolves.toBe(
      "not-applicable",
    );
  });

  // Detection swallowing errors is right — the offer just doesn't appear. An
  // explicit switch swallowing them is not: "already up to date" would leave
  // the legacy key baked in with no retry affordance.
  it("propagates a failed re-check instead of reporting a no-op", async () => {
    getProjectApiKeysMock.mockRejectedValue(new Error("management API down"));

    await expect(
      switchAppToPublishableKey(args(makeApp(LEGACY_ANON))),
    ).rejects.toThrow(/management API down/);
  });

  it("rewrites a declaration whose value Prettier wrapped onto the next line", async () => {
    const appPath = makeApp(LEGACY_ANON);
    const clientPath = clientPathFor(appPath);
    fs.writeFileSync(
      clientPath,
      `const SUPABASE_PUBLISHABLE_KEY =\n  "${LEGACY_ANON}";\n`,
    );

    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(
      "switched",
    );

    // The line break and indentation are part of the declaration, not the key.
    expect(fs.readFileSync(clientPath, "utf8")).toBe(
      `const SUPABASE_PUBLISHABLE_KEY =\n  "${PUBLISHABLE}";\n`,
    );
  });

  // Rewriting the comment instead would leave the live key legacy AND silence
  // future warnings, since the rewritten comment would then match first.
  it("rewrites the live declaration, not a block-commented example above it", async () => {
    const appPath = makeApp(LEGACY_ANON);
    const clientPath = clientPathFor(appPath);
    fs.writeFileSync(
      clientPath,
      `/*\nconst SUPABASE_PUBLISHABLE_KEY = "${LEGACY_ANON}";\n*/\nconst SUPABASE_PUBLISHABLE_KEY = "${LEGACY_ANON}";\n`,
    );

    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(
      "switched",
    );

    expect(fs.readFileSync(clientPath, "utf8")).toBe(
      `/*\nconst SUPABASE_PUBLISHABLE_KEY = "${LEGACY_ANON}";\n*/\nconst SUPABASE_PUBLISHABLE_KEY = "${PUBLISHABLE}";\n`,
    );
  });

  it("leaves a client.ts that symlinks outside the app alone", async () => {
    const appPath = makeApp(LEGACY_ANON);
    // An imported app can carry a symlinked client.ts; following it would land
    // the rewrite on a file outside the app directory.
    const outside = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "dyad-outside-")),
      "client.ts",
    );
    appDirs.push(path.dirname(outside));
    const original = `const SUPABASE_PUBLISHABLE_KEY = "${LEGACY_ANON}";\n`;
    fs.writeFileSync(outside, original);
    const clientPath = clientPathFor(appPath);
    fs.rmSync(clientPath);
    fs.symlinkSync(outside, clientPath);

    // Detection and the switch agree: no offer is made, and nothing is written.
    await expect(detectLegacyAppKey(args(appPath))).resolves.toBeUndefined();
    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(
      "not-applicable",
    );
    expect(fs.readFileSync(outside, "utf8")).toBe(original);
  });

  // `git commit -- <path>` records the whole working-tree version of that path,
  // not the hunk Dyad changed, so committing a file the user was mid-edit in
  // would fold their work into a commit labelled as a key swap.
  it("leaves the rewrite uncommitted when client.ts already had user edits", async () => {
    const appPath = makeApp(LEGACY_ANON);
    isGitPathCleanMock.mockResolvedValue(false);

    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(
      "switched",
    );

    // The key still switches — the user's app has to keep working.
    expect(readClient(appPath)).toContain(`"${PUBLISHABLE}"`);
    expect(gitCommitMock).not.toHaveBeenCalled();
    expect(gitAddMock).not.toHaveBeenCalled();
  });

  // "Can't tell" has to mean "don't commit": an app that isn't a git repo at
  // all makes the status check throw, and guessing clean would be a guess about
  // the user's uncommitted work.
  it("does not commit when the file's git status can't be determined", async () => {
    const appPath = makeApp(LEGACY_ANON);
    isGitPathCleanMock.mockRejectedValue(new Error("not a git repository"));

    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(
      "switched",
    );

    expect(readClient(appPath)).toContain(`"${PUBLISHABLE}"`);
    expect(gitCommitMock).not.toHaveBeenCalled();
  });

  // Disabling is only half of Supabase's migration; the end state is deletion.
  // Going quiet then would drop the offer exactly when the app is fully broken.
  it("still offers the switch for a legacy key the project no longer lists", async () => {
    const appPath = makeApp(LEGACY_ANON);
    getProjectApiKeysMock.mockResolvedValue([
      { name: "default", type: "publishable" as const, api_key: PUBLISHABLE },
    ]);

    await expect(detectLegacyAppKey(args(appPath))).resolves.toMatchObject({
      legacyKey: LEGACY_ANON,
      publishableKey: PUBLISHABLE,
    });
    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(
      "switched",
    );
  });

  // The switch OVERWRITES whatever the fallback matches, so shape alone is far
  // too loose: each of these is a three-segment JWT that must be left alone.
  it.each([
    ["a value that isn't a JWT at all", "not-a-real-key"],
    ["a service_role key, which must not be downgraded", LEGACY_SERVICE_ROLE],
    ["another project's anon key", OTHER_PROJECT_ANON],
    ["a JWT with no role/ref claims", legacyJwt({ sub: "whoever" })],
  ])("leaves an unlisted key alone: %s", async (_label, key) => {
    const appPath = makeApp(key);
    getProjectApiKeysMock.mockResolvedValue([
      { name: "default", type: "publishable" as const, api_key: PUBLISHABLE },
    ]);

    await expect(detectLegacyAppKey(args(appPath))).resolves.toBeUndefined();
    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(
      "not-applicable",
    );
    expect(readClient(appPath)).toContain(key);
  });

  // Comment masking alone isn't enough: a multiline template literal carries
  // real line breaks, so `^` anchors inside it just as it does in code.
  it("rewrites the live declaration, not one inside a multiline template", async () => {
    const appPath = makeApp(LEGACY_ANON);
    const clientPath = clientPathFor(appPath);
    const docs = `const DOCS = \`\nconst SUPABASE_PUBLISHABLE_KEY = "${LEGACY_ANON}";\n\`;\n`;
    fs.writeFileSync(
      clientPath,
      `${docs}const SUPABASE_PUBLISHABLE_KEY = "${LEGACY_ANON}";\n`,
    );

    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(
      "switched",
    );

    expect(fs.readFileSync(clientPath, "utf8")).toBe(
      `${docs}const SUPABASE_PUBLISHABLE_KEY = "${PUBLISHABLE}";\n`,
    );
  });

  // A single-line backtick literal IS a legitimate way to write the key, so
  // masking must not reach it.
  it("still rewrites a key declared with a single-line template literal", async () => {
    const appPath = makeApp(LEGACY_ANON);
    const clientPath = clientPathFor(appPath);
    fs.writeFileSync(
      clientPath,
      `const SUPABASE_PUBLISHABLE_KEY = \`${LEGACY_ANON}\`;\n`,
    );

    await expect(switchAppToPublishableKey(args(appPath))).resolves.toBe(
      "switched",
    );

    expect(fs.readFileSync(clientPath, "utf8")).toBe(
      `const SUPABASE_PUBLISHABLE_KEY = \`${PUBLISHABLE}\`;\n`,
    );
  });
});
