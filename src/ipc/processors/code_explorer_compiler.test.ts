import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { TypeScriptModule } from "../../../workers/code_explorer/core/types";
import {
  getMissingCodeExplorerCompilerApis,
  resolveCodeExplorerCompiler,
  type CodeExplorerCompilerLoaders,
} from "../../../workers/code_explorer/code_explorer_worker";
import {
  getCodeExplorerAvailability,
  toCodeExplorerError,
} from "./code_explorer";

const compatibleCompiler = require("typescript") as TypeScriptModule;
const bundledCompiler = require("@typescript/typescript6") as TypeScriptModule;

function loaders(
  overrides: Partial<CodeExplorerCompilerLoaders> = {},
): CodeExplorerCompilerLoaders {
  return {
    resolveLocalPackage: vi.fn(
      () => "/app/node_modules/typescript/package.json",
    ),
    loadPackageVersion: vi.fn(() => "7.0.0"),
    loadLocal: vi.fn(() => compatibleCompiler),
    loadBundled: vi.fn(() => bundledCompiler),
    ...overrides,
  };
}

describe("resolveCodeExplorerCompiler", () => {
  it("uses a compatible app-local compiler", () => {
    const compilerLoaders = loaders();

    const result = resolveCodeExplorerCompiler("/app", compilerLoaders);

    expect(result).toEqual({
      module: compatibleCompiler,
      source: "local",
      version: compatibleCompiler.version,
    });
    expect(compilerLoaders.loadBundled).not.toHaveBeenCalled();
  });

  it("falls back for a TS7-like module without the legacy compiler API", () => {
    const compilerLoaders = loaders({
      loadLocal: vi.fn(() => ({ version: "7.0.0" })),
    });

    const result = resolveCodeExplorerCompiler("/app", compilerLoaders);

    expect(result.source).toBe("bundled-ts6");
    expect(result.module).toBe(bundledCompiler);
    expect(result.fallbackReason).toContain("missing compiler APIs");
  });

  it("falls back when the installed local module fails to load", () => {
    const compilerLoaders = loaders({
      loadLocal: vi.fn(() => {
        throw new Error("native module has no CommonJS API");
      }),
    });

    const result = resolveCodeExplorerCompiler("/app", compilerLoaders);

    expect(result.source).toBe("bundled-ts6");
    expect(result.fallbackReason).toContain("no CommonJS API");
  });

  it("falls back when the local compiler omits a consumed config API", () => {
    const compilerLoaders = loaders({
      loadLocal: vi.fn(() => ({
        ...compatibleCompiler,
        getConfigFileParsingDiagnostics: undefined,
      })),
    });

    const result = resolveCodeExplorerCompiler("/app", compilerLoaders);

    expect(result.source).toBe("bundled-ts6");
    expect(result.fallbackReason).toContain("getConfigFileParsingDiagnostics");
  });

  it("does not expose the fallback when TypeScript is not installed", () => {
    const compilerLoaders = loaders({
      resolveLocalPackage: vi.fn(() => {
        throw new Error("module not found");
      }),
    });

    expect(() => resolveCodeExplorerCompiler("/app", compilerLoaders)).toThrow(
      "it is not installed",
    );
    expect(compilerLoaders.loadLocal).not.toHaveBeenCalled();
    expect(compilerLoaders.loadBundled).not.toHaveBeenCalled();
  });

  it("reports both the local incompatibility and a missing fallback", () => {
    const compilerLoaders = loaders({
      loadLocal: vi.fn(() => ({ version: "7.0.0" })),
      loadBundled: vi.fn(() => {
        throw new Error("bundled package missing");
      }),
    });

    let resolutionError: unknown;
    try {
      resolveCodeExplorerCompiler("/app", compilerLoaders);
    } catch (error) {
      resolutionError = error;
    }

    expect(resolutionError).toBeInstanceOf(Error);
    expect((resolutionError as Error).message).toContain(
      "Failed to load TypeScript from /app: local TypeScript 7.0.0 is incompatible with Code Explorer",
    );
    expect((resolutionError as Error).message).toContain(
      "bundled package missing",
    );
    const classifiedError = toCodeExplorerError(resolutionError);
    expect(classifiedError).toBeInstanceOf(DyadError);
    expect((classifiedError as DyadError).kind).toBe(
      DyadErrorKind.Precondition,
    );
  });

  it("validates the full API surface consumed by Code Explorer", () => {
    expect(getMissingCodeExplorerCompilerApis(compatibleCompiler)).toEqual([]);
    expect(getMissingCodeExplorerCompilerApis({ version: "7.0.0" })).toEqual(
      expect.arrayContaining([
        "createProgram",
        "forEachChild",
        "SyntaxKind",
        "SymbolFlags",
        "sys",
      ]),
    );
  });
});

describe("getCodeExplorerAvailability", () => {
  it("treats a TS7-like package without a main compiler export as installed", async () => {
    const appPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-code-explorer-ts7-"),
    );
    try {
      const packagePath = path.join(appPath, "node_modules", "typescript");
      await fs.mkdir(packagePath, { recursive: true });
      await fs.writeFile(
        path.join(packagePath, "package.json"),
        JSON.stringify({
          name: "typescript",
          version: "7.0.0",
          exports: { "./package.json": "./package.json" },
        }),
      );
      await fs.writeFile(path.join(appPath, "tsconfig.json"), "{}");

      expect(getCodeExplorerAvailability(appPath)).toEqual({
        ready: true,
        reason: null,
        tsconfigPath: "tsconfig.json",
      });
    } finally {
      await fs.rm(appPath, { recursive: true, force: true });
    }
  });
});
