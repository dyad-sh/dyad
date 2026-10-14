import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  SupabaseFallbackReason,
  SupabaseFunctionImpact,
} from "../../shared/supabase_dependency_analysis_types";

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
];
const SUPPORTED_SOURCE_EXTENSIONS = new Set(SOURCE_EXTENSIONS);

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function fallback(reason: SupabaseFallbackReason): SupabaseFunctionImpact {
  return { kind: "all", reason };
}

/** Formats an absolute path for display relative to the app root. */
type DisplayPath = (absolutePath: string) => string;

function isPathWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function getValidFunctionNames(functionsDir: string): Promise<string[]> {
  const entries = await fs.readdir(functionsDir, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith("_")) {
      try {
        await fs.access(path.join(functionsDir, entry.name, "index.ts"));
        names.push(entry.name);
      } catch {
        // A function without index.ts is not deployable.
      }
    }
  }
  return names;
}

function scriptKindForPath(ts: typeof import("typescript"), filePath: string) {
  switch (path.extname(filePath)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function isClearlyExternalSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith("npm:") ||
    specifier.startsWith("jsr:") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("http://") ||
    specifier.startsWith("https://") ||
    specifier.startsWith("@supabase/")
  );
}

async function resolveLocalImport(
  fromFile: string,
  specifier: string,
  functionsDir: string,
  displayPath: DisplayPath,
): Promise<string | SupabaseFunctionImpact> {
  const resolvedBase = path.resolve(path.dirname(fromFile), specifier);
  if (!isPathWithin(functionsDir, resolvedBase)) {
    return fallback({
      code: "relative_import_outside_supabase_functions",
      filePath: displayPath(fromFile),
      specifier,
    });
  }
  const candidates = path.extname(resolvedBase)
    ? [resolvedBase]
    : [
        resolvedBase,
        ...SOURCE_EXTENSIONS.map((ext) => resolvedBase + ext),
        ...SOURCE_EXTENSIONS.map((ext) =>
          path.join(resolvedBase, `index${ext}`),
        ),
      ];
  for (const candidate of candidates) {
    try {
      if ((await fs.stat(candidate)).isFile()) {
        return candidate;
      }
    } catch {
      // Try the next supported path.
    }
  }
  return fallback({
    code: "unresolved_relative_import",
    filePath: displayPath(fromFile),
    specifier,
  });
}

async function collectDependencies(
  ts: typeof import("typescript"),
  filePath: string,
  functionsDir: string,
  displayPath: DisplayPath,
): Promise<string[] | SupabaseFunctionImpact> {
  const displayFilePath = displayPath(filePath);
  let sourceText: string;
  try {
    sourceText = await fs.readFile(filePath, "utf8");
  } catch {
    return fallback({
      code: "unable_to_read_source",
      filePath: displayFilePath,
    });
  }
  let sourceFile: import("typescript").SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(ts, filePath),
    );
  } catch {
    return fallback({ code: "parse_failure", filePath: displayFilePath });
  }
  const parseDiagnostics = (
    sourceFile as unknown as { parseDiagnostics?: readonly unknown[] }
  ).parseDiagnostics;
  if (!parseDiagnostics || parseDiagnostics.length > 0) {
    return fallback({ code: "parse_failure", filePath: displayFilePath });
  }
  const specifiers: string[] = [];
  let unsafeReason: SupabaseFallbackReason["code"] | undefined;
  const addSpecifier = (node: import("typescript").Expression) => {
    if (ts.isStringLiteralLike(node)) specifiers.push(node.text);
    else unsafeReason = "non_literal_dynamic_import";
  };
  const visit = (node: import("typescript").Node) => {
    if (unsafeReason) return;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      addSpecifier(node.moduleSpecifier);
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [specifier] = node.arguments;
      if (specifier) addSpecifier(specifier);
      else unsafeReason = "missing_dynamic_import_specifier";
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      unsafeReason = "commonjs_require";
      return;
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      unsafeReason = "import_equals_require";
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (unsafeReason) {
    return fallback({ code: unsafeReason, filePath: displayFilePath });
  }
  const dependencies: string[] = [];
  for (const specifier of specifiers) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const resolved = await resolveLocalImport(
        filePath,
        specifier,
        functionsDir,
        displayPath,
      );
      if (typeof resolved !== "string") return resolved;
      dependencies.push(resolved);
    } else if (!isClearlyExternalSpecifier(specifier)) {
      return fallback({
        code: "unknown_bare_specifier",
        filePath: displayFilePath,
        specifier,
      });
    }
  }
  return dependencies;
}

export async function analyzeSupabaseDependencies(
  ts: typeof import("typescript"),
  appPath: string,
  changedSharedModulePaths: string[],
): Promise<SupabaseFunctionImpact> {
  const functionsDir = path.join(appPath, "supabase", "functions");
  const displayPath: DisplayPath = (absolutePath) =>
    normalizeRelativePath(path.relative(appPath, absolutePath));
  try {
    await fs.access(functionsDir);
  } catch {
    return { kind: "partial", functionNames: [] };
  }
  const changedPaths = new Set<string>();
  for (const changedPath of changedSharedModulePaths) {
    const normalized = normalizeRelativePath(changedPath);
    if (!SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(normalized))) {
      return fallback({
        code: "unsupported_changed_shared_path",
        filePath: normalized,
      });
    }
    const absolutePath = path.resolve(appPath, normalized);
    if (!isPathWithin(functionsDir, absolutePath)) {
      return fallback({
        code: "changed_shared_path_outside_functions",
        filePath: normalized,
      });
    }
    try {
      if ((await fs.stat(absolutePath)).isDirectory()) {
        return fallback({
          code: "changed_shared_directory",
          filePath: normalized,
        });
      }
    } catch {
      // Deleted or renamed source files may no longer exist. Keep the path in
      // the impact set; unresolved imports will conservatively deploy all.
    }
    changedPaths.add(absolutePath);
  }
  if (changedPaths.size === 0) return { kind: "partial", functionNames: [] };
  let functionNames: string[];
  try {
    functionNames = await getValidFunctionNames(functionsDir);
  } catch {
    return fallback({ code: "unable_to_enumerate_functions" });
  }
  const dependencyCache = new Map<string, string[]>();
  const affected: string[] = [];
  for (const functionName of functionNames) {
    const stack = [path.join(functionsDir, functionName, "index.ts")];
    const visited = new Set<string>();
    let isAffected = false;
    while (stack.length) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      if (changedPaths.has(current)) {
        isAffected = true;
        break;
      }
      let dependencies = dependencyCache.get(current);
      if (!dependencies) {
        const collected = await collectDependencies(
          ts,
          current,
          functionsDir,
          displayPath,
        );
        if (!Array.isArray(collected)) return collected;
        dependencies = collected;
        dependencyCache.set(current, dependencies);
      }
      stack.push(...dependencies.filter((item) => !visited.has(item)));
    }
    if (isAffected) affected.push(functionName);
  }
  return { kind: "partial", functionNames: affected };
}
