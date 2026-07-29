import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  completionAwareDispatchOrEnqueueInventory,
  distributedDefinitionInventory,
  nonRemoteDispatchOrEnqueueInventory,
  unsafeEscapeHatchInventory,
} from "./boundary_inventory.test_support";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");

interface SemanticBoundary {
  readonly key: string;
  readonly location: string;
}

interface SurfaceInventorySpec {
  readonly declarations: ReadonlySet<string>;
  readonly declarationOnly?: ReadonlySet<string>;
  readonly owningApis?: ReadonlySet<string>;
}

function productionFiles(directory = SOURCE_ROOT): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          absolute === path.join(SOURCE_ROOT, "distributed_machines", "testing")
        ) {
          return [];
        }
        return productionFiles(absolute);
      }
      if (
        !/\.tsx?$/.test(entry.name) ||
        /\.test(?:_support)?\.tsx?$/.test(entry.name)
      ) {
        return [];
      }
      return [absolute];
    })
    .sort();
}

function normalizePath(file: string): string {
  return path.relative(SOURCE_ROOT, file).replaceAll("\\", "/");
}

function sourceFileFor(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function fixtureSource(source: string): ts.SourceFile {
  return ts.createSourceFile(
    "fixture.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function locationOf(node: ts.Node, sourceFile: ts.SourceFile): string {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return `${sourceFile.fileName.replaceAll("\\", "/")}:${line + 1}:${character + 1}`;
}

function sortedBoundaries(
  boundaries: Iterable<SemanticBoundary>,
): SemanticBoundary[] {
  return [...boundaries].sort(
    (left, right) =>
      left.key.localeCompare(right.key) ||
      left.location.localeCompare(right.location),
  );
}

function deduplicateBoundaries(
  boundaries: readonly SemanticBoundary[],
): SemanticBoundary[] {
  const byKey = new Map<string, SemanticBoundary>();
  for (const boundary of boundaries) {
    const existing = byKey.get(boundary.key);
    if (!existing || boundary.location < existing.location) {
      byKey.set(boundary.key, boundary);
    }
  }
  return sortedBoundaries(byKey.values());
}

function assertInventory(
  label: string,
  actual: readonly SemanticBoundary[],
  expected: readonly string[],
): void {
  const actualKeys = actual.map(({ key }) => key);
  try {
    expect(actualKeys).toEqual(expected);
  } catch (error) {
    const diagnostics = actual
      .map(({ key, location }) => `  ${key} @ ${location}`)
      .join("\n");
    throw new Error(
      `${label} inventory changed.\nDiscovered semantic boundaries:\n${diagnostics}`,
      { cause: error },
    );
  }
}

function propertyNameText(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return null;
}

function bindingNameText(name: ts.BindingName): string | null {
  return ts.isIdentifier(name) ? name.text : null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isSatisfiesExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function containsFunctionExpression(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (ts.isArrowFunction(child) || ts.isFunctionExpression(child)) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function functionOwnerSegment(node: ts.Node): string | null {
  if (
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return propertyNameText(node.name);
  }
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? null;
  if (
    ts.isPropertyDeclaration(node) &&
    node.initializer &&
    containsFunctionExpression(node.initializer)
  ) {
    return propertyNameText(node.name);
  }
  if (
    ts.isVariableDeclaration(node) &&
    node.initializer &&
    containsFunctionExpression(node.initializer)
  ) {
    return bindingNameText(node.name);
  }
  if (
    ts.isPropertyAssignment(node) &&
    containsFunctionExpression(node.initializer)
  ) {
    return propertyNameText(node.name);
  }
  return null;
}

function enclosingOwner(node: ts.Node): string {
  const segments: string[] = [];
  for (
    let current: ts.Node | undefined = node.parent;
    current;
    current = current.parent
  ) {
    const segment = functionOwnerSegment(current);
    if (segment) segments.push(segment);
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
      segments.push(current.name?.text ?? "anonymous-class");
    }
  }
  return [...new Set(segments.reverse())].join(".") || "module";
}

function declarationOwner(node: ts.Node, name: string): string {
  const owner = enclosingOwner(node);
  if (owner === "module") return name;
  return owner.endsWith(`.${name}`) ? owner : `${owner}.${name}`;
}

function objectPropertyPath(node: ts.Node): string | null {
  const properties: string[] = [];
  let variableName: string | null = null;
  for (
    let current: ts.Node | undefined = node.parent;
    current;
    current = current.parent
  ) {
    if (ts.isPropertyAssignment(current)) {
      const name = propertyNameText(current.name);
      if (name) properties.push(name);
    }
    if (ts.isVariableDeclaration(current)) {
      variableName = bindingNameText(current.name);
      break;
    }
  }
  if (!variableName || properties.length === 0) return null;
  return [variableName, ...properties.reverse()].join(".");
}

function expressionIdentity(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return "this";
  if (ts.isPropertyAccessExpression(expression)) {
    return `${expressionIdentity(expression.expression)}.${expression.name.text}`;
  }
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isStringLiteral(expression.argumentExpression)
  ) {
    return `${expressionIdentity(expression.expression)}.${expression.argumentExpression.text}`;
  }
  if (ts.isCallExpression(expression)) {
    return `${expressionIdentity(expression.expression)}()`;
  }
  if (ts.isParenthesizedExpression(expression)) {
    return expressionIdentity(expression.expression);
  }
  return expression.kind === ts.SyntaxKind.SuperKeyword
    ? "super"
    : ts.SyntaxKind[expression.kind];
}

function compactSyntax(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replace(/\s+/g, "");
}

function boundaryRole(node: ts.Node, sourceFile: ts.SourceFile): string {
  for (
    let current: ts.Node | undefined = node.parent;
    current;
    current = current.parent
  ) {
    if (
      ts.isArrayLiteralExpression(current) &&
      ts.isCallExpression(current.parent) &&
      current.parent.arguments.includes(current)
    ) {
      return "dependency";
    }
    if (ts.isIfStatement(current)) {
      return `when(${compactSyntax(current.expression, sourceFile)})`;
    }
    if (
      ts.isVariableDeclaration(current) &&
      !containsFunctionExpression(current)
    ) {
      return `assign(${bindingNameText(current.name) ?? "binding"})`;
    }
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      return `assign(${compactSyntax(current.left, sourceFile)})`;
    }
    if (ts.isReturnStatement(current)) return "return";
  }
  return "direct";
}

function withStableCollisionDiscriminators(
  boundaries: readonly (SemanticBoundary & { readonly role: string })[],
): SemanticBoundary[] {
  const groups = groupBy(boundaries, ({ key }) => key);
  const result: SemanticBoundary[] = [];
  for (const [baseKey, group] of groups) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    const roleGroups = groupBy(group, ({ role }) => role);
    for (const [role, sameRole] of roleGroups) {
      const sorted = [...sameRole].sort((left, right) =>
        left.location.localeCompare(right.location),
      );
      sorted.forEach((boundary, index) => {
        result.push({
          key: `${baseKey}::${role}${sorted.length === 1 ? "" : `#${index + 1}`}`,
          location: boundary.location,
        });
      });
    }
  }
  return sortedBoundaries(result);
}

function groupBy<Value, Key>(
  values: readonly Value[],
  keyFor: (value: Value) => Key,
): Map<Key, Value[]> {
  const groups = new Map<Key, Value[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key);
    if (group) {
      group.push(value);
    } else {
      groups.set(key, [value]);
    }
  }
  return groups;
}

function visitSource(
  sourceFile: ts.SourceFile,
  visitor: (node: ts.Node) => void,
): void {
  const visit = (node: ts.Node): void => {
    visitor(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => {
    if (
      ts.isPropertyAssignment(property) ||
      ts.isShorthandPropertyAssignment(property) ||
      ts.isMethodDeclaration(property)
    ) {
      return propertyNameText(property.name) === name;
    }
    return false;
  });
}

function mainRemoteDefinition(node: ts.Node): {
  readonly name: string;
  readonly declaration: ts.VariableDeclaration;
} | null {
  if (!ts.isVariableDeclaration(node) || !node.initializer) return null;
  const name = bindingNameText(node.name);
  const initializer = unwrapExpression(node.initializer);
  if (!name || !ts.isObjectLiteralExpression(initializer)) return null;
  const host = objectProperty(initializer, "host");
  if (
    !objectProperty(initializer, "id") ||
    !objectProperty(initializer, "transition") ||
    !objectProperty(initializer, "createCommandRunner") ||
    !objectProperty(initializer, "lifecycle") ||
    !objectProperty(initializer, "remote") ||
    !host ||
    !ts.isPropertyAssignment(host) ||
    !ts.isStringLiteral(host.initializer) ||
    host.initializer.text !== "main"
  ) {
    return null;
  }
  return { name, declaration: node };
}

function definitionBoundaries(
  sourceFile: ts.SourceFile,
  sourcePath: string,
): SemanticBoundary[] {
  const boundaries: SemanticBoundary[] = [];
  visitSource(sourceFile, (node) => {
    const definition = mainRemoteDefinition(node);
    if (!definition) return;
    boundaries.push({
      key: `${sourcePath}::${definition.name}`,
      location: locationOf(definition.declaration, sourceFile),
    });
  });
  return sortedBoundaries(boundaries);
}

const zodTypeNamesBySourceFile = new WeakMap<
  ts.SourceFile,
  ReadonlySet<string>
>();

function zodTypeNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const cached = zodTypeNamesBySourceFile.get(sourceFile);
  if (cached) return cached;
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "zod"
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      names.add(`${bindings.name.text}.ZodType`);
    }
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (importedName === "ZodType") names.add(element.name.text);
        if (importedName === "z") names.add(`${element.name.text}.ZodType`);
      }
    }
  }
  let addedAlias = true;
  while (addedAlias) {
    addedAlias = false;
    for (const statement of sourceFile.statements) {
      if (
        !ts.isTypeAliasDeclaration(statement) ||
        !ts.isTypeReferenceNode(statement.type) ||
        !names.has(statement.type.typeName.getText(sourceFile)) ||
        names.has(statement.name.text)
      ) {
        continue;
      }
      names.add(statement.name.text);
      addedAlias = true;
    }
  }
  zodTypeNamesBySourceFile.set(sourceFile, names);
  return names;
}

function wideningCastBoundaries(
  sourceFile: ts.SourceFile,
  sourcePath: string,
): SemanticBoundary[] {
  const boundaries: SemanticBoundary[] = [];
  visitSource(sourceFile, (node) => {
    if (
      !ts.isAsExpression(node) ||
      !ts.isTypeReferenceNode(node.type) ||
      !zodTypeNames(sourceFile).has(node.type.typeName.getText(sourceFile))
    ) {
      return;
    }
    const owner = objectPropertyPath(node) ?? enclosingOwner(node);
    boundaries.push({
      key: `${sourcePath}::${owner}`,
      location: locationOf(node, sourceFile),
    });
  });
  return sortedBoundaries(boundaries);
}

function dispatchAccess(node: ts.Node): {
  readonly kind: "call" | "access" | "destructure";
  readonly target: string;
} | null {
  if (
    ts.isPropertyAccessExpression(node) &&
    (node.name.text === "dispatch" || node.name.text === "enqueue")
  ) {
    return {
      kind:
        ts.isCallExpression(node.parent) && node.parent.expression === node
          ? "call"
          : "access",
      target: `${expressionIdentity(node.expression)}.${node.name.text}`,
    };
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteral(node.argumentExpression) &&
    (node.argumentExpression.text === "dispatch" ||
      node.argumentExpression.text === "enqueue")
  ) {
    return {
      kind:
        ts.isCallExpression(node.parent) && node.parent.expression === node
          ? "call"
          : "access",
      target: `${expressionIdentity(node.expression)}.${node.argumentExpression.text}`,
    };
  }
  if (!ts.isBindingElement(node) || !ts.isObjectBindingPattern(node.parent)) {
    return null;
  }
  const sourceName =
    node.propertyName &&
    (ts.isIdentifier(node.propertyName) ||
      ts.isStringLiteral(node.propertyName))
      ? node.propertyName.text
      : ts.isIdentifier(node.name)
        ? node.name.text
        : null;
  if (sourceName !== "dispatch" && sourceName !== "enqueue") return null;
  const declaration = node.parent.parent;
  const receiver =
    ts.isVariableDeclaration(declaration) && declaration.initializer
      ? expressionIdentity(declaration.initializer)
      : "unknown";
  const localName = ts.isIdentifier(node.name) ? node.name.text : sourceName;
  return {
    kind: "destructure",
    target: `${receiver}.${sourceName}->${localName}`,
  };
}

function dispatchBoundaries(
  sourceFile: ts.SourceFile,
  sourcePath: string,
): SemanticBoundary[] {
  const aliases: {
    readonly localName: string;
    readonly owner: string;
    readonly target: string;
  }[] = [];
  visitSource(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const access = dispatchAccess(unwrapExpression(node.initializer));
      if (access && access.kind !== "destructure") {
        aliases.push({
          localName: node.name.text,
          owner: enclosingOwner(node),
          target: access.target,
        });
      }
      return;
    }
    if (!ts.isBindingElement(node) || !ts.isIdentifier(node.name)) return;
    const access = dispatchAccess(node);
    if (!access) return;
    aliases.push({
      localName: node.name.text,
      owner: enclosingOwner(node),
      target: access.target.slice(0, access.target.lastIndexOf("->")),
    });
  });

  const boundaries: (SemanticBoundary & { readonly role: string })[] = [];
  visitSource(sourceFile, (node) => {
    const access = dispatchAccess(node);
    if (access) {
      const owner = enclosingOwner(node);
      boundaries.push({
        key: `${sourcePath}::${owner}::${access.kind}(${access.target})`,
        location: locationOf(node, sourceFile),
        role: boundaryRole(node, sourceFile),
      });
    }
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
      return;
    }
    const owner = enclosingOwner(node);
    const localName = node.expression.text;
    const alias = aliases
      .filter(
        (candidate) =>
          candidate.localName === localName &&
          (candidate.owner === "module" ||
            owner === candidate.owner ||
            owner.startsWith(`${candidate.owner}.`)),
      )
      .sort((left, right) => right.owner.length - left.owner.length)[0];
    if (!alias) return;
    boundaries.push({
      key: `${sourcePath}::${owner}::call(${alias.target}->${alias.localName})`,
      location: locationOf(node, sourceFile),
      role: boundaryRole(node, sourceFile),
    });
  });
  return withStableCollisionDiscriminators(boundaries);
}

function isDeclarationIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    ((ts.isVariableDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)) &&
      parent.name === node) ||
    (ts.isBindingElement(parent) && parent.name === node)
  );
}

function owningApiNode(node: ts.Node): ts.Node | null {
  for (
    let current: ts.Node | undefined = node.parent;
    current;
    current = current.parent
  ) {
    if (
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current) ||
      ts.isConstructorDeclaration(current) ||
      ts.isFunctionDeclaration(current)
    ) {
      return current;
    }
    if (
      (ts.isPropertyDeclaration(current) ||
        ts.isVariableDeclaration(current)) &&
      current.initializer &&
      containsFunctionExpression(current.initializer)
    ) {
      return current;
    }
  }
  return null;
}

function ownerIncluding(node: ts.Node): string {
  const ownSegment = functionOwnerSegment(node);
  const outerOwner = enclosingOwner(node);
  if (!ownSegment) return outerOwner;
  return outerOwner === "module" ? ownSegment : `${outerOwner}.${ownSegment}`;
}

function namedSurfaceBoundaries(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  spec: SurfaceInventorySpec,
): SemanticBoundary[] {
  const boundaries: SemanticBoundary[] = [];
  visitSource(sourceFile, (node) => {
    if (!ts.isIdentifier(node)) return;
    const name = node.text;
    if (spec.owningApis?.has(name) && isDeclarationIdentifier(node)) {
      boundaries.push({
        key: `${sourcePath}::${declarationOwner(node, name)}`,
        location: locationOf(node, sourceFile),
      });
      return;
    }
    if (!spec.declarations.has(name)) return;
    if (isDeclarationIdentifier(node)) {
      boundaries.push({
        key: `${sourcePath}::${declarationOwner(node, name)}`,
        location: locationOf(node, sourceFile),
      });
      return;
    }
    if (spec.declarationOnly?.has(name)) return;
    const api = owningApiNode(node);
    if (!api) return;
    boundaries.push({
      key: `${sourcePath}::${ownerIncluding(api)}::uses(${name})`,
      location: locationOf(api, sourceFile),
    });
  });
  return deduplicateBoundaries(boundaries);
}

function collectProduction(
  collect: (
    sourceFile: ts.SourceFile,
    sourcePath: string,
  ) => readonly SemanticBoundary[],
): SemanticBoundary[] {
  return sortedBoundaries(
    productionFiles().flatMap((file) =>
      collect(sourceFileFor(file), normalizePath(file)),
    ),
  );
}

const WAITER_SURFACES = {
  declarations: new Set(["settlementRejectors", "settlementWaiters"]),
  owningApis: new Set([
    "addSettlementRejector",
    "dispatchNow",
    "rejectAllSettlements",
    "rejectSettlementsForApp",
    "removeSettlementRejector",
    "resolveSettlementsForApp",
    "waitForSettlement",
  ]),
} satisfies SurfaceInventorySpec;

const SUBSCRIPTION_SURFACES = {
  declarations: new Set([
    "subscriberCount",
    "referencesPerWindow",
    "totalReferences",
    "subscriptions",
  ]),
  declarationOnly: new Set(["subscriptions"]),
  owningApis: new Set(["retainActorSubscription"]),
} satisfies SurfaceInventorySpec;

const FENCE_SURFACES = {
  declarations: new Set([
    "admissionBlockCounts",
    "creationBlockCounts",
    "deletionFences",
    "resetFenceCount",
  ]),
} satisfies SurfaceInventorySpec;

const ROUTING_SURFACES = {
  declarations: new Set([
    "initiatorByOperationId",
    "initiatorByJobId",
    "windowIdsByAppId",
  ]),
} satisfies SurfaceInventorySpec;

describe("semantic boundary inventory helpers", () => {
  it("is stable across blank lines and formatting", () => {
    const compact = fixtureSource(
      "export function hook(){return remote.dispatch(event);}",
    );
    const formatted = fixtureSource(
      [
        "",
        "export function hook() {",
        "",
        "  return remote",
        "    .dispatch(event);",
        "}",
      ].join("\n"),
    );
    expect(
      dispatchBoundaries(compact, "fixture.ts").map(({ key }) => key),
    ).toEqual(
      dispatchBoundaries(formatted, "fixture.ts").map(({ key }) => key),
    );
  });

  it("changes when a boundary moves to another owner", () => {
    const first = dispatchBoundaries(
      fixtureSource("function first(){ remote.dispatch(event); }"),
      "fixture.ts",
    );
    const second = dispatchBoundaries(
      fixtureSource("function second(){ remote.dispatch(event); }"),
      "fixture.ts",
    );
    expect(first.map(({ key }) => key)).not.toEqual(
      second.map(({ key }) => key),
    );
  });

  it("changes on same-file replacement with a different boundary", () => {
    const dispatch = dispatchBoundaries(
      fixtureSource("function send(){ remote.dispatch(event); }"),
      "fixture.ts",
    );
    const enqueue = dispatchBoundaries(
      fixtureSource("function send(){ actor.enqueue(event); }"),
      "fixture.ts",
    );
    expect(dispatch.map(({ key }) => key)).not.toEqual(
      enqueue.map(({ key }) => key),
    );
  });

  it("ignores comments and strings but finds computed and destructured access", () => {
    const sourceFile = fixtureSource(
      [
        "function send() {",
        '  const text = "remote.dispatch(event)";',
        "  // actor.enqueue(event);",
        '  queue["enqueue"](event);',
        "  const { dispatch: sendRemote } = remote;",
        "  sendRemote(event);",
        "}",
      ].join("\n"),
    );
    expect(
      dispatchBoundaries(sourceFile, "fixture.ts").map(({ key }) => key),
    ).toEqual([
      "fixture.ts::send::call(queue.enqueue)",
      "fixture.ts::send::call(remote.dispatch->sendRemote)",
      "fixture.ts::send::destructure(remote.dispatch->sendRemote)",
    ]);
  });

  it("finds imported and locally aliased ZodType casts", () => {
    const sourceFile = fixtureSource(
      [
        'import * as zod from "zod";',
        'import { z as schema, type ZodType, type ZodType as Codec } from "zod";',
        "type LocalCodec<T> = Codec<T>;",
        "export const definition = {",
        "  remote: {",
        "    direct: one as ZodType<Direct>,",
        "    namespace: two as zod.ZodType<Namespace>,",
        "    renamedNamespace: three as schema.ZodType<RenamedNamespace>,",
        "    renamedType: four as Codec<RenamedType>,",
        "    localAlias: five as LocalCodec<LocalAlias>,",
        "  },",
        "};",
      ].join("\n"),
    );
    expect(
      wideningCastBoundaries(sourceFile, "fixture.ts").map(({ key }) => key),
    ).toEqual([
      "fixture.ts::definition.remote.direct",
      "fixture.ts::definition.remote.localAlias",
      "fixture.ts::definition.remote.namespace",
      "fixture.ts::definition.remote.renamedNamespace",
      "fixture.ts::definition.remote.renamedType",
    ]);
  });

  it("finds quoted properties and extracted remote configuration", () => {
    const sourceFile = fixtureSource(
      [
        "const remoteConfig = {};",
        "export const definition = {",
        '  "id": "fixture",',
        '  "host": "main",',
        "  transition,",
        "  createCommandRunner,",
        "  lifecycle,",
        "  remote: remoteConfig,",
        "};",
      ].join("\n"),
    );
    expect(
      definitionBoundaries(sourceFile, "fixture.ts").map(({ key }) => key),
    ).toEqual(["fixture.ts::definition"]);
  });

  it("records registry declarations and owning APIs, not every reference", () => {
    const sourceFile = fixtureSource(
      [
        "const deletionFences = new Map();",
        "export function beginDeletion() {",
        "  deletionFences.set('one', true);",
        "  deletionFences.set('two', true);",
        "}",
      ].join("\n"),
    );
    expect(
      namedSurfaceBoundaries(sourceFile, "fixture.ts", FENCE_SURFACES).map(
        ({ key }) => key,
      ),
    ).toEqual([
      "fixture.ts::beginDeletion::uses(deletionFences)",
      "fixture.ts::deletionFences",
    ]);
  });
});

describe("progressive distributed-machine inventories", () => {
  it("inventories all six production distributed definitions", () => {
    assertInventory(
      "distributed definitions",
      collectProduction(definitionBoundaries),
      distributedDefinitionInventory,
    );
  });

  it("pins renderer-schema-to-internal-event widening casts", () => {
    assertInventory(
      "widening casts",
      collectProduction(wideningCastBoundaries),
      unsafeEscapeHatchInventory.wideningCasts,
    );
  });

  it("pins raw, completion-aware, and unrelated dispatch/enqueue access separately", () => {
    const actual = collectProduction(dispatchBoundaries);
    assertInventory(
      "dispatch/enqueue access",
      actual,
      [
        ...unsafeEscapeHatchInventory.rawDispatchOrEnqueue,
        ...completionAwareDispatchOrEnqueueInventory,
        ...nonRemoteDispatchOrEnqueueInventory,
      ].sort(),
    );
  });

  it("pins bespoke waiter registries and owning APIs", () => {
    assertInventory(
      "bespoke waiters",
      collectProduction((sourceFile, sourcePath) =>
        namedSurfaceBoundaries(sourceFile, sourcePath, WAITER_SURFACES),
      ),
      unsafeEscapeHatchInventory.bespokeWaiters,
    );
  });

  it("pins independent subscription/ref-count declarations and owning APIs", () => {
    assertInventory(
      "subscription/ref-count",
      collectProduction((sourceFile, sourcePath) =>
        namedSurfaceBoundaries(sourceFile, sourcePath, SUBSCRIPTION_SURFACES),
      ),
      unsafeEscapeHatchInventory.subscriptionRefCounts,
    );
  });

  it("pins deletion/reset fence declarations and owning APIs", () => {
    assertInventory(
      "deletion/reset fences",
      collectProduction((sourceFile, sourcePath) =>
        namedSurfaceBoundaries(sourceFile, sourcePath, FENCE_SURFACES),
      ),
      unsafeEscapeHatchInventory.deletionResetFences,
    );
  });

  it("pins initiator/routing map declarations and owning APIs", () => {
    assertInventory(
      "initiator/routing maps",
      collectProduction((sourceFile, sourcePath) =>
        namedSurfaceBoundaries(sourceFile, sourcePath, ROUTING_SURFACES),
      ),
      unsafeEscapeHatchInventory.initiatorRoutingMaps,
    );
  });
});
