import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  nonRemoteDispatchOrEnqueueInventory,
  unsafeEscapeHatchInventory,
} from "./boundary_inventory.test_support";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");

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

function relative(file: string): string {
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

function syntaxLocationsMatching(
  predicate: (node: ts.Node, sourceFile: ts.SourceFile) => boolean,
): string[] {
  return productionFiles()
    .flatMap((file) => {
      const sourceFile = sourceFileFor(file);
      return syntaxLocationsInSource(sourceFile, relative(file), predicate);
    })
    .sort();
}

function syntaxLocationsInSource(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  predicate: (node: ts.Node, sourceFile: ts.SourceFile) => boolean,
): string[] {
  const locations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node, sourceFile)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      locations.push(`${sourcePath}:${line + 1}:${character + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return locations;
}

function identifierLocationsMatching(pattern: RegExp): string[] {
  return syntaxLocationsMatching(
    (node) => ts.isIdentifier(node) && pattern.test(node.text),
  );
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

function isZodTypeWideningCast(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): boolean {
  return (
    ts.isAsExpression(node) &&
    ts.isTypeReferenceNode(node.type) &&
    zodTypeNames(sourceFile).has(node.type.typeName.getText(sourceFile))
  );
}

function isDispatchOrEnqueueAccess(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === "dispatch" || node.name.text === "enqueue";
  }
  return (
    (ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      (node.argumentExpression.text === "dispatch" ||
        node.argumentExpression.text === "enqueue")) ||
    (ts.isBindingElement(node) &&
      ts.isObjectBindingPattern(node.parent) &&
      ((node.propertyName !== undefined &&
        (ts.isIdentifier(node.propertyName) ||
          ts.isStringLiteral(node.propertyName)) &&
        (node.propertyName.text === "dispatch" ||
          node.propertyName.text === "enqueue")) ||
        (node.propertyName === undefined &&
          ts.isIdentifier(node.name) &&
          (node.name.text === "dispatch" || node.name.text === "enqueue"))))
  );
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

function isMainRemoteDefinitionObject(node: ts.Node): boolean {
  if (!ts.isVariableDeclaration(node) || !node.initializer) return false;
  const initializer = unwrapExpression(node.initializer);
  if (!ts.isObjectLiteralExpression(initializer)) return false;

  const host = objectProperty(initializer, "host");
  return (
    !!objectProperty(initializer, "id") &&
    !!objectProperty(initializer, "transition") &&
    !!objectProperty(initializer, "createCommandRunner") &&
    !!objectProperty(initializer, "lifecycle") &&
    !!objectProperty(initializer, "remote") &&
    !!host &&
    ts.isPropertyAssignment(host) &&
    ts.isStringLiteral(host.initializer) &&
    host.initializer.text === "main"
  );
}

function containsMainRemoteDefinition(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (isMainRemoteDefinitionObject(node)) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

describe("progressive distributed-machine inventories", () => {
  it("inventories all six production distributed definitions", () => {
    expect(
      productionFiles()
        .filter((file) => containsMainRemoteDefinition(sourceFileFor(file)))
        .map(relative)
        .sort(),
    ).toEqual([
      "app_run/definition.ts",
      "chat_stream/definition.ts",
      "ipc/services/github_ops_definition.ts",
      "ipc/services/image_generation_definition.ts",
      "ipc/services/version_preview_definition.ts",
      "plan_handoff/definition.ts",
    ]);
  });

  it("discovers quoted properties and extracted remote configuration", () => {
    const sourceFile = ts.createSourceFile(
      "fixture.ts",
      [
        "const remoteConfig = {};",
        "const definition = {",
        '  "id": "fixture",',
        '  "host": "main",',
        "  transition,",
        "  createCommandRunner,",
        "  lifecycle,",
        "  remote: remoteConfig,",
        "};",
      ].join("\n"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    expect(containsMainRemoteDefinition(sourceFile)).toBe(true);
  });

  it("pins renderer-schema-to-internal-event widening casts", () => {
    expect(syntaxLocationsMatching(isZodTypeWideningCast)).toEqual(
      unsafeEscapeHatchInventory.wideningCasts,
    );
  });

  it("discovers imported and locally aliased ZodType casts", () => {
    const sourceFile = ts.createSourceFile(
      "fixture.ts",
      [
        'import { z as schema, type ZodType as Codec } from "zod";',
        "type LocalCodec<T> = Codec<T>;",
        "first as schema.ZodType<First>;",
        "second as Codec<Second>;",
        "third as LocalCodec<Third>;",
      ].join("\n"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    expect(
      syntaxLocationsInSource(sourceFile, "fixture.ts", isZodTypeWideningCast),
    ).toEqual(["fixture.ts:3:1", "fixture.ts:4:1", "fixture.ts:5:1"]);
  });

  it("pins raw remote dispatch and enqueue access sites", () => {
    const allLocations = syntaxLocationsMatching(isDispatchOrEnqueueAccess);
    expect(allLocations).toEqual(
      [
        ...unsafeEscapeHatchInventory.rawDispatchOrEnqueue,
        ...nonRemoteDispatchOrEnqueueInventory,
      ].sort(),
    );
  });

  it("discovers syntax nodes rather than comment or string tokens", () => {
    const sourceFile = ts.createSourceFile(
      "fixture.ts",
      [
        '// actor.dispatch({ type: "COMMENT" });',
        'const text = "actor.enqueue()";',
        'actor.dispatch({ type: "REAL" });',
        'queue["enqueue"]({ type: "COMPUTED" });',
        "const { dispatch: send } = actor;",
        "const { enqueue } = queue;",
      ].join("\n"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    expect(
      syntaxLocationsInSource(
        sourceFile,
        "fixture.ts",
        isDispatchOrEnqueueAccess,
      ),
    ).toEqual([
      "fixture.ts:3:1",
      "fixture.ts:4:1",
      "fixture.ts:5:9",
      "fixture.ts:6:9",
    ]);
  });

  it("pins bespoke waiter registries", () => {
    expect(
      identifierLocationsMatching(
        /settlementWaiters|waitForSettlement|resolveSettlementsForApp/,
      ),
    ).toEqual(unsafeEscapeHatchInventory.bespokeWaiters);
  });

  it("pins independent subscription and ref-count implementations", () => {
    expect(
      syntaxLocationsMatching(
        (node) =>
          ts.isIdentifier(node) &&
          (/subscriberCount|referencesPerWindow|totalReferences|retainActorSubscription/.test(
            node.text,
          ) ||
            (node.text === "subscriptions" &&
              (ts.isPropertyDeclaration(node.parent) ||
                ts.isVariableDeclaration(node.parent)) &&
              !!node.parent.initializer &&
              ts.isNewExpression(node.parent.initializer) &&
              node.parent.initializer.expression.getText() === "Map")),
      ),
    ).toEqual(unsafeEscapeHatchInventory.subscriptionRefCounts);
  });

  it("pins deletion and reset fences", () => {
    expect(
      identifierLocationsMatching(
        /admissionBlockCounts|creationBlockCounts|deletionFences|resetFenceCount/,
      ),
    ).toEqual(unsafeEscapeHatchInventory.deletionResetFences);
  });

  it("pins initiator and routing maps", () => {
    expect(
      identifierLocationsMatching(
        /initiatorBy(?:OperationId|JobId)|windowIdsByAppId/,
      ),
    ).toEqual(unsafeEscapeHatchInventory.initiatorRoutingMaps);
  });
});
