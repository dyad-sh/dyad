import type { TypeScriptCompilerPolicy } from "./typescript_compiler_policy";

export type SupabaseFunctionImpact =
  | { kind: "partial"; functionNames: string[] }
  | { kind: "all"; reason: string };

export interface SupabaseDependencyAnalysisInput {
  appPath: string;
  /** Set by the host from the runtime mode; never by the caller. */
  compilerPolicy: TypeScriptCompilerPolicy;
  changedSharedModulePaths: string[];
}

export type SupabaseDependencyAnalysisOutput =
  | { success: true; data: SupabaseFunctionImpact }
  | { success: false; error: string };
