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
  "Update src/chat_stream/host_transition.ts and src/chat_stream/main_actor.test.ts in the same PR.";

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

function assertExecutionDoesNotSendTerminals(source: string): void {
  const file = parse(source);
  const execution = descendants(file).find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "executeAdmittedChatTurn",
  );
  if (!execution)
    throw new Error(`Execution boundary moved. ${UPDATE_MESSAGE}`);
  const terminalSend = descendants(execution).some(
    (node) =>
      ts.isCallExpression(node) &&
      node.arguments.some(
        (argument) =>
          ts.isStringLiteralLike(argument) &&
          [
            "chat:response:end",
            "chat:response:error",
            "chat:stream:end",
          ].includes(argument.text),
      ),
  );
  if (terminalSend)
    throw new Error(
      `Execution must return typed outcomes, not renderer terminals. ${UPDATE_MESSAGE}`,
    );
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
      "admissionPendingStreams.delete(abortController);",
      "await Promise.resolve();\n      admissionPendingStreams.delete(abortController);",
    );
    expect(() => assertAtomicAdmission(mutant)).toThrow(
      /host_transition\.ts.*main_actor\.test\.ts/,
    );
  });

  it("pins the sole cancelled-end sender and proves its mutant trips", () => {
    expect(() => assertSoleCancelledSender(HANDLER_SOURCE)).not.toThrow();
    const mutant = `const unrelated = { wasCancelled: true };\n${replaceLast(
      HANDLER_SOURCE,
      "wasCancelled: true,",
      "wasCancelled: false,",
    )}`;
    expect(() => assertSoleCancelledSender(mutant)).toThrow(
      /host_transition\.ts.*main_actor\.test\.ts/,
    );
  });

  it("keeps renderer terminals outside execution and proves its mutant trips", () => {
    expect(() =>
      assertExecutionDoesNotSendTerminals(HANDLER_SOURCE),
    ).not.toThrow();
    const mutant = replaceOnce(
      HANDLER_SOURCE,
      "resolveCompletion();",
      'safeSend(presentation.sender, "chat:stream:end", { chatId: req.chatId }); resolveCompletion();',
    );
    expect(() => assertExecutionDoesNotSendTerminals(mutant)).toThrow(
      /host_transition\.ts.*main_actor\.test\.ts/,
    );
  });
});
