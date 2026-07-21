import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SupabaseFunctionImpact } from "../../shared/supabase_dependency_analysis_types";

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
): Promise<string | SupabaseFunctionImpact> {
  const resolvedBase = path.resolve(path.dirname(fromFile), specifier);
  if (!isPathWithin(functionsDir, resolvedBase)) {
    return {
      kind: "all",
      reason: `relative_import_outside_supabase_functions:${specifier}`,
    };
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
  return { kind: "all", reason: `unresolved_relative_import:${specifier}` };
}

async function collectDependencies(
  ts: typeof import("typescript"),
  filePath: string,
  functionsDir: string,
): Promise<string[] | SupabaseFunctionImpact> {
  let sourceText: string;
  try {
    sourceText = await fs.readFile(filePath, "utf8");
  } catch {
    return { kind: "all", reason: `unable_to_read_source:${filePath}` };
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
    return { kind: "all", reason: `parse_failure:${filePath}` };
  }
  const specifiers: string[] = [];
  let unsafeReason: string | undefined;
  const addSpecifier = (node: import("typescript").Expression) => {
    if (ts.isStringLiteralLike(node)) specifiers.push(node.text);
    else unsafeReason = `non_literal_dynamic_import:${filePath}`;
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
      else unsafeReason = `missing_dynamic_import_specifier:${filePath}`;
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      unsafeReason = `commonjs_require:${filePath}`;
      return;
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      unsafeReason = `import_equals_require:${filePath}`;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (unsafeReason) return { kind: "all", reason: unsafeReason };
  const dependencies: string[] = [];
  for (const specifier of specifiers) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const resolved = await resolveLocalImport(
        filePath,
        specifier,
        functionsDir,
      );
      if (typeof resolved !== "string") return resolved;
      dependencies.push(resolved);
    } else if (!isClearlyExternalSpecifier(specifier)) {
      return { kind: "all", reason: `unknown_bare_specifier:${specifier}` };
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
  try {
    await fs.access(functionsDir);
  } catch {
    return { kind: "partial", functionNames: [] };
  }
  const changedPaths = new Set<string>();
  for (const changedPath of changedSharedModulePaths) {
    const normalized = normalizeRelativePath(changedPath);
    if (!SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(normalized))) {
      return {
        kind: "all",
        reason: `unsupported_changed_shared_path:${changedPath}`,
      };
    }
    const absolutePath = path.resolve(appPath, normalized);
    if (!isPathWithin(functionsDir, absolutePath)) {
      return {
        kind: "all",
        reason: `changed_shared_path_outside_functions:${changedPath}`,
      };
    }
    try {
      if ((await fs.stat(absolutePath)).isDirectory()) {
        return {
          kind: "all",
          reason: `changed_shared_directory:${changedPath}`,
        };
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
    return { kind: "all", reason: "unable_to_enumerate_functions" };
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
        const collected = await collectDependencies(ts, current, functionsDir);
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
