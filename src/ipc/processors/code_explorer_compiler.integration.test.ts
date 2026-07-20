import { describe, expect, it, vi } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  resolveCodeExplorerCompiler,
  type CodeExplorerCompilerLoaders,
} from "../../../workers/code_explorer/code_explorer_worker";
import { toCodeExplorerError } from "./code_explorer";

describe("Code Explorer compiler error classification", () => {
  it("classifies an incompatible local compiler with a missing fallback as a precondition error", () => {
    const compilerLoaders: CodeExplorerCompilerLoaders = {
      resolveLocalPackage: vi.fn(
        () => "/app/node_modules/typescript/package.json",
      ),
      loadPackageVersion: vi.fn(() => "7.0.0"),
      loadLocal: vi.fn(() => ({ version: "7.0.0" })),
      loadBundled: vi.fn(() => {
        throw new Error("bundled package missing");
      }),
    };

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
});
