import type { ModelMessage, ToolModelMessage } from "ai";
import { describe, expect, it } from "vitest";

import type { SubagentThreadSummary } from "@/ipc/types";

import {
  MAX_PARENT_REPORT_CHARS,
  MAX_ROOT_TOOL_CALL_INPUT_VALUE_CHARS,
  MAX_ROOT_TOOL_RESULT_CHARS,
  MAX_SUBAGENT_ASSIGNMENT_CHARS,
  MAX_SUBAGENT_CURRENT_ASSIGNMENT_CHARS,
  MAX_SUBAGENT_TOTAL_ASSISTANT_TEXT_CHARS,
  MAX_SUBAGENT_TOOL_RESULT_CHARS,
  boundAssignmentForModel,
  boundReportForParent,
  boundSubagentAssignmentsForModel,
  boundSubagentSummariesForParent,
  pruneAssistantToolCallInputs,
  pruneRootMessages,
  pruneSubagentAssistantText,
  pruneSubagentMessages,
  pruneSubagentToolResults,
  toolResultOutputToText,
  boundChatHistoryForModel,
} from "./subagent_context_budget";

function toolMessage(
  toolCallId: string,
  value: string,
  toolName = "read_file",
): ToolModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName,
        output: { type: "text", value },
      },
    ],
  };
}

function assistantText(text: string): ModelMessage {
  return { role: "assistant", content: [{ type: "text", text }] };
}

function countToolResultParts(messages: ModelMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if (message.role !== "tool") {
      continue;
    }
    const content = (message as ToolModelMessage).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "tool-result"
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function firstToolResultText(message: ModelMessage): string {
  const content = (message as ToolModelMessage).content;
  const part = content[0] as { output: { type: string; value?: string } };
  return part.output.value ?? "";
}

function makeSummary(
  overrides: Partial<SubagentThreadSummary> = {},
): SubagentThreadSummary {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "thread-1",
    chatId: 7,
    persona: "explorer",
    taskName: "Explore",
    assignment: "Look around",
    status: "completed",
    provider: "anthropic",
    model: "claude",
    reasoningEffort: "high",
    result: { report: "short report", extra: "kept" },
    reviewBaseCommit: null,
    reviewTargetCommit: null,
    reviewDiffHash: null,
    sourceMessageId: null,
    invocationSource: "model",
    remediationSource: null,
    autoFixAt: null,
    error: null,
    inputTokens: 0,
    outputTokens: 0,
    toolCallCount: 0,
    createdAt: now,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("sub-agent context budget", () => {
  describe("toolResultOutputToText", () => {
    it("flattens text and error outputs", () => {
      expect(toolResultOutputToText({ type: "text", value: "hello" })).toBe(
        "hello",
      );
      expect(
        toolResultOutputToText({ type: "error-text", value: "boom" }),
      ).toBe("boom");
    });

    it("flattens json outputs", () => {
      expect(
        toolResultOutputToText({ type: "json", value: { a: 1 } }),
      ).toContain('"a":1');
    });

    it("returns an empty string for unknown output shapes", () => {
      expect(toolResultOutputToText(undefined)).toBe("");
    });
  });

  describe("pruneSubagentToolResults", () => {
    it("returns the original array when there is nothing to prune", () => {
      const messages: ModelMessage[] = [toolMessage("1", "small")];
      expect(pruneSubagentToolResults(messages)).toBe(messages);
    });

    it("caps a single oversized tool result", () => {
      const messages: ModelMessage[] = [
        toolMessage("1", "x".repeat(MAX_SUBAGENT_TOOL_RESULT_CHARS + 5_000)),
      ];
      const pruned = pruneSubagentToolResults(messages);
      expect(pruned).not.toBe(messages);
      const text = firstToolResultText(pruned[0]);
      expect(text.length).toBeLessThanOrEqual(MAX_SUBAGENT_TOOL_RESULT_CHARS);
      expect(text).toContain("tool output truncated");
    });

    it("keeps the newest tool result and omits older ones past the budget", () => {
      const messages: ModelMessage[] = [
        toolMessage("old", "a".repeat(400)),
        toolMessage("mid", "b".repeat(400)),
        toolMessage("new", "c".repeat(400)),
      ];
      const pruned = pruneSubagentToolResults(messages, {
        maxToolResultChars: 1_000,
        maxTotalToolResultChars: 500,
      });
      // The newest result survives in full...
      expect(firstToolResultText(pruned[2])).toBe("c".repeat(400));
      // ...while the older ones are replaced by a placeholder, not deleted.
      expect(firstToolResultText(pruned[0])).toContain("omitted");
      expect(firstToolResultText(pruned[1])).toContain("omitted");
      expect(countToolResultParts(pruned)).toBe(countToolResultParts(messages));
    });

    it("never removes tool results so tool-call pairing survives", () => {
      const messages: ModelMessage[] = [
        toolMessage("1", "a".repeat(1_000)),
        toolMessage("2", "b".repeat(1_000)),
        toolMessage("3", "c".repeat(1_000)),
      ];
      const pruned = pruneSubagentToolResults(messages, {
        maxToolResultChars: 100,
        maxTotalToolResultChars: 150,
      });
      expect(countToolResultParts(pruned)).toBe(3);
      const ids = pruned.flatMap((message) => {
        if (message.role !== "tool") {
          return [];
        }
        return (message as ToolModelMessage).content.map(
          (part) => (part as { toolCallId: string }).toolCallId,
        );
      });
      expect(ids).toEqual(["1", "2", "3"]);
    });

    it("does not mutate the input messages", () => {
      const messages: ModelMessage[] = [toolMessage("1", "a".repeat(5_000))];
      const original = firstToolResultText(messages[0]);
      pruneSubagentToolResults(messages);
      expect(firstToolResultText(messages[0])).toBe(original);
    });
  });

  describe("pruneSubagentAssistantText", () => {
    it("keeps the newest assistant text and drops older prose", () => {
      const messages: ModelMessage[] = [
        assistantText("a".repeat(600)),
        assistantText("b".repeat(600)),
      ];
      const pruned = pruneSubagentAssistantText(messages, {
        maxTotalTextChars: 700,
      });
      const newest = pruned[1] as { content: Array<{ text?: string }> };
      expect(newest.content[0].text).toBe("b".repeat(600));
      const oldest = pruned[0] as { content: Array<{ text?: string }> };
      expect(oldest.content[0].text).toContain("omitted");
    });

    it("returns the original array when the budget is not exceeded", () => {
      const messages: ModelMessage[] = [assistantText("short")];
      expect(pruneSubagentAssistantText(messages)).toBe(messages);
    });

    it("does not touch tool-call parts", () => {
      const messages: ModelMessage[] = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "a".repeat(600) },
            {
              type: "tool-call",
              toolCallId: "1",
              toolName: "read_file",
              input: { path: "a.ts" },
            },
          ],
        },
        assistantText("b".repeat(600)),
      ];
      const pruned = pruneSubagentAssistantText(messages, {
        maxTotalTextChars: 700,
      });
      const first = pruned[0] as {
        content: Array<{ type: string; text?: string; input?: unknown }>;
      };
      const toolCall = first.content[1];
      expect(toolCall.type).toBe("tool-call");
      expect(toolCall.input).toEqual({ path: "a.ts" });
    });
  });

  describe("pruneSubagentMessages", () => {
    it("applies both the tool-result and the assistant-text budgets", () => {
      const messages: ModelMessage[] = [
        assistantText("a".repeat(600)),
        toolMessage("1", "b".repeat(1_000)),
        assistantText("c".repeat(600)),
      ];
      const pruned = pruneSubagentMessages(messages, {
        maxToolResultChars: 200,
        maxTotalToolResultChars: 200,
        maxTotalAssistantTextChars: 700,
      });
      expect(countToolResultParts(pruned)).toBe(1);
      const oldest = pruned[0] as { content: Array<{ text?: string }> };
      expect(oldest.content[0].text).toContain("omitted");
    });

    it("uses the default assistant-text budget", () => {
      const messages: ModelMessage[] = [
        assistantText("a".repeat(MAX_SUBAGENT_TOTAL_ASSISTANT_TEXT_CHARS)),
      ];
      expect(pruneSubagentMessages(messages)).toBe(messages);
    });
  });

  describe("boundReportForParent", () => {
    it("returns short reports unchanged", () => {
      expect(boundReportForParent("short")).toBe("short");
    });

    it("bounds long reports while keeping head and tail", () => {
      const report = `${"h".repeat(500)}\n${"t".repeat(500)}`;
      const bounded = boundReportForParent(report, 200);
      expect(bounded.length).toBeLessThanOrEqual(200);
      expect(bounded).toContain("report truncated");
      expect(bounded.startsWith("h")).toBe(true);
      expect(bounded.endsWith("t")).toBe(true);
    });

    it("uses the default cap", () => {
      const bounded = boundReportForParent("x".repeat(50_000));
      expect(bounded.length).toBeLessThanOrEqual(MAX_PARENT_REPORT_CHARS);
    });
  });

  describe("boundSubagentSummariesForParent", () => {
    it("bounds the report but keeps the other result fields", () => {
      const summaries = [
        makeSummary({
          result: { report: "x".repeat(50_000), extra: "kept" },
        }),
      ];
      const bounded = boundSubagentSummariesForParent(summaries);
      const report = bounded[0].result?.report;
      expect(typeof report).toBe("string");
      expect((report as string).length).toBeLessThanOrEqual(
        MAX_PARENT_REPORT_CHARS,
      );
      expect(bounded[0].result?.extra).toBe("kept");
    });

    it("does not mutate the input summaries", () => {
      const summaries = [
        makeSummary({ result: { report: "x".repeat(50_000) } }),
      ];
      const original = summaries[0].result?.report;
      boundSubagentSummariesForParent(summaries);
      expect(summaries[0].result?.report).toBe(original);
    });

    it("enforces a shared total budget across summaries", () => {
      const summaries = [
        makeSummary({ id: "a", result: { report: "a".repeat(5_000) } }),
        makeSummary({ id: "b", result: { report: "b".repeat(5_000) } }),
        makeSummary({ id: "c", result: { report: "c".repeat(5_000) } }),
      ];
      const bounded = boundSubagentSummariesForParent(summaries, {
        perReportChars: 5_000,
        totalReportChars: 6_000,
      });
      const total = bounded.reduce((sum, summary) => {
        const report = summary.result?.report;
        return sum + (typeof report === "string" ? report.length : 0);
      }, 0);
      expect(total).toBeLessThanOrEqual(6_000);
      expect(bounded[2].result?.report).toContain("report omitted");
    });

    it("truncates long assignments and errors", () => {
      const summaries = [
        makeSummary({
          assignment: "a".repeat(10_000),
          error: "e".repeat(10_000),
        }),
      ];
      const bounded = boundSubagentSummariesForParent(summaries);
      expect(bounded[0].assignment.length).toBeLessThan(10_000);
      expect(bounded[0].assignment).toContain("assignment truncated");
      expect(bounded[0].error).toContain("error truncated");
    });

    it("leaves summaries without a report untouched", () => {
      const summaries = [makeSummary({ result: null })];
      const bounded = boundSubagentSummariesForParent(summaries);
      expect(bounded[0].result).toBeNull();
    });
  });

  describe("boundAssignmentForModel", () => {
    it("leaves a short assignment untouched", () => {
      expect(boundAssignmentForModel("Fix the auth flow")).toBe(
        "Fix the auth flow",
      );
    });

    it("bounds a long assignment but keeps the head and the tail", () => {
      const assignment = `${"H".repeat(9_000)}TAIL-MARKER`;
      const bounded = boundAssignmentForModel(assignment);
      expect(bounded.length).toBeLessThanOrEqual(MAX_SUBAGENT_ASSIGNMENT_CHARS);
      expect(bounded).toContain("assignment truncated");
      expect(bounded.startsWith("H")).toBe(true);
      expect(bounded.endsWith("TAIL-MARKER")).toBe(true);
    });

    it("honours a custom cap", () => {
      const bounded = boundAssignmentForModel("z".repeat(1_000), 200);
      expect(bounded.length).toBeLessThanOrEqual(200);
    });
  });

  describe("boundSubagentAssignmentsForModel", () => {
    it("bounds the original assignment harder than the current one", () => {
      const bounded = boundSubagentAssignmentsForModel({
        originalAssignment: "o".repeat(20_000),
        currentAssignment: "c".repeat(90_000),
      });
      expect(bounded.originalAssignment.length).toBeLessThanOrEqual(
        MAX_SUBAGENT_ASSIGNMENT_CHARS,
      );
      expect(bounded.currentAssignment.length).toBeLessThanOrEqual(
        MAX_SUBAGENT_CURRENT_ASSIGNMENT_CHARS,
      );
      expect(bounded.currentAssignment.length).toBeGreaterThan(
        bounded.originalAssignment.length,
      );
    });

    it("leaves small assignments alone", () => {
      expect(
        boundSubagentAssignmentsForModel({
          originalAssignment: "one",
          currentAssignment: "two",
        }),
      ).toEqual({ originalAssignment: "one", currentAssignment: "two" });
    });
  });
});

function assistantToolCall(
  toolCallId: string,
  input: Record<string, unknown>,
  toolName = "write_file",
): ModelMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId,
        toolName,
        input,
      },
    ],
  };
}

function toolCallInput(message: ModelMessage, key = "content"): unknown {
  const content = (
    message as unknown as {
      content: Array<{ type: string; input?: Record<string, unknown> }>;
    }
  ).content;
  return content[0]?.input?.[key];
}

describe("pruneAssistantToolCallInputs", () => {
  it("returns the original array when nothing needs pruning", () => {
    const messages = [assistantToolCall("1", { content: "small" })];
    expect(pruneAssistantToolCallInputs(messages)).toBe(messages);
  });

  it("caps an oversized tool-call input value but keeps the other keys", () => {
    const messages = [
      assistantToolCall("1", { content: "x".repeat(50_000), path: "a.ts" }),
    ];
    const pruned = pruneAssistantToolCallInputs(messages, {
      maxInputValueChars: 1_000,
    });
    const value = String(toolCallInput(pruned[0]));
    expect(value.length).toBeLessThanOrEqual(1_000);
    expect(value).toContain("tool input truncated");
    expect(toolCallInput(pruned[0], "path")).toBe("a.ts");
  });

  it("drops older tool-call inputs once the total budget is exhausted", () => {
    const messages = [
      assistantToolCall("1", { content: "a".repeat(5_000) }),
      assistantToolCall("2", { content: "b".repeat(5_000) }),
    ];
    const pruned = pruneAssistantToolCallInputs(messages, {
      maxInputValueChars: 5_000,
      maxTotalInputChars: 5_000,
    });
    expect(String(toolCallInput(pruned[0]))).toContain("omitted");
    expect(String(toolCallInput(pruned[1]))).toBe("b".repeat(5_000));
  });

  it("never mutates the messages it is given", () => {
    const messages = [assistantToolCall("1", { content: "x".repeat(5_000) })];
    pruneAssistantToolCallInputs(messages, { maxInputValueChars: 100 });
    expect(String(toolCallInput(messages[0]))).toHaveLength(5_000);
  });

  it("leaves non-string tool-call inputs alone", () => {
    const messages = [assistantToolCall("1", { line: 42, nested: { a: 1 } })];
    expect(pruneAssistantToolCallInputs(messages)).toBe(messages);
  });

  it("is applied by the sub-agent umbrella budget", () => {
    const messages = [assistantToolCall("1", { content: "x".repeat(50_000) })];
    const pruned = pruneSubagentMessages(messages, {
      maxToolCallInputValueChars: 1_000,
    });
    expect(String(toolCallInput(pruned[0])).length).toBeLessThanOrEqual(1_000);
  });
});

describe("pruneRootMessages", () => {
  it("bounds tool results, tool-call inputs and assistant prose together", () => {
    const messages: ModelMessage[] = [
      assistantText("p".repeat(30_000)),
      assistantToolCall("1", { content: "c".repeat(60_000) }),
      toolMessage("1", "r".repeat(60_000)),
    ];
    const pruned = pruneRootMessages(messages);
    expect(String(toolCallInput(pruned[1])).length).toBeLessThanOrEqual(
      MAX_ROOT_TOOL_CALL_INPUT_VALUE_CHARS,
    );
    expect(firstToolResultText(pruned[2]).length).toBeLessThanOrEqual(
      MAX_ROOT_TOOL_RESULT_CHARS,
    );
  });

  it("returns the original array when everything is within budget", () => {
    const messages: ModelMessage[] = [
      assistantText("short"),
      assistantToolCall("1", { content: "small" }),
      toolMessage("1", "small result"),
    ];
    expect(pruneRootMessages(messages)).toBe(messages);
  });
});

describe("boundChatHistoryForModel", () => {
  it("leaves a history that fits untouched", () => {
    const history: ModelMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    expect(boundChatHistoryForModel(history, 1_000)).toBe(history);
  });

  it("drops the oldest messages first", () => {
    const history: ModelMessage[] = [
      { role: "user", content: "old" },
      { role: "assistant", content: "middle" },
      { role: "user", content: "new" },
    ];
    const bounded = boundChatHistoryForModel(history, 10);
    expect(bounded.length).toBeLessThan(history.length);
    expect(bounded.some((message) => message.content === "new")).toBe(true);
    expect(bounded.some((message) => message.content === "old")).toBe(false);
  });

  it("never drops a system message", () => {
    const history: ModelMessage[] = [
      { role: "system", content: "rules" },
      { role: "user", content: "x".repeat(500) },
    ];
    const bounded = boundChatHistoryForModel(history, 10);
    expect(bounded.some((message) => message.role === "system")).toBe(true);
  });

  it("measures structured content parts", () => {
    const history: ModelMessage[] = [
      { role: "assistant", content: [{ type: "text", text: "y".repeat(400) }] },
    ];
    const bounded = boundChatHistoryForModel(history, 50);
    expect(bounded.length).toBe(0);
  });
});
