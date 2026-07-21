import * as fs from "node:fs";
import {
  getTypeScriptCompilerPath,
  resolveTypeScriptPackageJsonPathSync,
} from "../../shared/node_module_resolution";
import type {
  SupabaseDependencyAnalysisInput,
  SupabaseDependencyAnalysisOutput,
} from "../../shared/supabase_dependency_analysis_types";
import { analyzeSupabaseDependencies } from "./analyze";

const REQUIRED_APIS = [
  "createSourceFile",
  "forEachChild",
  "isCallExpression",
  "isExportDeclaration",
  "isExternalModuleReference",
  "isIdentifier",
  "isImportDeclaration",
  "isImportEqualsDeclaration",
  "isStringLiteralLike",
] as const;

function isCompatible(
  candidate: unknown,
): candidate is typeof import("typescript") {
  if (typeof candidate !== "object" || candidate === null) return false;
  const compiler = candidate as Record<string, unknown>;
  return (
    REQUIRED_APIS.every((name) => typeof compiler[name] === "function") &&
    typeof compiler.ScriptKind === "object" &&
    typeof compiler.ScriptTarget === "object" &&
    typeof compiler.SyntaxKind === "object"
  );
}

function loadCompiler(appPath: string): typeof import("typescript") | null {
  let packageJsonPath: string;
  try {
    packageJsonPath = resolveTypeScriptPackageJsonPathSync(appPath);
  } catch {
    return null;
  }
  try {
    const local = require(
      fs.realpathSync(getTypeScriptCompilerPath(packageJsonPath)),
    ) as unknown;
    if (isCompatible(local)) return local;
  } catch {
    // TS7 does not expose the legacy JavaScript compiler API.
  }
  const bundled = require("@typescript/typescript6") as unknown;
  if (!isCompatible(bundled)) {
    throw new Error("Bundled TypeScript compiler API is unavailable");
  }
  return bundled;
}

export async function processSupabaseDependencyAnalysis(
  input: SupabaseDependencyAnalysisInput,
): Promise<SupabaseDependencyAnalysisOutput> {
  try {
    const compiler = loadCompiler(input.appPath);
    if (!compiler) {
      return {
        success: true,
        data: { kind: "all", reason: "typescript_not_installed" },
      };
    }
    return {
      success: true,
      data: await analyzeSupabaseDependencies(
        compiler,
        input.appPath,
        input.changedSharedModulePaths,
      ),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

interface UtilityProcessParentPort {
  on(
    event: "message",
    listener: (event: { data: SupabaseDependencyAnalysisInput }) => void,
  ): void;
  postMessage(message: SupabaseDependencyAnalysisOutput): void;
}

const parentPort = (
  process as unknown as { parentPort?: UtilityProcessParentPort }
).parentPort;

if (parentPort) {
  parentPort.on("message", async (event) => {
    parentPort.postMessage(await processSupabaseDependencyAnalysis(event.data));
  });
}
