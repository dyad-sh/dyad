// @vitest-environment node
//
// Migrated from e2e-tests/context_manage.spec.ts.
//
// The e2e drove the Context Files picker UI; the persisted result of that UI is
// the app's chatContext (manual context paths, Smart Context auto-includes and
// exclude paths), written through the real `set-context-paths` handler. These
// tests set the chatContext the same way and assert the resulting LLM request
// payload: which files are included (inline <dyad-file> blocks without Dyad
// Pro; dyad_options.files / versioned_files with the Pro engine), which are
// force-included, and the smart-context flags.
//
// Dialog-only interactions (adding/removing rows, visible path chips, picker
// copy text) are dropped as UI-only.
//
// NOTE: DYAD_ENGINE_URL must exist before get_model_client.ts is imported, so
// this file starts its own fake-LLM server first and imports the harness
// dynamically (the harness's own server cannot be used — its port is only
// known after the app modules are already imported).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import type { ChatFlowHarness } from "@/testing/chat_flow_harness";
import type { FakeLlmServerHandle } from "../../../../testing/fake-llm-server/index";
import type { AppChatContext, UserSettings } from "@/lib/schemas";

type DumpFileReference = { path: string; force?: boolean };

const FULL_CODEBASE_PATHS = [
  ".env.foobar",
  "AI_RULES.md",
  "a.ts",
  "exclude/exclude.ts",
  "exclude/exclude.tsx",
  "manual/baz.json",
  "manual/file.ts",
  "manual/sub-manual/sub-manual.js",
  "src/components/ui/button.tsx",
  "src/components/ui/helper.ts",
  "src/dir/some.css",
  "src/foo.ts",
  "src/sub/sub1.ts",
  "src/sub/sub2.tsx",
  "src/very-large-file.ts",
];

const MANUAL_SRC_CONTEXT_PATHS = [
  "src/components/ui/helper.ts",
  "src/foo.ts",
  "src/sub/sub1.ts",
  "src/sub/sub2.tsx",
  "src/very-large-file.ts",
];

const MANUAL_AND_SMART_CONTEXT_PATHS = [
  "a.ts",
  "manual/baz.json",
  "manual/file.ts",
  "manual/sub-manual/sub-manual.js",
  ...MANUAL_SRC_CONTEXT_PATHS,
];

const FORCED_AUTO_INCLUDE_PATHS = [
  "a.ts",
  "manual/baz.json",
  "manual/file.ts",
  "manual/sub-manual/sub-manual.js",
];

const FORCED_SMART_EXCLUDE_PATHS = ["a.ts", "exclude/exclude.tsx"];

describe("manage context (integration)", () => {
  let harness: ChatFlowHarness;
  let engine: FakeLlmServerHandle;
  let writeSettings: (settings: Partial<UserSettings>) => void;

  const globs = (paths: string[]) => paths.map((globPath) => ({ globPath }));

  // The e2e pins "build" chat mode after Pro setup (Pro would otherwise
  // default a fresh chat to the agent mode); mirror that per turn.
  const dump = () =>
    harness.streamChat("[dump]", { requestedChatMode: "build" });

  const setChatContext = async (chatContext: AppChatContext) => {
    const handler = h.ipcHandlers.get("set-context-paths")!;
    await handler(
      { sender: { isDestroyed: () => false, send: () => {} } },
      { appId: harness.appId, chatContext },
    );
  };

  // Mirrors the e2e spec's getIncludedFiles/readDump helpers: prefer the
  // engine's dyad_options file lists, fall back to scanning message contents
  // for inline <dyad-file> blocks (non-Pro flow).
  const getIncludedFiles = (): DumpFileReference[] => {
    const dump = harness.getServerDump({ type: "request" });
    const body = dump.parsed.body as {
      messages?: Array<{ role: string; content: unknown }>;
      input?: Array<{ role: string; content: unknown }>;
      dyad_options?: {
        enable_smart_files_context?: boolean;
        smart_context_mode?: string;
        files?: DumpFileReference[];
        versioned_files?: { fileReferences?: DumpFileReference[] };
      };
    };
    const versioned = body.dyad_options?.versioned_files?.fileReferences;
    if (versioned?.length) {
      return versioned;
    }
    if (body.dyad_options?.files?.length) {
      return body.dyad_options.files;
    }
    const messages = body.input ?? body.messages ?? [];
    const text = messages
      .map(({ content }) =>
        typeof content === "string"
          ? content
          : (content as Array<{ text?: string }>)
              .map((part) => part.text ?? "")
              .join("\n"),
      )
      .join("\n");
    const paths = [...text.matchAll(/<dyad-file path="([^"]+)">/g)].map(
      (m) => m[1],
    );
    return [...new Set(paths)].map((path) => ({ path, force: false }));
  };

  const getDyadOptions = () => {
    const dump = harness.getServerDump({ type: "request" });
    return (dump.parsed.body as Record<string, any>).dyad_options as
      | {
          enable_smart_files_context?: boolean;
          smart_context_mode?: string;
        }
      | undefined;
  };

  const getIncludedPaths = () =>
    getIncludedFiles()
      .map(({ path }) => path)
      .sort();

  const getForcedPaths = () =>
    getIncludedFiles()
      .filter(({ force }) => force)
      .map(({ path }) => path)
      .sort();

  beforeAll(async () => {
    // Start the engine-facing fake server and expose it via DYAD_ENGINE_URL
    // BEFORE any app module is imported (get_model_client reads the env var at
    // module load).
    const { startFakeLlmServer } =
      await import("../../../../testing/fake-llm-server/index");
    engine = await startFakeLlmServer();
    process.env.DYAD_ENGINE_URL = `${engine.url}/engine/v1`;

    const harnessModule = await import("@/testing/chat_flow_harness");
    harness = await harnessModule.setupChatFlowHarness({
      electronMock: h,
      fixtureApp: "context-manage",
    });

    const contextPathsModule =
      await import("@/ipc/handlers/context_paths_handlers");
    contextPathsModule.registerContextPathsHandlers();

    const settingsModule = await import("@/main/settings");
    writeSettings = settingsModule.writeSettings;
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    await engine?.close();
  });

  it("default: manual context paths limit the inlined codebase", async () => {
    await setChatContext({
      contextPaths: globs(["src/**/*.ts", "src/sub/**"]),
      smartContextAutoIncludes: [],
    });

    await dump();

    expect(getIncludedPaths()).toEqual([...MANUAL_SRC_CONTEXT_PATHS].sort());
    expect(getDyadOptions()).toBeUndefined();
  }, 30_000);

  it("smart context: auto-includes are forced, disabling falls back", async () => {
    writeSettings({
      enableDyadPro: true,
      providerSettings: {
        auto: { apiKey: { value: "testdyadkey", encryptionType: "plaintext" } },
      },
    });
    await setChatContext({
      contextPaths: globs(["src/**/*.ts", "src/sub/**"]),
      smartContextAutoIncludes: globs(["a.ts", "manual/**"]),
    });

    await dump();
    expect(getDyadOptions()?.enable_smart_files_context).toBe(true);
    expect(getDyadOptions()?.smart_context_mode).toBe("deep");
    expect(getIncludedPaths()).toEqual(
      [...MANUAL_AND_SMART_CONTEXT_PATHS].sort(),
    );
    expect(getForcedPaths()).toEqual([...FORCED_AUTO_INCLUDE_PATHS].sort());

    // Turning Smart Context off disables the auto-includes too.
    writeSettings({ enableProSmartFilesContextMode: false });
    await dump();
    expect(getDyadOptions()?.enable_smart_files_context).toBe(false);
    expect(getDyadOptions()?.smart_context_mode).toBe("balanced");
    expect(getIncludedPaths()).toEqual([...MANUAL_SRC_CONTEXT_PATHS].sort());

    // Removing the manual context paths includes the whole codebase.
    await setChatContext({ contextPaths: [], smartContextAutoIncludes: [] });
    await dump();
    expect(getDyadOptions()?.enable_smart_files_context).toBe(false);
    expect(getIncludedPaths()).toEqual([...FULL_CODEBASE_PATHS].sort());

    writeSettings({ enableProSmartFilesContextMode: true });
  }, 45_000);

  it("smart context: auto-includes only", async () => {
    await setChatContext({
      contextPaths: [],
      smartContextAutoIncludes: globs(["a.ts", "manual/**"]),
    });

    await dump();

    expect(getDyadOptions()?.enable_smart_files_context).toBe(true);
    expect(getDyadOptions()?.smart_context_mode).toBe("deep");
    expect(getForcedPaths()).toEqual([...FORCED_AUTO_INCLUDE_PATHS].sort());
  }, 30_000);

  it("exclude paths take precedence over include paths", async () => {
    writeSettings({ enableDyadPro: false });

    await setChatContext({
      contextPaths: globs(["src/**/*.ts", "manual/**"]),
      smartContextAutoIncludes: [],
      excludePaths: globs(["src/components/**", "manual/exclude/**"]),
    });
    await dump();
    expect(getIncludedPaths()).toEqual([
      "manual/baz.json",
      "manual/file.ts",
      "manual/sub-manual/sub-manual.js",
      "src/foo.ts",
      "src/sub/sub1.ts",
      "src/very-large-file.ts",
    ]);

    // A broader exclude removes everything under src.
    await setChatContext({
      contextPaths: globs(["src/**/*.ts", "manual/**"]),
      smartContextAutoIncludes: [],
      excludePaths: globs(["manual/exclude/**", "src/**"]),
    });
    await dump();
    expect(getIncludedPaths()).toEqual([
      "manual/baz.json",
      "manual/file.ts",
      "manual/sub-manual/sub-manual.js",
    ]);
  }, 45_000);

  it("exclude paths with smart context", async () => {
    writeSettings({ enableDyadPro: true });

    await setChatContext({
      contextPaths: globs(["src/**/*.ts", "manual/**"]),
      smartContextAutoIncludes: globs(["a.ts", "exclude/**"]),
      excludePaths: globs(["src/components/**", "exclude/exclude.ts"]),
    });
    await dump();

    expect(getDyadOptions()?.enable_smart_files_context).toBe(true);
    const includedPaths = getIncludedPaths();
    expect(includedPaths).toEqual(
      expect.arrayContaining([
        "a.ts",
        "exclude/exclude.tsx",
        "manual/baz.json",
        "manual/file.ts",
        "manual/sub-manual/sub-manual.js",
        "src/foo.ts",
        "src/sub/sub1.ts",
        "src/very-large-file.ts",
      ]),
    );
    expect(getForcedPaths()).toEqual(
      expect.arrayContaining(FORCED_SMART_EXCLUDE_PATHS),
    );
    expect(includedPaths).not.toContain("exclude/exclude.ts");
    expect(includedPaths).not.toContain("src/components/ui/helper.ts");
  }, 30_000);
});
