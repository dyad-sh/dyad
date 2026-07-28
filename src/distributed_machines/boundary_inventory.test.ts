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

function pathsMatching(
  predicate: (source: string, file: string) => boolean,
): string[] {
  return productionFiles()
    .filter((file) => predicate(fs.readFileSync(file, "utf8"), file))
    .map(relative)
    .sort();
}

function syntaxLocationsMatching(
  predicate: (node: ts.Node) => boolean,
): string[] {
  return productionFiles()
    .flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      return syntaxLocationsInSource(sourceFile, relative(file), predicate);
    })
    .sort();
}

function syntaxLocationsInSource(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  predicate: (node: ts.Node) => boolean,
): string[] {
  const locations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node)) {
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

function isDispatchOrEnqueueAccess(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === "dispatch" || node.name.text === "enqueue";
  }
  return (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteral(node.argumentExpression) &&
    (node.argumentExpression.text === "dispatch" ||
      node.argumentExpression.text === "enqueue")
  );
}

describe("progressive distributed-machine inventories", () => {
  it("inventories all six production distributed definitions", () => {
    expect(
      pathsMatching(
        (source) =>
          source.includes("createCommandRunner") &&
          source.includes("remote: {") &&
          source.includes('host: "main"'),
      ),
    ).toEqual([
      "app_run/definition.ts",
      "chat_stream/definition.ts",
      "ipc/services/github_ops_definition.ts",
      "ipc/services/image_generation_definition.ts",
      "ipc/services/version_preview_definition.ts",
      "plan_handoff/definition.ts",
    ]);
  });

  it("pins renderer-schema-to-internal-event widening casts", () => {
    expect(
      syntaxLocationsMatching(
        (node) =>
          ts.isAsExpression(node) &&
          ts.isTypeReferenceNode(node.type) &&
          ts.isQualifiedName(node.type.typeName) &&
          node.type.typeName.left.getText() === "z" &&
          node.type.typeName.right.text === "ZodType",
      ),
    ).toEqual(unsafeEscapeHatchInventory.wideningCasts);
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
    ).toEqual(["fixture.ts:3:1", "fixture.ts:4:1"]);
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
