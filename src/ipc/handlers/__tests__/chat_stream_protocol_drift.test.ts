import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const HANDLER_PATH = path.resolve(
  process.cwd(),
  "src/ipc/handlers/chat_stream_handlers.ts",
);
const HANDLER_SOURCE = fs.readFileSync(HANDLER_PATH, "utf8");
const UPDATE_MESSAGE =
  "Update src/chat_stream/main_model.ts and src/chat_stream/__tests__/cosim.chat_stream.test.ts in the same PR.";

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    HANDLER_PATH,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function descendants(node: ts.Node): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (child: ts.Node) => {
    found.push(child);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

function assertAtomicAdmission(source: string): void {
  const file = parse(source);
  const nodes = descendants(file);
  const appBarrierCheck = nodes.find(
    (node): node is ts.IfStatement =>
      ts.isIfStatement(node) &&
      node.expression
        .getText(file)
        .includes("streamAdmissionBlockCounts.get(chat.appId)"),
  );
  const markerDelete = nodes.find(
    (node): node is ts.CallExpression =>
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "admissionPendingStreams.delete" &&
      node.arguments[0]?.getText(file) === "abortController",
  );
  if (!appBarrierCheck || !markerDelete) {
    throw new Error(`Admission anchors drifted. ${UPDATE_MESSAGE}`);
  }
  const interveningAwait = nodes.find(
    (node) =>
      ts.isAwaitExpression(node) &&
      node.getStart(file) >= appBarrierCheck.end &&
      node.end <= markerDelete.getStart(file),
  );
  if (interveningAwait) {
    throw new Error(
      `An await now separates the final app-barrier check from admissionPendingStreams.delete. ${UPDATE_MESSAGE}`,
    );
  }
}

function assertSoleCancelledSender(source: string): void {
  const file = parse(source);
  const cancelledSites = descendants(file).filter((node) => {
    if (
      !ts.isCallExpression(node) ||
      node.expression.getText(file) !== "safeSend"
    ) {
      return false;
    }
    const channel = node.arguments[1];
    if (
      !channel ||
      !ts.isStringLiteralLike(channel) ||
      channel.text !== "chat:response:end"
    ) {
      return false;
    }
    let payload: ts.Expression | undefined = node.arguments[2];
    while (
      payload &&
      (ts.isSatisfiesExpression(payload) ||
        ts.isAsExpression(payload) ||
        ts.isTypeAssertionExpression(payload) ||
        ts.isParenthesizedExpression(payload))
    ) {
      payload = payload.expression;
    }
    return (
      payload !== undefined &&
      ts.isObjectLiteralExpression(payload) &&
      payload.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText(file) === "wasCancelled" &&
          property.initializer.kind === ts.SyntaxKind.TrueKeyword,
      )
    );
  });
  if (cancelledSites.length !== 1) {
    throw new Error(
      `Expected exactly one production wasCancelled: true emission site, found ${cancelledSites.length}. ${UPDATE_MESSAGE}`,
    );
  }
}

function callSendsTransportEnd(call: ts.CallExpression): boolean {
  return (
    call.arguments[1] !== undefined &&
    ts.isStringLiteralLike(call.arguments[1]) &&
    call.arguments[1].text === "chat:stream:end"
  );
}

function assertGuardedFinalTransportEnd(source: string): void {
  const file = parse(source);
  const tryStatement = descendants(file).find(
    (node): node is ts.TryStatement =>
      ts.isTryStatement(node) &&
      node.finallyBlock !== undefined &&
      descendants(node.finallyBlock).some(
        (child) => ts.isCallExpression(child) && callSendsTransportEnd(child),
      ),
  );
  const finallyBlock = tryStatement?.finallyBlock;
  const guard = finallyBlock?.statements.find(
    (statement): statement is ts.IfStatement =>
      ts.isIfStatement(statement) &&
      statement.expression.getText(file).replaceAll(" ", "") ===
        "!abortController.signal.aborted" &&
      descendants(statement).some(
        (child) => ts.isCallExpression(child) && callSendsTransportEnd(child),
      ),
  );
  if (!guard) {
    throw new Error(
      `The finally-block chat:stream:end emission is no longer guarded by !abortController.signal.aborted. ${UPDATE_MESSAGE}`,
    );
  }
}

function replaceLast(
  source: string,
  needle: string,
  replacement: string,
): string {
  const index = source.lastIndexOf(needle);
  if (index < 0) throw new Error(`Mutation anchor not found: ${needle}`);
  return (
    source.slice(0, index) + replacement + source.slice(index + needle.length)
  );
}

function replaceOnce(
  source: string,
  needle: string,
  replacement: string,
): string {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`Mutation anchor not found: ${needle}`);
  return (
    source.slice(0, index) + replacement + source.slice(index + needle.length)
  );
}

describe("chat stream protocol drift tripwire", () => {
  it("pins admission atomicity and proves its mutant trips", () => {
    expect(() => assertAtomicAdmission(HANDLER_SOURCE)).not.toThrow();
    const mutant = replaceOnce(
      HANDLER_SOURCE,
      "        admissionPendingStreams.delete(abortController);",
      "        await Promise.resolve();\n        admissionPendingStreams.delete(abortController);",
    );
    expect(() => assertAtomicAdmission(mutant)).toThrow(
      /main_model\.ts.*cosim\.chat_stream\.test\.ts/,
    );
  });

  it("pins the sole cancelled-end sender and proves its mutant trips", () => {
    expect(() => assertSoleCancelledSender(HANDLER_SOURCE)).not.toThrow();
    const mutant = `const unrelated = { wasCancelled: true };\n${replaceOnce(
      HANDLER_SOURCE,
      "wasCancelled: true,",
      "wasCancelled: false,",
    )}`;
    expect(() => assertSoleCancelledSender(mutant)).toThrow(
      /main_model\.ts.*cosim\.chat_stream\.test\.ts/,
    );
  });

  it("pins the aborted-finalizer guard and proves its mutant trips", () => {
    expect(() => assertGuardedFinalTransportEnd(HANDLER_SOURCE)).not.toThrow();
    const mutant = replaceLast(
      HANDLER_SOURCE,
      "if (!abortController.signal.aborted) {",
      "if (true) {",
    );
    expect(() => assertGuardedFinalTransportEnd(mutant)).toThrow(
      /main_model\.ts.*cosim\.chat_stream\.test\.ts/,
    );
  });
});
