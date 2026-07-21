export type SupabaseFunctionImpact =
  | { kind: "partial"; functionNames: string[] }
  | { kind: "all"; reason: string };

export interface SupabaseDependencyAnalysisInput {
  appPath: string;
  changedSharedModulePaths: string[];
}

export type SupabaseDependencyAnalysisOutput =
  | { success: true; data: SupabaseFunctionImpact }
  | { success: false; error: string };
