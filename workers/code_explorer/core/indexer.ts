import * as path from "node:path";
import type { ProjectProgram } from "./program";
import {
  GraphEdge,
  GraphIndex,
  GraphNode,
  GraphNodeKind,
  TypeScriptModule,
  makeNodeId,
  normalizePath,
} from "./types";

const NODE_SYNTAX_KINDS = new Set<string>([
  "ClassDeclaration",
  "InterfaceDeclaration",
  "FunctionDeclaration",
  "MethodDeclaration",
  "MethodSignature",
  "VariableDeclaration",
  "PropertyDeclaration",
  "PropertySignature",
  "TypeAliasDeclaration",
  "EnumDeclaration",
]);

const SOURCE_FILE_EXTENSION_REGEX = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const DECLARATION_FILE_EXTENSION_REGEX = /\.d\.(?:ts|mts|cts)$/;

export function buildIndex(
  ts: TypeScriptModule,
  appPath: string,
  projects: ProjectProgram[],
): GraphIndex {
  const index: GraphIndex = {
    appPath,
    rootFileNames: [],
    nodes: new Map(),
    byName: new Map(),
    byFile: new Map(),
    edgesOut: new Map(),
    edgesIn: new Map(),
  };
  const declarationToNode = new Map<string, string>();

  for (const { program } of projects) {
    const checker = program.getTypeChecker();
    for (const sourceFile of program.getSourceFiles()) {
      if (!isInProjectSource(appPath, sourceFile.fileName)) continue;
      index.rootFileNames.push(sourceFile.fileName);
      const fileNode = addNode(index, {
        kind: "file",
        name: normalizePath(path.relative(appPath, sourceFile.fileName)),
        qualifiedName: normalizePath(
          path.relative(appPath, sourceFile.fileName),
        ),
        filePath: sourceFile.fileName,
        start: 0,
        end: sourceFile.end,
        startLine: 1,
        endLine:
          sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1,
      });

      walkDeclarations(ts, checker, index, declarationToNode, sourceFile, [
        fileNode.id,
      ]);
    }
  }

  for (const { program } of projects) {
    const checker = program.getTypeChecker();
    for (const sourceFile of program.getSourceFiles()) {
      if (!isInProjectSource(appPath, sourceFile.fileName)) continue;
      walkEdges(ts, checker, index, declarationToNode, sourceFile);
    }
  }

  return index;
}

function walkDeclarations(
  ts: TypeScriptModule,
  checker: import("typescript").TypeChecker,
  index: GraphIndex,
  declarationToNode: Map<string, string>,
  node: import("typescript").Node,
  containerStack: string[],
): void {
  const maybeNode = createGraphNode(ts, checker, index.appPath, node);
  let nextStack = containerStack;

  if (maybeNode) {
    const graphNode = addNode(index, maybeNode);
    declarationToNode.set(
      declarationKey(maybeNode.filePath, maybeNode.start),
      graphNode.id,
    );
    const container = containerStack[containerStack.length - 1];
    if (container) {
      addEdge(index, { from: container, to: graphNode.id, kind: "contains" });
    }
    nextStack = [...containerStack, graphNode.id];
  }

  ts.forEachChild(node, (child) =>
    walkDeclarations(ts, checker, index, declarationToNode, child, nextStack),
  );
}

function walkEdges(
  ts: TypeScriptModule,
  checker: import("typescript").TypeChecker,
  index: GraphIndex,
  declarationToNode: Map<string, string>,
  node: import("typescript").Node,
  currentNodeId?: string,
): void {
  const ownNode = declarationToNode.get(
    declarationKey(node.getSourceFile().fileName, node.getStart()),
  );
  const activeNodeId = ownNode ?? currentNodeId;

  if (activeNodeId) {
    if (ts.isCallExpression(node)) {
      addSymbolEdge(
        ts,
        checker,
        index,
        declarationToNode,
        activeNodeId,
        node.expression,
        "calls",
      );
    } else if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        const imported = checker.getSymbolAtLocation(moduleSpecifier);
        if (imported) {
          addResolvedSymbolEdge(
            ts,
            checker,
            index,
            declarationToNode,
            activeNodeId,
            imported,
            "imports",
          );
        }
      }
    } else if (
      ts.isIdentifier(node) &&
      !isDeclarationName(ts, node) &&
      node.text.length > 1
    ) {
      addSymbolEdge(
        ts,
        checker,
        index,
        declarationToNode,
        activeNodeId,
        node,
        "references",
      );
    } else if (
      (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
      node.heritageClauses
    ) {
      for (const clause of node.heritageClauses) {
        const kind =
          clause.token === ts.SyntaxKind.ExtendsKeyword
            ? "extends"
            : "implements";
        for (const typeNode of clause.types) {
          addSymbolEdge(
            ts,
            checker,
            index,
            declarationToNode,
            activeNodeId,
            typeNode.expression,
            kind,
          );
        }
      }
    }
  }

  ts.forEachChild(node, (child) =>
    walkEdges(ts, checker, index, declarationToNode, child, activeNodeId),
  );
}

function addSymbolEdge(
  ts: TypeScriptModule,
  checker: import("typescript").TypeChecker,
  index: GraphIndex,
  declarationToNode: Map<string, string>,
  from: string,
  node: import("typescript").Node,
  kind: GraphEdge["kind"],
): void {
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return;
  addResolvedSymbolEdge(
    ts,
    checker,
    index,
    declarationToNode,
    from,
    symbol,
    kind,
  );
}

function addResolvedSymbolEdge(
  ts: TypeScriptModule,
  checker: import("typescript").TypeChecker,
  index: GraphIndex,
  declarationToNode: Map<string, string>,
  from: string,
  symbol: import("typescript").Symbol,
  kind: GraphEdge["kind"],
): void {
  const resolved =
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  const declaration = resolved.declarations?.find((decl) =>
    isInProjectSource(index.appPath, decl.getSourceFile().fileName),
  );
  if (!declaration) return;
  const to = declarationToNode.get(
    declarationKey(
      declaration.getSourceFile().fileName,
      declaration.getStart(),
    ),
  );
  if (!to || to === from) return;
  addEdge(index, { from, to, kind });
}

function createGraphNode(
  ts: TypeScriptModule,
  checker: import("typescript").TypeChecker,
  appPath: string,
  node: import("typescript").Node,
): Omit<GraphNode, "id"> | undefined {
  const syntaxName = ts.SyntaxKind[node.kind];
  if (!NODE_SYNTAX_KINDS.has(syntaxName)) return undefined;
  if (!hasName(node)) return undefined;

  const sourceFile = node.getSourceFile();
  if (!isInProjectSource(appPath, sourceFile.fileName)) return undefined;

  const symbol = checker.getSymbolAtLocation(node.name);
  const name = symbol?.getName() ?? node.name.getText(sourceFile);
  if (!name || name === "__function") return undefined;
  const qualifiedName = symbol
    ? checker.getFullyQualifiedName(symbol).replace(/^".*"\./, "")
    : name;
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const startLine = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(end).line + 1;

  return {
    kind: graphNodeKind(ts, node),
    name,
    qualifiedName,
    filePath: sourceFile.fileName,
    start,
    end,
    startLine,
    endLine,
  };
}

function graphNodeKind(
  ts: TypeScriptModule,
  node: import("typescript").Node,
): GraphNodeKind {
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node))
    return "method";
  if (ts.isVariableDeclaration(node)) return "variable";
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node))
    return "property";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  return "variable";
}

function hasName(
  node: import("typescript").Node,
): node is import("typescript").Node & {
  name: import("typescript").DeclarationName;
} {
  return "name" in node && !!node.name;
}

function isDeclarationName(
  ts: TypeScriptModule,
  node: import("typescript").Identifier,
): boolean {
  const parent = node.parent;
  return (
    (isNamedDeclarationParent(ts, parent) || ts.isImportSpecifier(parent)) &&
    "name" in parent &&
    parent.name === node
  );
}

function isNamedDeclarationParent(
  ts: TypeScriptModule,
  node: import("typescript").Node,
): boolean {
  return (
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  );
}

function addNode(index: GraphIndex, node: Omit<GraphNode, "id">): GraphNode {
  const normalizedFile = normalizePath(
    path.relative(index.appPath, node.filePath),
  );
  const graphNode: GraphNode = {
    ...node,
    filePath: normalizedFile,
    id: makeNodeId({ ...node, filePath: normalizedFile }),
  };
  index.nodes.set(graphNode.id, graphNode);
  addMapSet(index.byName, graphNode.name.toLowerCase(), graphNode.id);
  addMapSet(index.byName, graphNode.qualifiedName.toLowerCase(), graphNode.id);
  addMapSet(index.byFile, graphNode.filePath, graphNode.id);
  return graphNode;
}

function addEdge(index: GraphIndex, edge: GraphEdge): void {
  const existing = index.edgesOut.get(edge.from) ?? [];
  if (
    existing.some(
      (candidate) => candidate.to === edge.to && candidate.kind === edge.kind,
    )
  ) {
    return;
  }
  addMapArray(index.edgesOut, edge.from, edge);
  addMapArray(index.edgesIn, edge.to, edge);
}

function addMapSet<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const values = map.get(key) ?? new Set<V>();
  values.add(value);
  map.set(key, values);
}

function addMapArray<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function declarationKey(fileName: string, start: number): string {
  return `${normalizePath(fileName)}:${start}`;
}

function isInProjectSource(appPath: string, fileName: string): boolean {
  const relative = normalizePath(path.relative(appPath, fileName));
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const segments = relative.split("/");
  if (segments.includes("node_modules")) return false;
  if (segments.includes(".dyad")) return false;
  if (DECLARATION_FILE_EXTENSION_REGEX.test(relative)) return false;
  return SOURCE_FILE_EXTENSION_REGEX.test(relative);
}
