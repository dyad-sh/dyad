import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { shouldFilterTelemetryException } from "@/ipc/utils/telemetry";
import {
  BufferedProcessSpawnError,
  type BufferedProcessResult,
} from "@/ipc/utils/buffered_process";
import {
  clearTypeScriptVersionCacheForTests,
  parseTypeScriptDiagnostics,
  getTypeCheckPreconditionKind,
  runTypeScriptCheck,
  toProblemReportError,
  TypeCheckPreconditionError,
} from "./tsc";

const { runBufferedProcessMock } = vi.hoisted(() => ({
  runBufferedProcessMock: vi.fn(),
}));

vi.mock("@/ipc/utils/buffered_process", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/ipc/utils/buffered_process")>();
  return { ...actual, runBufferedProcess: runBufferedProcessMock };
});

vi.mock("@/paths/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/paths/paths")>();
  return {
    ...actual,
    getTypeScriptCachePath: vi.fn(() => "/tmp/dyad-tsc-test-cache"),
  };
});

function processResult(
  overrides: Partial<BufferedProcessResult> = {},
): BufferedProcessResult {
  return {
    code: 0,
    signal: null,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    aborted: false,
    timedOut: false,
    ...overrides,
  };
}

describe("toProblemReportError", () => {
  it("propagates structured type-check error kinds", () => {
    const error = toProblemReportError(
      new Error("Cannot find module 'typescript'"),
      "typescript-not-found",
    );

    expect(error).toBeInstanceOf(TypeCheckPreconditionError);
    expect((error as TypeCheckPreconditionError).kind).toBe(
      DyadErrorKind.Precondition,
    );
    expect(getTypeCheckPreconditionKind(error)).toBe("typescript-not-found");
    expect(shouldFilterTelemetryException(error)).toBe(true);
  });

  it("classifies missing TypeScript as a filtered precondition error", () => {
    const error = toProblemReportError(
      new Error(
        "Failed to load TypeScript from /app: package is not installed",
      ),
    );

    expect(error).toBeInstanceOf(DyadError);
    expect((error as DyadError).kind).toBe(DyadErrorKind.Precondition);
    expect(getTypeCheckPreconditionKind(error)).toBe("typescript-not-found");
    expect(shouldFilterTelemetryException(error)).toBe(true);
  });

  it("classifies missing tsconfig as a filtered precondition error", () => {
    const error = toProblemReportError(
      new Error(
        "No TypeScript configuration file found in /app. Expected one of: tsconfig.app.json, tsconfig.json",
      ),
    );

    expect(error).toBeInstanceOf(DyadError);
    expect((error as DyadError).kind).toBe(DyadErrorKind.Precondition);
    expect(getTypeCheckPreconditionKind(error)).toBe("tsconfig-not-found");
  });
});

describe("parseTypeScriptDiagnostics", () => {
  it("parses POSIX paths, CRLF output, and multiline messages", () => {
    const result = parseTypeScriptDiagnostics(
      "src/App.tsx(2,7): error TS2322: First line\r\n  More detail\r\nsrc/lib.ts(9,1): error TS2304: Missing name\r\n",
      "/app",
    );

    expect(result).toMatchObject([
      {
        file: "src/App.tsx",
        line: 2,
        column: 7,
        code: 2322,
        message: "First line\n  More detail",
      },
      {
        file: "src/lib.ts",
        line: 9,
        column: 1,
        code: 2304,
        message: "Missing name",
      },
    ]);
  });

  it("normalizes Windows paths independently of the host platform", () => {
    const [problem] = parseTypeScriptDiagnostics(
      String.raw`C:\app\src\main.ts(3,4): error TS7006: Parameter is implicit`,
      String.raw`C:\app`,
    );

    expect(problem.file).toBe("src/main.ts");
  });

  it("uses Windows path semantics for UNC-hosted projects", () => {
    const appPath = String.raw`\\server\share\app`;
    const configPath = String.raw`\\server\share\app\tsconfig.app.json`;
    const [relativeProblem] = parseTypeScriptDiagnostics(
      String.raw`src\main.ts(3,4): error TS7006: Parameter is implicit`,
      appPath,
      configPath,
    );
    const [absoluteProblem] = parseTypeScriptDiagnostics(
      String.raw`\\server\share\app\src\main.ts(3,4): error TS7006: Parameter is implicit`,
      appPath,
      configPath,
    );
    const [projectProblem] = parseTypeScriptDiagnostics(
      "error TS18003: No inputs were found",
      appPath,
      configPath,
    );

    expect(relativeProblem).toMatchObject({
      file: "src/main.ts",
      absoluteFilePath: String.raw`\\server\share\app\src\main.ts`,
    });
    expect(absoluteProblem).toMatchObject({
      file: "src/main.ts",
      absoluteFilePath: String.raw`\\server\share\app\src\main.ts`,
    });
    expect(projectProblem).toMatchObject({
      file: "tsconfig.app.json",
      absoluteFilePath: configPath,
    });
  });

  it("surfaces project-level diagnostics against the active config", () => {
    const [problem] = parseTypeScriptDiagnostics(
      "error TS18003: No inputs were found in config file '/app/tsconfig.app.json'.",
      "/app",
      "/app/tsconfig.app.json",
    );

    expect(problem).toMatchObject({
      file: "tsconfig.app.json",
      line: 1,
      column: 1,
      code: 18003,
      message: "No inputs were found in config file '/app/tsconfig.app.json'.",
    });
  });

  it("rejects otherwise unrecognized output", () => {
    expect(() =>
      parseTypeScriptDiagnostics("unexpected output", "/app"),
    ).toThrow("Unrecognized TypeScript diagnostic output");
  });

  it("ignores standard non-pretty diagnostic summaries", () => {
    const result = parseTypeScriptDiagnostics(
      "src/App.ts(1,7): error TS2322: Type mismatch\nFound 1 error in src/App.ts:1\n",
      "/app",
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      file: "src/App.ts",
      code: 2322,
      message: "Type mismatch",
    });
  });

  it("returns parsed diagnostics despite unknown supplemental output", () => {
    const result = parseTypeScriptDiagnostics(
      "compiler plugin banner\nsrc/App.ts(1,7): error TS2322: Type mismatch\nplugin footer\n  footer detail\n",
      "/app",
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      file: "src/App.ts",
      code: 2322,
      message: "Type mismatch",
    });
  });
});

describe("runTypeScriptCheck", () => {
  let appPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    clearTypeScriptVersionCacheForTests();
    // realpath: the resolver returns resolved paths, and macOS tmpdirs are
    // symlinks (/var -> /private/var).
    appPath = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "dyad-tsc-cli-")),
    );
    await fs.mkdir(path.join(appPath, "node_modules", "typescript", "lib"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(appPath, "node_modules", "typescript", "package.json"),
      JSON.stringify({ name: "typescript", version: "7.0.0" }),
    );
    await fs.writeFile(
      path.join(appPath, "node_modules", "typescript", "lib", "tsc.js"),
      "",
    );
    await fs.writeFile(path.join(appPath, "tsconfig.app.json"), "{}");
    await fs.mkdir(path.join(appPath, "src"));
    await fs.writeFile(
      path.join(appPath, "src", "App.ts"),
      "const before = 1;\nconst value: string = 1;\nconst after = 2;\n",
    );
  });

  afterEach(async () => {
    await fs.rm(appPath, { recursive: true, force: true });
  });

  function mockVersion(version = "7.0.0") {
    runBufferedProcessMock.mockResolvedValueOnce(
      processResult({ stdout: `Version ${version}\n` }),
    );
  }

  it("runs the local CLI entry as Node with fixed arguments and parses diagnostics", async () => {
    mockVersion();
    runBufferedProcessMock.mockResolvedValueOnce(
      processResult({
        code: 2,
        stdout:
          "src/App.ts(2,7): error TS2322: Type 'number' is not assignable to type 'string'.\n",
      }),
    );

    await expect(runTypeScriptCheck({ appPath })).resolves.toEqual({
      problems: [
        {
          file: "src/App.ts",
          line: 2,
          column: 7,
          code: 2322,
          message: "Type 'number' is not assignable to type 'string'.",
          snippet:
            "const before = 1;\nconst value: string = 1; // <-- TypeScript compiler error here\nconst after = 2;",
        },
      ],
    });

    expect(runBufferedProcessMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        command: process.execPath,
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: "1" }),
        args: expect.arrayContaining([
          path.join(appPath, "node_modules", "typescript", "lib", "tsc.js"),
          "--pretty",
          "false",
          "--diagnostics",
          "false",
          "--extendedDiagnostics",
          "false",
          "--listFiles",
          "false",
          "--listEmittedFiles",
          "false",
          "--explainFiles",
          "false",
          "--traceResolution",
          "false",
          "--noEmit",
          "--incremental",
          "--project",
          path.join(appPath, "tsconfig.app.json"),
        ]),
        cwd: appPath,
        shell: false,
        waitForCloseAfterForceKill: true,
      }),
    );
    const args = runBufferedProcessMock.mock.calls[1][0].args as string[];
    expect(args[0]).toBe(
      path.join(appPath, "node_modules", "typescript", "lib", "tsc.js"),
    );
    expect(args[args.indexOf("--tsBuildInfoFile") + 1]).toMatch(
      /^\/tmp\/dyad-tsc-test-cache\/[a-f0-9]{64}\.tsbuildinfo$/,
    );
  });

  it("resolves a TypeScript install hoisted to an ancestor node_modules", async () => {
    const workspaceRoot = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "dyad-tsc-hoist-")),
    );
    try {
      const packagePath = path.join(workspaceRoot, "packages", "web");
      await fs.mkdir(packagePath, { recursive: true });
      await fs.mkdir(
        path.join(workspaceRoot, "node_modules", "typescript", "lib"),
        { recursive: true },
      );
      await fs.writeFile(
        path.join(workspaceRoot, "node_modules", "typescript", "package.json"),
        JSON.stringify({ name: "typescript", version: "7.0.0" }),
      );
      await fs.writeFile(
        path.join(workspaceRoot, "node_modules", "typescript", "lib", "tsc.js"),
        "",
      );
      await fs.writeFile(path.join(packagePath, "tsconfig.json"), "{}");

      mockVersion();
      runBufferedProcessMock.mockResolvedValueOnce(processResult());

      await expect(
        runTypeScriptCheck({ appPath: packagePath }),
      ).resolves.toEqual({ problems: [] });
      const args = runBufferedProcessMock.mock.calls[1][0].args as string[];
      expect(args[0]).toBe(
        path.join(workspaceRoot, "node_modules", "typescript", "lib", "tsc.js"),
      );
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("returns an empty report on a successful compiler exit", async () => {
    mockVersion("6.0.1");
    runBufferedProcessMock.mockResolvedValueOnce(processResult());

    await expect(runTypeScriptCheck({ appPath })).resolves.toEqual({
      problems: [],
    });
  });

  it("returns project-level diagnostics instead of failing the check", async () => {
    mockVersion();
    runBufferedProcessMock.mockResolvedValueOnce(
      processResult({
        code: 2,
        stdout:
          "error TS18003: No inputs were found in config file 'tsconfig.app.json'.\n",
      }),
    );

    await expect(runTypeScriptCheck({ appPath })).resolves.toMatchObject({
      problems: [
        {
          file: "tsconfig.app.json",
          line: 1,
          column: 1,
          code: 18003,
          message: "No inputs were found in config file 'tsconfig.app.json'.",
        },
      ],
    });
  });

  it("fails rather than returning partial diagnostics after truncation", async () => {
    mockVersion();
    runBufferedProcessMock.mockResolvedValueOnce(
      processResult({ code: 2, stdoutTruncated: true }),
    );

    await expect(runTypeScriptCheck({ appPath })).rejects.toThrow(
      "diagnostic output exceeded",
    );
  });

  it("reports a missing local CLI entry as an install precondition", async () => {
    await fs.rm(
      path.join(appPath, "node_modules", "typescript", "lib", "tsc.js"),
    );

    await expect(runTypeScriptCheck({ appPath })).rejects.toMatchObject({
      typeCheckKind: "typescript-not-found",
    });
    expect(runBufferedProcessMock).not.toHaveBeenCalled();
  });

  it("reports a spawn failure as an install precondition", async () => {
    runBufferedProcessMock.mockRejectedValueOnce(
      new BufferedProcessSpawnError("spawn ENOENT", "", ""),
    );

    await expect(runTypeScriptCheck({ appPath })).rejects.toMatchObject({
      typeCheckKind: "typescript-not-found",
      kind: DyadErrorKind.Precondition,
    });
  });

  it("prefers tsconfig.app.json and reports missing configs", async () => {
    await fs.rm(path.join(appPath, "tsconfig.app.json"));

    await expect(runTypeScriptCheck({ appPath })).rejects.toMatchObject({
      typeCheckKind: "tsconfig-not-found",
    });
    expect(runBufferedProcessMock).not.toHaveBeenCalled();
  });
});
