import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const MACHINE_DIRECTORIES = [
  "app_run",
  "chat_stream",
  "connection_flow",
  "coolify_deploy",
  "deep_link_window_readiness",
  "first_prompt",
  "github_ops",
  "image_generation",
  "mcp_oauth",
  "plan_handoff",
  "preview_iframe",
  "screenshot",
  "version_preview",
  "voice_to_text",
  "user_input",
] as const;
type MachineDirectory = (typeof MACHINE_DIRECTORIES)[number];
type BoundaryRule =
  | "pure-machine-module"
  | "writable-projection-export"
  | "atom-projection-call"
  | "cross-machine-atom-read";

interface AllowlistEntry {
  rule: BoundaryRule;
  atom: string;
  file: string;
  detail: string;
}

/**
 * Permanent machine-to-UI side effects. These are one-way presentation
 * writes, never lifecycle projections or machine inputs.
 *
 * Plan-handoff navigation now crosses the presentation-routing boundary and
 * lands in hooks/usePlanEvents.ts; first-prompt clears its submitted editing
 * buffer; chat-stream and first-prompt may open/close the window-local preview.
 */
const PERMANENT_UI_WRITE_ALLOWLIST = [
  {
    atom: "previewModeAtom",
    file: "hooks/usePlanEvents.ts",
    marker: 'setPreviewMode("preview")',
    rationale: "Show implementation preview after the handoff is accepted.",
  },
  {
    atom: "selectedChatIdAtom",
    file: "hooks/usePlanEvents.ts",
    marker: "setSelectedChatId(payload.targetChatId)",
    rationale: "Select the chat that will implement the accepted plan.",
  },
  {
    atom: "isPreviewOpenAtom",
    file: "first_prompt/FirstPromptProvider.tsx",
    marker: "store.set(isPreviewOpenAtom, false)",
    rationale: "Keep preview closed when setup has no preview to open.",
  },
  {
    atom: "homeChatInputValueAtom",
    file: "first_prompt/FirstPromptProvider.tsx",
    marker: 'store.set(homeChatInputValueAtom, "")',
    rationale: "Clear submitted prompt text from the home composer.",
  },
  {
    atom: "attachmentsAtom",
    file: "first_prompt/FirstPromptProvider.tsx",
    marker:
      "store.set(\n        attachmentsAtom,\n        removeSubmittedFirstPromptAttachments(\n          currentAttachments,\n          payload.attachments,\n        ),\n      )",
    rationale: "Clear submitted attachments from the home composer.",
  },
  {
    atom: "chatInputValuesByIdAtom",
    file: "first_prompt/FirstPromptProvider.tsx",
    marker:
      "store.set(chatInputValuesByIdAtom, (current) =>\n        mergeRejectedPromptIntoChatDraft(current, chatId, payload.prompt),\n      )",
    rationale:
      "Preserve a rejected first prompt in the destination chat composer.",
  },
  {
    atom: "homeSelectedAppAtom",
    file: "first_prompt/FirstPromptProvider.tsx",
    marker: "store.set(homeSelectedAppAtom, null)",
    rationale: "Clear the submitted app selection from the home composer.",
  },
  {
    atom: "isPreviewOpenAtom",
    file: "chat_stream/remote_manager.ts",
    marker: "this.store.set(isPreviewOpenAtom, true)",
    rationale: "Open the window-local preview after generated files change.",
  },
] as const;

/**
 * The chat stream's message collection is a renderer read-model cache, not a
 * lifecycle projection or UI-presentation side effect.
 */
const PERMANENT_READ_MODEL_WRITE_ALLOWLIST = [
  {
    atom: "chatMessagesByIdAtom",
    file: "chat_stream/remote_manager.ts",
  },
  {
    atom: "chatMessagesByIdAtom",
    file: "version_preview/VersionPreviewProvider.tsx",
  },
] as const;

const ALLOWLIST: readonly AllowlistEntry[] = [];

interface BoundaryViolation {
  rule: BoundaryRule;
  file: string;
  detail: string;
  atom: string;
}

interface ObservedAtomWrite {
  atom: string;
  file: string;
  call: ts.CallExpression;
  sourceFile: ts.SourceFile;
}

function productionFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(filePath);
    if (
      !/\.tsx?$/.test(entry.name) ||
      /\.(?:test|spec)\.tsx?$/.test(entry.name)
    ) {
      return [];
    }
    return [filePath];
  });
}

function importsFromSource(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    "boundary-check.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function importsIn(filePath: string): string[] {
  return importsFromSource(fs.readFileSync(filePath, "utf8"));
}

function sourceFileFor(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function toPortablePath(filePath: string): string {
  return filePath.split(path.win32.sep).join(path.posix.sep);
}

function relativeSourcePath(filePath: string): string {
  return toPortablePath(path.relative(SOURCE_ROOT, filePath));
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function machineForFile(filePath: string): MachineDirectory | undefined {
  return MACHINE_DIRECTORIES.find((machine) =>
    isWithin(path.join(SOURCE_ROOT, machine), filePath),
  );
}

function importedMachineFor(
  filePath: string,
  source: string,
): MachineDirectory | undefined {
  const aliasMatch = /^@\/([^/]+)(?:\/|$)/.exec(source);
  if (aliasMatch) {
    return MACHINE_DIRECTORIES.find((machine) => machine === aliasMatch[1]);
  }
  if (!source.startsWith(".")) return undefined;
  const resolved = path.resolve(path.dirname(filePath), source);
  return machineForFile(resolved);
}

function resolvesWithin(
  filePath: string,
  source: string,
  root: string,
): boolean {
  if (source.startsWith("@/")) {
    return isWithin(root, path.join(SOURCE_ROOT, source.slice(2)));
  }
  return (
    source.startsWith(".") &&
    isWithin(root, path.resolve(path.dirname(filePath), source))
  );
}

function isJotaiModule(source: string): boolean {
  return source === "jotai" || source.startsWith("jotai/");
}

function isJotaiAtomCall(
  call: ts.CallExpression,
  bindings: Map<string, { imported: string; source: string }>,
): boolean {
  if (ts.isIdentifier(call.expression)) {
    const binding = bindings.get(call.expression.text);
    return binding?.imported === "atom" && isJotaiModule(binding.source);
  }
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression)
  ) {
    const binding = bindings.get(call.expression.expression.text);
    return (
      binding?.imported === "*" &&
      isJotaiModule(binding.source) &&
      call.expression.name.text === "atom"
    );
  }
  return false;
}

function isProjectionModuleImport(filePath: string, source: string): boolean {
  if (source === "@/state_machines/projection") return true;
  if (!source.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(filePath), source);
  const projectionModule = path.join(SOURCE_ROOT, "state_machines/projection");
  return resolved === projectionModule || resolved === `${projectionModule}.ts`;
}

function isForbiddenPureMachineImport(
  filePath: string,
  machine: MachineDirectory,
  source: string,
): boolean {
  const importedMachine = importedMachineFor(filePath, source);
  return (
    source === "react" ||
    source.startsWith("react/") ||
    source === "electron" ||
    source.startsWith("electron/") ||
    source.startsWith("@electron/") ||
    source === "jotai" ||
    source.startsWith("jotai/") ||
    resolvesWithin(filePath, source, path.join(SOURCE_ROOT, "atoms")) ||
    resolvesWithin(filePath, source, path.join(SOURCE_ROOT, "ipc")) ||
    (importedMachine !== undefined && importedMachine !== machine)
  );
}

function allowlistAtom(
  rule: BoundaryRule,
  file: string,
  detail: string,
): string {
  return (
    ALLOWLIST.find(
      (entry) =>
        entry.rule === rule && entry.file === file && entry.detail === detail,
    )?.atom ?? "<unclassified>"
  );
}

function expectExactAllowlist(
  rule: BoundaryRule,
  actual: BoundaryViolation[],
): void {
  const comparable = (entry: BoundaryViolation | AllowlistEntry) => ({
    rule: entry.rule,
    atom: entry.atom,
    file: entry.file,
    detail: entry.detail,
  });
  const sort = <T extends ReturnType<typeof comparable>>(entries: T[]) =>
    entries.sort((left, right) =>
      `${left.file}:${left.detail}:${left.atom}`.localeCompare(
        `${right.file}:${right.detail}:${right.atom}`,
      ),
    );
  expect(sort(actual.map(comparable))).toEqual(
    sort(ALLOWLIST.filter((entry) => entry.rule === rule).map(comparable)),
  );
}

function importedBindings(
  sourceFile: ts.SourceFile,
): Map<string, { imported: string; source: string }> {
  const bindings = new Map<string, { imported: string; source: string }>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      continue;
    }
    const source = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) {
      bindings.set(clause.name.text, { imported: "default", source });
    }
    const namedBindings = clause.namedBindings;
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        bindings.set(element.name.text, {
          imported: element.propertyName?.text ?? element.name.text,
          source,
        });
      }
    } else if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      bindings.set(namedBindings.name.text, { imported: "*", source });
    }
  }
  return bindings;
}

function expressionName(
  expression: ts.Expression | undefined,
): string | undefined {
  while (
    expression &&
    (ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isParenthesizedExpression(expression))
  ) {
    expression = expression.expression;
  }
  if (expression && ts.isIdentifier(expression)) return expression.text;
  if (expression && ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return undefined;
}

function argumentName(
  call: ts.CallExpression,
  index: number,
): string | undefined {
  return expressionName(call.arguments[index]);
}

function importedArgumentName(
  call: ts.CallExpression,
  index: number,
  bindings: Map<string, { imported: string; source: string }>,
): string | undefined {
  const expression = call.arguments[index];
  if (expression && ts.isIdentifier(expression)) {
    return bindings.get(expression.text)?.imported;
  }
  if (
    expression &&
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    const binding = bindings.get(expression.expression.text);
    if (binding?.imported === "*") return expression.name.text;
  }
  return undefined;
}

function importedCallName(
  call: ts.CallExpression,
  bindings: Map<string, { imported: string; source: string }>,
  moduleSuffix: string,
): string | undefined {
  if (ts.isIdentifier(call.expression)) {
    const binding = bindings.get(call.expression.text);
    return binding?.source.endsWith(moduleSuffix)
      ? binding.imported
      : undefined;
  }
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression)
  ) {
    const binding = bindings.get(call.expression.expression.text);
    if (binding?.imported === "*" && binding.source.endsWith(moduleSuffix)) {
      return call.expression.name.text;
    }
  }
  return undefined;
}

function importedJotaiCallName(
  call: ts.CallExpression,
  bindings: Map<string, { imported: string; source: string }>,
): string | undefined {
  if (ts.isIdentifier(call.expression)) {
    const binding = bindings.get(call.expression.text);
    return binding && isJotaiModule(binding.source)
      ? binding.imported
      : undefined;
  }
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression)
  ) {
    const binding = bindings.get(call.expression.expression.text);
    if (binding?.imported === "*" && isJotaiModule(binding.source)) {
      return call.expression.name.text;
    }
  }
  return undefined;
}

function atomArgumentName(
  call: ts.CallExpression,
  index: number,
  bindings: Map<string, { imported: string; source: string }>,
): string | undefined {
  const argument = call.arguments[index];
  if (argument && ts.isIdentifier(argument)) {
    const binding = bindings.get(argument.text);
    return binding && binding.imported !== "*"
      ? binding.imported
      : argument.text;
  }
  if (
    argument &&
    (ts.isPropertyAccessExpression(argument) ||
      ts.isElementAccessExpression(argument)) &&
    ts.isIdentifier(argument.expression)
  ) {
    const binding = bindings.get(argument.expression.text);
    const atom =
      ts.isPropertyAccessExpression(argument) ||
      !argument.argumentExpression ||
      !ts.isStringLiteralLike(argument.argumentExpression)
        ? ts.isPropertyAccessExpression(argument)
          ? argument.name.text
          : undefined
        : argument.argumentExpression.text;
    return binding?.imported === "*" ? atom : undefined;
  }
  return undefined;
}

function jotaiStoreTypeAliases(
  sourceFile: ts.SourceFile,
  bindings: Map<string, { imported: string; source: string }>,
): Set<string> {
  const aliases = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isTypeAliasDeclaration(statement) ||
      !ts.isTypeReferenceNode(statement.type) ||
      !ts.isIdentifier(statement.type.typeName) ||
      statement.type.typeName.text !== "ReturnType"
    ) {
      continue;
    }
    const argument = statement.type.typeArguments?.[0];
    if (
      argument &&
      ts.isTypeQueryNode(argument) &&
      ts.isIdentifier(argument.exprName)
    ) {
      const binding = bindings.get(argument.exprName.text);
      if (
        binding?.imported === "createStore" &&
        isJotaiModule(binding.source)
      ) {
        aliases.add(statement.name.text);
      }
    }
  }
  return aliases;
}

function isJotaiStoreType(
  type: ts.TypeNode | undefined,
  aliases: Set<string>,
  bindings: Map<string, { imported: string; source: string }>,
): boolean {
  if (
    !type ||
    !ts.isTypeReferenceNode(type) ||
    !ts.isIdentifier(type.typeName)
  ) {
    return false;
  }
  if (aliases.has(type.typeName.text)) return true;
  const binding = bindings.get(type.typeName.text);
  return binding?.imported === "Store" && isJotaiModule(binding.source);
}

interface JotaiStoreBindings {
  identifiers: Set<string>;
  properties: Set<string>;
}

function jotaiStoreBindings(
  sourceFile: ts.SourceFile,
  bindings: Map<string, { imported: string; source: string }>,
): JotaiStoreBindings {
  const stores: JotaiStoreBindings = {
    identifiers: new Set<string>(),
    properties: new Set<string>(),
  };
  const aliases = jotaiStoreTypeAliases(sourceFile, bindings);
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (
        (node.initializer &&
          ts.isCallExpression(node.initializer) &&
          ["createStore", "useStore"].includes(
            importedJotaiCallName(node.initializer, bindings) ?? "",
          )) ||
        isJotaiStoreType(node.type, aliases, bindings)
      ) {
        stores.identifiers.add(node.name.text);
      }
    } else if (
      (ts.isParameter(node) || ts.isPropertyDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      isJotaiStoreType(node.type, aliases, bindings)
    ) {
      stores.identifiers.add(node.name.text);
      stores.properties.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return stores;
}

function isJotaiStoreSetCall(
  call: ts.CallExpression,
  stores: JotaiStoreBindings,
): boolean {
  let receiver: ts.Expression | undefined;
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "set"
  ) {
    receiver = call.expression.expression;
  } else if (
    ts.isElementAccessExpression(call.expression) &&
    call.expression.argumentExpression &&
    ts.isStringLiteralLike(call.expression.argumentExpression) &&
    call.expression.argumentExpression.text === "set"
  ) {
    receiver = call.expression.expression;
  }
  if (!receiver) return false;
  if (ts.isIdentifier(receiver)) {
    return stores.identifiers.has(receiver.text);
  }
  return (
    ts.isPropertyAccessExpression(receiver) &&
    receiver.expression.kind === ts.SyntaxKind.ThisKeyword &&
    stores.properties.has(receiver.name.text)
  );
}

function atomSetterBindings(
  sourceFile: ts.SourceFile,
  bindings: Map<string, { imported: string; source: string }>,
): Map<string, string> {
  const setterAtoms = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const hook = importedJotaiCallName(node.initializer, bindings);
      const atom = atomArgumentName(node.initializer, 0, bindings);
      if (atom && hook === "useSetAtom" && ts.isIdentifier(node.name)) {
        setterAtoms.set(node.name.text, atom);
      } else if (
        atom &&
        hook === "useAtom" &&
        ts.isArrayBindingPattern(node.name)
      ) {
        const setter = node.name.elements[1];
        if (
          setter &&
          ts.isBindingElement(setter) &&
          ts.isIdentifier(setter.name)
        ) {
          setterAtoms.set(setter.name.text, atom);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return setterAtoms;
}

function collectAtomWritesIn(
  filePath: string,
  sourceFile: ts.SourceFile,
  root: ts.Node,
  bindings: Map<string, { imported: string; source: string }>,
  setterAtoms: Map<string, string>,
  stores: JotaiStoreBindings,
): ObservedAtomWrite[] {
  const writes: ObservedAtomWrite[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      let atom: string | undefined;
      if (isJotaiStoreSetCall(node, stores)) {
        atom = atomArgumentName(node, 0, bindings);
      } else if (ts.isIdentifier(node.expression)) {
        atom = setterAtoms.get(node.expression.text);
      }
      if (atom) {
        writes.push({
          atom,
          file: relativeSourcePath(filePath),
          call: node,
          sourceFile,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return writes;
}

function collectMachineAtomWrites(): ObservedAtomWrite[] {
  return MACHINE_DIRECTORIES.flatMap((machine) =>
    productionFiles(path.join(SOURCE_ROOT, machine)).flatMap((filePath) => {
      const sourceFile = sourceFileFor(filePath);
      const bindings = importedBindings(sourceFile);
      return collectAtomWritesIn(
        filePath,
        sourceFile,
        sourceFile,
        bindings,
        atomSetterBindings(sourceFile, bindings),
        jotaiStoreBindings(sourceFile, bindings),
      );
    }),
  );
}

function collectPlanHandoffPresentationWrites(): ObservedAtomWrite[] {
  const filePath = path.join(SOURCE_ROOT, "hooks/usePlanEvents.ts");
  const sourceFile = sourceFileFor(filePath);
  const bindings = importedBindings(sourceFile);
  const setterAtoms = atomSetterBindings(sourceFile, bindings);

  const writes: ObservedAtomWrite[] = [];
  const findPresentationCallback = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "onHandoffPresentation"
    ) {
      const callback = node.arguments[0];
      if (callback) {
        writes.push(
          ...collectAtomWritesIn(
            filePath,
            sourceFile,
            callback,
            bindings,
            setterAtoms,
            jotaiStoreBindings(sourceFile, bindings),
          ),
        );
      }
      return;
    }
    ts.forEachChild(node, findPresentationCallback);
  };
  findPresentationCallback(sourceFile);
  return writes;
}

function precedingLine(sourceFile: ts.SourceFile, node: ts.Node): string {
  const { line } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  if (line === 0) return "";
  const lineStarts = sourceFile.getLineStarts();
  return sourceFile.text.slice(lineStarts[line - 1], lineStarts[line]).trim();
}

function usesRuntimeGetDefaultStore(sourceFile: ts.SourceFile): boolean {
  const jotaiNamespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      isJotaiModule(statement.moduleSpecifier.text) &&
      !statement.importClause?.isTypeOnly
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        jotaiNamespaces.add(bindings.name.text);
      } else if (bindings && ts.isNamedImports(bindings)) {
        if (
          bindings.elements.some(
            (specifier) =>
              !specifier.isTypeOnly &&
              (specifier.propertyName?.text ?? specifier.name.text) ===
                "getDefaultStore",
          )
        ) {
          return true;
        }
      }
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      isJotaiModule(statement.moduleSpecifier.text) &&
      !statement.isTypeOnly
    ) {
      if (
        !statement.exportClause ||
        ts.isNamespaceExport(statement.exportClause)
      ) {
        return true;
      }
      if (
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.some(
          (specifier) =>
            !specifier.isTypeOnly &&
            (specifier.propertyName?.text ?? specifier.name.text) ===
              "getDefaultStore",
        )
      ) {
        return true;
      }
    }
  }

  let found = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      jotaiNamespaces.has(node.expression.text) &&
      node.name.text === "getDefaultStore"
    ) {
      found = true;
      return;
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      jotaiNamespaces.has(node.expression.text) &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "getDefaultStore"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

describe("state-machine boundaries", () => {
  it("keeps WindowRegistry main internals out of renderer production code", () => {
    const mainOnlyRoot = path.join(
      SOURCE_ROOT,
      "window_infrastructure",
      "main",
    );
    const allowedRoots = [
      path.join(SOURCE_ROOT, "ipc"),
      path.join(SOURCE_ROOT, "main"),
      path.join(SOURCE_ROOT, "testing"),
      mainOnlyRoot,
    ];
    const violations: string[] = [];
    for (const filePath of productionFiles(SOURCE_ROOT)) {
      const isMainEntry = filePath === path.join(SOURCE_ROOT, "main.ts");
      if (
        isMainEntry ||
        allowedRoots.some((root) => isWithin(root, filePath))
      ) {
        continue;
      }
      for (const source of importsIn(filePath)) {
        if (resolvesWithin(filePath, source, mainOnlyRoot)) {
          violations.push(`${relativeSourcePath(filePath)} imports ${source}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("normalizes Windows paths used in boundary assertions", () => {
    expect(toPortablePath("first_prompt\\FirstPromptProvider.tsx")).toBe(
      "first_prompt/FirstPromptProvider.tsx",
    );
  });

  it("keeps only the permanent machine-to-UI presentation writes", () => {
    const writes = [
      ...collectMachineAtomWrites(),
      ...collectPlanHandoffPresentationWrites(),
    ];
    const comparable = (entry: { atom: string; file: string }) => ({
      atom: entry.atom,
      file: entry.file,
    });
    const sort = <T extends ReturnType<typeof comparable>>(entries: T[]) =>
      entries.sort((left, right) =>
        `${left.file}:${left.atom}`.localeCompare(
          `${right.file}:${right.atom}`,
        ),
      );

    expect(sort(writes.map(comparable))).toEqual(
      sort(
        [
          ...PERMANENT_UI_WRITE_ALLOWLIST,
          ...PERMANENT_READ_MODEL_WRITE_ALLOWLIST,
        ].map(comparable),
      ),
    );

    for (const entry of PERMANENT_UI_WRITE_ALLOWLIST) {
      const write = writes.find(
        (candidate) =>
          candidate.atom === entry.atom && candidate.file === entry.file,
      );
      expect(write, `${entry.file} retains ${entry.atom} write`).toBeDefined();
      expect(write!.call.getText(write!.sourceFile)).toBe(entry.marker);
      expect(
        precedingLine(write!.sourceFile, write!.call),
        `${entry.file} documents the ${entry.atom} permanent keep`,
      ).toContain(entry.rationale);
    }
  });

  it("detects direct, hook, and namespace machine-to-Jotai writes", () => {
    const filePath = path.join(SOURCE_ROOT, "first_prompt/fixture.tsx");
    const sourceFile = ts.createSourceFile(
      filePath,
      `
        import { atom, useSetAtom, useStore } from "jotai";
        import { useAtom } from "jotai/react";
        import { lifecycleAtom } from "@/atoms/lifecycleAtoms";
        import * as atoms from "@/atoms/lifecycleAtoms";
        import { externalLifecycle } from "../compatibility/lifecycle";
        const store = useStore();
        const localLifecycle = atom(false);
        const ordinaryMap = new Map();
        const setLifecycle = useSetAtom(lifecycleAtom);
        const [, setLifecycleFromTuple] = useAtom(lifecycleAtom);
        store.set(lifecycleAtom, direct);
        store.set(localLifecycle, local);
        store.set(externalLifecycle, external);
        ordinaryMap.set(externalLifecycle, notAJotaiWrite);
        setLifecycle(hook);
        setLifecycleFromTuple(tupleHook);
        store.set(atoms.lifecycleAtom, namespace);
        store["set"](atoms["lifecycleAtom"], elementAccess);
      `,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const bindings = importedBindings(sourceFile);

    expect(
      collectAtomWritesIn(
        filePath,
        sourceFile,
        sourceFile,
        bindings,
        atomSetterBindings(sourceFile, bindings),
        jotaiStoreBindings(sourceFile, bindings),
      ).map((write) => write.call.getText(sourceFile)),
    ).toEqual([
      "store.set(lifecycleAtom, direct)",
      "store.set(localLifecycle, local)",
      "store.set(externalLifecycle, external)",
      "setLifecycle(hook)",
      "setLifecycleFromTuple(tupleHook)",
      "store.set(atoms.lifecycleAtom, namespace)",
      'store["set"](atoms["lifecycleAtom"], elementAccess)',
    ]);
  });

  it("recognizes runtime default-store access through supported import forms", () => {
    const parse = (source: string) =>
      ts.createSourceFile(
        "fixture.ts",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
    expect(
      usesRuntimeGetDefaultStore(
        parse('import { getDefaultStore as store } from "jotai"; store();'),
      ),
    ).toBe(true);
    expect(
      usesRuntimeGetDefaultStore(
        parse('import * as jotai from "jotai"; jotai.getDefaultStore();'),
      ),
    ).toBe(true);
    expect(
      usesRuntimeGetDefaultStore(
        parse('import * as jotai from "jotai"; jotai["getDefaultStore"]();'),
      ),
    ).toBe(true);
    expect(
      usesRuntimeGetDefaultStore(
        parse('import type { getDefaultStore } from "jotai";'),
      ),
    ).toBe(false);
  });

  it("keeps the shared kernel independent from domain and platform modules", () => {
    const kernelFiles = productionFiles(
      path.join(SOURCE_ROOT, "state_machines"),
    );
    for (const filePath of kernelFiles) {
      for (const source of importsIn(filePath)) {
        const relativeImportStaysInKernel =
          source.startsWith(".") &&
          isWithin(
            path.join(SOURCE_ROOT, "state_machines"),
            path.resolve(path.dirname(filePath), source),
          );
        expect(
          source === "react" ||
            source === "use-sync-external-store/with-selector" ||
            relativeImportStaysInKernel,
          `${path.relative(SOURCE_ROOT, filePath)} imports ${source}`,
        ).toBe(true);
      }
    }
  });

  it("detects every module-loading syntax used by production TypeScript", () => {
    expect(
      importsFromSource(`
        import "side-effect";
        import value from "static-import";
        export { value } from "re-export";
        export * from "star-export";
        void import("dynamic-import");
      `),
    ).toEqual([
      "side-effect",
      "static-import",
      "re-export",
      "star-export",
      "dynamic-import",
    ]);
  });

  it("recognizes relative and platform imports forbidden in pure modules", () => {
    const stateFile = path.join(SOURCE_ROOT, "app_run/state.ts");
    expect(
      [
        "../atoms/previewRuntimeAtoms",
        "../ipc/types",
        "electron",
        "@electron/remote",
      ].every((source) =>
        isForbiddenPureMachineImport(stateFile, "app_run", source),
      ),
    ).toBe(true);
  });

  it("requires machine-to-machine calls to cross an injected facade", () => {
    for (const machine of MACHINE_DIRECTORIES) {
      const machineRoot = path.join(SOURCE_ROOT, machine);
      for (const filePath of productionFiles(machineRoot)) {
        for (const source of importsIn(filePath)) {
          const aliasMatch = /^@\/([^/]+)(?:\/|$)/.exec(source);
          if (aliasMatch) {
            expect(
              !MACHINE_DIRECTORIES.includes(
                aliasMatch[1] as (typeof MACHINE_DIRECTORIES)[number],
              ) || aliasMatch[1] === machine,
              `${path.relative(SOURCE_ROOT, filePath)} imports ${source}`,
            ).toBe(true);
            continue;
          }
          if (!source.startsWith(".")) continue;
          const resolved = path.resolve(path.dirname(filePath), source);
          const importedMachine = MACHINE_DIRECTORIES.find((candidate) =>
            resolved.startsWith(path.join(SOURCE_ROOT, candidate) + path.sep),
          );
          expect(
            importedMachine === undefined || importedMachine === machine,
            `${path.relative(SOURCE_ROOT, filePath)} imports ${source}`,
          ).toBe(true);
        }
      }
    }
  });

  it("keeps state.ts and transition.ts free of UI, IPC, and other machines", () => {
    const violations: BoundaryViolation[] = [];
    for (const machine of MACHINE_DIRECTORIES) {
      for (const name of ["state.ts", "transition.ts"]) {
        const filePath = path.join(SOURCE_ROOT, machine, name);
        if (!fs.existsSync(filePath)) continue;
        for (const source of importsIn(filePath)) {
          if (!isForbiddenPureMachineImport(filePath, machine, source)) {
            continue;
          }
          const file = relativeSourcePath(filePath);
          violations.push({
            rule: "pure-machine-module",
            atom: allowlistAtom("pure-machine-module", file, source),
            file,
            detail: source,
          });
        }
      }
    }
    expectExactAllowlist("pure-machine-module", violations);
  });

  it("does not import another machine's controller, registry, manager, or provider", () => {
    const ownerModule =
      /(?:^|\/)(?:controller|registry|manager|[^/]*provider)(?:\.[^/]*)?$/i;
    const violations: string[] = [];
    for (const machine of MACHINE_DIRECTORIES) {
      const machineRoot = path.join(SOURCE_ROOT, machine);
      for (const filePath of productionFiles(machineRoot)) {
        for (const source of importsIn(filePath)) {
          const importedMachine = importedMachineFor(filePath, source);
          if (
            importedMachine !== undefined &&
            importedMachine !== machine &&
            ownerModule.test(source)
          ) {
            violations.push(
              `${relativeSourcePath(filePath)} imports ${source}`,
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("does not export writable Jotai atoms from machine projection modules", () => {
    const violations: BoundaryViolation[] = [];
    const projectionFiles = new Set(
      ALLOWLIST.filter(
        (entry) => entry.rule === "writable-projection-export",
      ).map((entry) => path.join(SOURCE_ROOT, entry.file)),
    );
    for (const machine of MACHINE_DIRECTORIES) {
      const filePath = path.join(SOURCE_ROOT, machine, "projection.ts");
      if (fs.existsSync(filePath)) projectionFiles.add(filePath);
    }
    for (const filePath of projectionFiles) {
      const sourceFile = sourceFileFor(filePath);
      const bindings = importedBindings(sourceFile);
      const exportedNames = new Set<string>();
      for (const statement of sourceFile.statements) {
        if (
          ts.isVariableStatement(statement) &&
          statement.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
          )
        ) {
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name)) {
              exportedNames.add(declaration.name.text);
            }
          }
        } else if (
          ts.isExportDeclaration(statement) &&
          !statement.moduleSpecifier &&
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause)
        ) {
          for (const element of statement.exportClause.elements) {
            exportedNames.add(element.propertyName?.text ?? element.name.text);
          }
        }
      }
      for (const statement of sourceFile.statements) {
        if (
          ts.isExportAssignment(statement) &&
          !statement.isExportEquals &&
          ts.isCallExpression(statement.expression) &&
          isJotaiAtomCall(statement.expression, bindings)
        ) {
          violations.push({
            rule: "writable-projection-export",
            atom: "<default>",
            file: relativeSourcePath(filePath),
            detail: "exported writable atom",
          });
          continue;
        }
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (
            !ts.isIdentifier(declaration.name) ||
            !exportedNames.has(declaration.name.text) ||
            !declaration.initializer ||
            !ts.isCallExpression(declaration.initializer) ||
            !isJotaiAtomCall(declaration.initializer, bindings)
          ) {
            continue;
          }
          const [read, write] = declaration.initializer.arguments;
          const writable =
            write !== undefined ||
            read === undefined ||
            (!ts.isArrowFunction(read) && !ts.isFunctionExpression(read));
          if (!writable) continue;
          const file = relativeSourcePath(filePath);
          const atom = declaration.name.text;
          const dedicatedProjectionModule =
            path.basename(filePath) === "projection.ts" &&
            machineForFile(filePath) !== undefined;
          const inventoriedLegacyProjection = ALLOWLIST.some(
            (entry) =>
              entry.rule === "writable-projection-export" &&
              entry.file === file &&
              entry.atom === atom,
          );
          if (!dedicatedProjectionModule && !inventoriedLegacyProjection) {
            continue;
          }
          violations.push({
            rule: "writable-projection-export",
            atom,
            file,
            detail: "exported writable atom",
          });
        }
      }
    }
    expectExactAllowlist("writable-projection-export", violations);
  });

  it("does not import Jotai's process-global default store at runtime", () => {
    const violations = productionFiles(SOURCE_ROOT)
      .filter((filePath) => usesRuntimeGetDefaultStore(sourceFileFor(filePath)))
      .map(relativeSourcePath);
    expect(violations).toEqual([]);
  });

  it("allows only inventoried atom projection call sites", () => {
    const violations: BoundaryViolation[] = [];
    for (const filePath of productionFiles(SOURCE_ROOT)) {
      if (filePath === path.join(SOURCE_ROOT, "state_machines/projection.ts")) {
        continue;
      }
      const file = relativeSourcePath(filePath);
      const sourceFile = sourceFileFor(filePath);
      const bindings = importedBindings(sourceFile);
      const helperBindings = new Map<string, string>();
      const namespaceBindings = new Set<string>();
      for (const [localName, binding] of bindings) {
        if (!isProjectionModuleImport(filePath, binding.source)) continue;
        if (
          binding.imported === "registerAtomWriter" ||
          binding.imported === "projectToAtom"
        ) {
          helperBindings.set(localName, binding.imported);
        } else if (binding.imported === "*") {
          namespaceBindings.add(localName);
        }
      }
      const helperReference = (node: ts.Expression): string | undefined => {
        if (ts.isIdentifier(node)) return helperBindings.get(node.text);
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          namespaceBindings.has(node.expression.text) &&
          (node.name.text === "registerAtomWriter" ||
            node.name.text === "projectToAtom")
        ) {
          return node.name.text;
        }
        return undefined;
      };
      for (const statement of sourceFile.statements) {
        if (
          !ts.isExportDeclaration(statement) ||
          !statement.moduleSpecifier ||
          !ts.isStringLiteralLike(statement.moduleSpecifier) ||
          !isProjectionModuleImport(filePath, statement.moduleSpecifier.text)
        ) {
          continue;
        }
        const names =
          statement.exportClause && ts.isNamedExports(statement.exportClause)
            ? statement.exportClause.elements
                .map(
                  (element) => element.propertyName?.text ?? element.name.text,
                )
                .filter(
                  (name) =>
                    name === "registerAtomWriter" || name === "projectToAtom",
                )
            : ["*"];
        for (const name of names) {
          violations.push({
            rule: "atom-projection-call",
            atom: "<escaped>",
            file,
            detail: `${name}:re-export`,
          });
        }
      }
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          if (
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments.length === 1 &&
            ts.isStringLiteralLike(node.arguments[0]) &&
            isProjectionModuleImport(filePath, node.arguments[0].text)
          ) {
            violations.push({
              rule: "atom-projection-call",
              atom: "<escaped>",
              file,
              detail: "*:dynamic-import",
            });
          }
          const callName = helperReference(node.expression);
          if (
            callName !== "registerAtomWriter" &&
            callName !== "projectToAtom"
          ) {
            ts.forEachChild(node, visit);
            return;
          }
          violations.push({
            rule: "atom-projection-call",
            atom: argumentName(node, 1) ?? "<dynamic>",
            file,
            detail: callName,
          });
        }
        if (ts.isIdentifier(node) && helperBindings.has(node.text)) {
          const parent = node.parent;
          const isImportName =
            ts.isImportSpecifier(parent) ||
            (ts.isImportClause(parent) && parent.name === node);
          const isDirectCall =
            ts.isCallExpression(parent) && parent.expression === node;
          if (!isImportName && !isDirectCall) {
            violations.push({
              rule: "atom-projection-call",
              atom: "<escaped>",
              file,
              detail: `${helperBindings.get(node.text)}:indirect-reference`,
            });
          }
        } else if (ts.isIdentifier(node) && namespaceBindings.has(node.text)) {
          const parent = node.parent;
          const isImportName = ts.isNamespaceImport(parent);
          const isHelperProperty =
            ts.isPropertyAccessExpression(parent) &&
            parent.expression === node &&
            helperReference(parent) !== undefined;
          if (!isImportName && !isHelperProperty) {
            violations.push({
              rule: "atom-projection-call",
              atom: "<escaped>",
              file,
              detail: "*:indirect-reference",
            });
          }
        } else if (
          ts.isPropertyAccessExpression(node) &&
          helperReference(node)
        ) {
          const parent = node.parent;
          if (!(ts.isCallExpression(parent) && parent.expression === node)) {
            violations.push({
              rule: "atom-projection-call",
              atom: "<escaped>",
              file,
              detail: `${helperReference(node)}:indirect-reference`,
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
    expectExactAllowlist("atom-projection-call", violations);
  });

  it("allows only inventoried cross-machine atom reads", () => {
    type AtomAccess = {
      atom: string;
      file: string;
      machine: MachineDirectory;
      method: "get" | "set" | "sub";
    };
    const accesses: AtomAccess[] = [];
    for (const machine of MACHINE_DIRECTORIES) {
      for (const filePath of productionFiles(path.join(SOURCE_ROOT, machine))) {
        const collectsReads = [
          "commands.ts",
          "controller.ts",
          "manager.ts",
        ].includes(path.basename(filePath));
        const sourceFile = sourceFileFor(filePath);
        const bindings = importedBindings(sourceFile);
        const visit = (node: ts.Node) => {
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            (node.expression.name.text === "get" ||
              node.expression.name.text === "set" ||
              node.expression.name.text === "sub")
          ) {
            const atom = importedArgumentName(node, 0, bindings);
            const method = node.expression.name.text;
            if (atom && (method === "set" || collectsReads)) {
              accesses.push({
                atom,
                file: relativeSourcePath(filePath),
                machine,
                method,
              });
            }
          }
          if (ts.isCallExpression(node)) {
            const callName = importedCallName(
              node,
              bindings,
              "state_machines/projection",
            );
            if (
              callName !== "registerAtomWriter" &&
              callName !== "projectToAtom"
            ) {
              ts.forEachChild(node, visit);
              return;
            }
            const atom = importedArgumentName(node, 1, bindings);
            if (atom) {
              accesses.push({
                atom,
                file: relativeSourcePath(filePath),
                machine,
                method: "set",
              });
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(sourceFile);
      }
    }

    const writers = new Map<string, Set<MachineDirectory>>();
    for (const access of accesses) {
      if (access.method !== "set") continue;
      const machines = writers.get(access.atom) ?? new Set();
      machines.add(access.machine);
      writers.set(access.atom, machines);
    }

    const violations: BoundaryViolation[] = [];
    for (const access of accesses) {
      if (access.method === "set") continue;
      const otherWriters = [...(writers.get(access.atom) ?? [])]
        .filter((writer) => writer !== access.machine)
        .sort();
      if (otherWriters.length === 0) continue;
      const detail = `${access.method}:${otherWriters.join(",")}`;
      violations.push({
        rule: "cross-machine-atom-read",
        atom: access.atom,
        file: access.file,
        detail,
      });
    }
    expectExactAllowlist("cross-machine-atom-read", violations);
  });

  it("keeps C3 renderer authorities and snapshot queue IPC deleted", () => {
    const deletedFiles = [
      "chat_stream/commands.ts",
      "chat_stream/controller.ts",
      "chat_stream/manager.ts",
      "chat_stream/main_model.ts",
      "plan_handoff/commands.ts",
      "plan_handoff/controller.ts",
      "plan_handoff/registry.ts",
      "plan_handoff/state.ts",
      "plan_handoff/transition.ts",
      "hooks/useQueuePersistence.ts",
      "ipc/handlers/queue_handlers.ts",
    ];
    for (const relativePath of deletedFiles) {
      expect(fs.existsSync(path.join(SOURCE_ROOT, relativePath))).toBe(false);
    }

    const productionSource = productionFiles(SOURCE_ROOT)
      .map((filePath) => fs.readFileSync(filePath, "utf8"))
      .join("\n");
    for (const obsoleteAuthority of [
      "queuedMessagesByIdAtom",
      "queuePausedByIdAtom",
      "getQueuedPrompts",
      "setQueuedPrompts",
      "createUserInputChatStreamFacade",
    ]) {
      expect(productionSource).not.toContain(obsoleteAuthority);
    }
  });

  it("keeps retired lifecycle atoms and mailboxes from returning", () => {
    for (const relativePath of [
      "atoms/previewRuntimeAtoms.ts",
      "store/appAtoms.ts",
    ]) {
      expect(fs.existsSync(path.join(SOURCE_ROOT, relativePath))).toBe(false);
    }

    const productionSource = productionFiles(SOURCE_ROOT)
      .map((filePath) => fs.readFileSync(filePath, "utf8"))
      .join("\n");
    for (const retiredName of [
      "isStreamingByIdAtom",
      "chatErrorByIdAtom",
      "firstPromptSagaProjectionWriteAtom",
      "firstPromptSagaAtom",
      "previewRunStateByAppIdAtom",
      "previewErrorByAppIdAtom",
      "appUrlByAppIdAtom",
      "previewReloadTokenByAppIdAtom",
      "previewAppExitByAppIdAtom",
      "consoleEntriesByAppIdAtom",
      "packageManagerWarningByAppIdAtom",
      "dismissedPackageManagerWarningAppIdsAtom",
      "currentPreviewErrorAtom",
      "currentAppUrlAtom",
      "currentPreviewReloadTokenAtom",
      "currentConsoleEntriesAtom",
      "currentPackageManagerWarningAtom",
      "setPreviewRunStateForAppAtom",
      "setPreviewErrorForAppAtom",
      "setAppUrlForAppAtom",
      "bumpPreviewReloadTokenForAppAtom",
      "setConsoleEntriesForAppAtom",
      "appendConsoleEntriesForAppAtom",
      "setPackageManagerWarningForAppAtom",
      "dismissPackageManagerWarningsAtom",
      "clearPackageManagerWarningForAppAtom",
      "clearPreviewRuntimeForAppAtom",
      "activeCheckoutCounterAtom",
      "isAnyCheckoutVersionInProgressAtom",
      "pendingScreenshotAppIdsAtom",
    ]) {
      expect(productionSource).not.toContain(retiredName);
    }
  });
});
