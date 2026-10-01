import type { SupabaseFallbackReason } from "../../shared/supabase_dependency_analysis_types";

/**
 * Which Supabase functions a deployment covers and why, so the deploy status
 * can explain itself to users and to later agent turns.
 */
export type SupabaseDeployScope =
  | {
      kind: "affected";
      changedSharedModulePaths: string[];
      affectedFunctionNames: string[];
      editedFunctionNames: string[];
    }
  | { kind: "edited"; functionNames: string[] }
  | { kind: "all"; reason: SupabaseFallbackReason };

/** Short label for the collapsed status title. */
export function summarizeSupabaseFallbackReason(
  reason: SupabaseFallbackReason,
): string {
  switch (reason.code) {
    case "dependency_analysis_failed":
      return "dependency analysis failed";
    case "changed_shared_paths_missing":
      return "changed shared files unknown";
    case "typescript_not_installed":
      return "TypeScript not installed";
    case "relative_import_outside_supabase_functions":
      return "import outside supabase/functions";
    case "unresolved_relative_import":
      return "unresolved import";
    case "unable_to_read_source":
      return "unreadable file";
    case "parse_failure":
      return "parse error";
    case "non_literal_dynamic_import":
    case "missing_dynamic_import_specifier":
      return "dynamic import";
    case "commonjs_require":
    case "import_equals_require":
      return "require() call";
    case "unknown_bare_specifier":
      return "unrecognized import";
    case "unsupported_changed_shared_path":
      return "non-code shared file changed";
    case "changed_shared_path_outside_functions":
      return "changed path outside supabase/functions";
    case "changed_shared_directory":
      return "shared directory changed";
    case "unable_to_enumerate_functions":
      return "couldn't list functions";
  }
}

/** Full explanation, phrased to follow "Redeployed all functions because". */
export function describeSupabaseFallbackReason(
  reason: SupabaseFallbackReason,
): string {
  const file = reason.filePath ?? "a function file";
  const specifier = `"${reason.specifier ?? "unknown"}"`;
  switch (reason.code) {
    case "dependency_analysis_failed":
      return reason.detail
        ? `dependency analysis failed: ${reason.detail.replace(/\.+$/, "")}`
        : "dependency analysis failed";
    case "changed_shared_paths_missing":
      return "Dyad couldn't tell which shared modules changed";
    case "typescript_not_installed":
      return "TypeScript isn't installed in the app, and dependency analysis needs it";
    case "relative_import_outside_supabase_functions":
      return `${file} imports ${specifier}, which is outside supabase/functions`;
    case "unresolved_relative_import":
      return `dependency analysis couldn't resolve ${specifier} imported from ${file}`;
    case "unable_to_read_source":
      return `dependency analysis couldn't read ${file}`;
    case "parse_failure":
      return `dependency analysis couldn't parse ${file}`;
    case "non_literal_dynamic_import":
      return `${file} uses a dynamic import() whose path isn't a string literal`;
    case "missing_dynamic_import_specifier":
      return `${file} calls import() without a path`;
    case "commonjs_require":
      return `${file} uses require(), which dependency analysis can't follow`;
    case "import_equals_require":
      return `${file} uses import = require(), which dependency analysis can't follow`;
    case "unknown_bare_specifier":
      return `${file} imports ${specifier}, which isn't a relative path or an npm:, jsr:, node:, URL, or @supabase/ import`;
    case "unsupported_changed_shared_path":
      return `the changed shared file ${file} isn't a JavaScript or TypeScript module, so Dyad can't tell which functions use it`;
    case "changed_shared_path_outside_functions":
      return `the changed path ${file} is outside supabase/functions`;
    case "changed_shared_directory":
      return `the changed shared path ${file} is a directory`;
    case "unable_to_enumerate_functions":
      return "Dyad couldn't list the functions in supabase/functions";
  }
}

/** Suffix that keeps a fallback visible in a collapsed status title. */
export function formatSupabaseDeployScopeTitleSuffix(
  scope: SupabaseDeployScope | undefined,
): string {
  return scope?.kind === "all"
    ? ` (fallback to all functions: ${summarizeSupabaseFallbackReason(scope.reason)})`
    : "";
}

function formatNames(names: string[]): string {
  return names.length > 0 ? names.join(", ") : "none";
}

export function describeSupabaseDeployScope(
  scope: SupabaseDeployScope,
): string {
  switch (scope.kind) {
    case "all":
      return `Redeployed all functions because ${describeSupabaseFallbackReason(scope.reason)}.`;
    case "edited":
      return `Functions edited directly: ${formatNames(scope.functionNames)}`;
    case "affected": {
      const affected = new Set(scope.affectedFunctionNames);
      const lines = [
        `Changed shared modules: ${formatNames(scope.changedSharedModulePaths)}`,
        `Functions that depend on them: ${formatNames(scope.affectedFunctionNames)}`,
      ];
      const otherEdited = scope.editedFunctionNames.filter(
        (name) => !affected.has(name),
      );
      if (otherEdited.length > 0) {
        lines.push(`Functions edited directly: ${otherEdited.join(", ")}`);
      }
      return lines.join("\n");
    }
  }
}
