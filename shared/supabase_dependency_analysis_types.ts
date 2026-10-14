export type SupabaseFallbackReasonCode =
  | "dependency_analysis_failed"
  | "changed_shared_paths_missing"
  | "typescript_not_installed"
  | "relative_import_outside_supabase_functions"
  | "unresolved_relative_import"
  | "unable_to_read_source"
  | "parse_failure"
  | "non_literal_dynamic_import"
  | "missing_dynamic_import_specifier"
  | "commonjs_require"
  | "import_equals_require"
  | "unknown_bare_specifier"
  | "unsupported_changed_shared_path"
  | "changed_shared_path_outside_functions"
  | "changed_shared_directory"
  | "unable_to_enumerate_functions";

/**
 * Why dependency analysis could not narrow a shared-module change to specific
 * functions, so every function was redeployed.
 */
export interface SupabaseFallbackReason {
  code: SupabaseFallbackReasonCode;
  /** App-relative, forward-slash path of the file involved. */
  filePath?: string;
  /** Import specifier involved. */
  specifier?: string;
  /** Free-form detail, such as an analysis worker error message. */
  detail?: string;
}

export type SupabaseFunctionImpact =
  | { kind: "partial"; functionNames: string[] }
  | { kind: "all"; reason: SupabaseFallbackReason };

export interface SupabaseDependencyAnalysisInput {
  appPath: string;
  changedSharedModulePaths: string[];
}

export type SupabaseDependencyAnalysisOutput =
  | { success: true; data: SupabaseFunctionImpact }
  | { success: false; error: string };
