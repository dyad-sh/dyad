import { describe, expect, it, vi } from "vitest";

import { parseFullMessage } from "@/lib/streamingMessageParser";
import { parseSubagentEvents } from "@/shared/subagent_types";
import type { AgentContext } from "./types";
import { createSubagentUiEmitter } from "./subagent_ui";

function createCtx() {
  return {
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
  } as unknown as AgentContext & {
    onXmlStream: ReturnType<typeof vi.fn>;
    onXmlComplete: ReturnType<typeof vi.fn>;
  };
}

describe("createSubagentUiEmitter", () => {
  it("streams the meta event immediately, then appends steps", () => {
    const ctx = createCtx();
    const emitter = createSubagentUiEmitter({
      type: "code-explorer",
      title: "auth flow",
      ctx,
    });

    expect(ctx.onXmlStream).toHaveBeenCalledTimes(1);

    emitter.step({
      index: 1,
      toolName: "grep",
      summary: "grep",
      status: "done",
    });
    expect(ctx.onXmlStream).toHaveBeenCalledTimes(2);
    const streamed = ctx.onXmlStream.mock.calls[1][0] as string;
    expect(streamed).toContain("<dyad-subagent");
    expect(streamed).not.toContain("</dyad-subagent>");
  });

  it("round-trips events through the streaming parser, including hostile content", () => {
    const ctx = createCtx();
    const emitter = createSubagentUiEmitter({
      type: "code-explorer",
      title: 'query with "quotes" & <angles>',
      appName: "my-app",
      ctx,
    });

    // A step whose detail contains the closing tag and XML metacharacters —
    // must not break the tag structure.
    emitter.step({
      index: 1,
      toolName: "read_file",
      summary: "read_file src/a.ts:1-10 → 1 candidate",
      detail: 'result with </dyad-subagent> and <b> & "quotes"',
      status: "done",
    });
    emitter.complete({
      summary: "high confidence · 1 file",
      data: { paths: ["src/a.ts"] },
    });

    const finalXml = ctx.onXmlComplete.mock.calls[0][0] as string;
    const { blocks } = parseFullMessage(finalXml);
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    if (block.kind !== "custom-tag") throw new Error("expected custom tag");
    expect(block.tag).toBe("dyad-subagent");
    expect(block.complete).toBe(true);
    expect(block.attributes.type).toBe("code-explorer");
    expect(block.attributes.title).toBe('query with "quotes" & <angles>');
    expect(block.attributes["app-name"]).toBe("my-app");
    expect(block.attributes.status).toBe("completed");
    expect(block.attributes["run-id"]).toMatch(/^run_[a-f0-9]{12}$/);

    const parsed = parseSubagentEvents(block.content);
    expect(parsed.meta?.title).toBe('query with "quotes" & <angles>');
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0].detail).toBe(
      'result with </dyad-subagent> and <b> & "quotes"',
    );
    expect(parsed.output?.summary).toBe("high confidence · 1 file");
    expect(parsed.output?.data).toEqual({ paths: ["src/a.ts"] });
  });

  it("parses cleanly mid-stream when the last NDJSON line is cut off", () => {
    const ctx = createCtx();
    const emitter = createSubagentUiEmitter({
      type: "code-explorer",
      title: "auth",
      ctx,
    });
    emitter.step({
      index: 1,
      toolName: "grep",
      summary: "one",
      status: "done",
    });
    emitter.step({
      index: 2,
      toolName: "grep",
      summary: "two",
      status: "done",
    });

    const streamed = ctx.onXmlStream.mock.calls.at(-1)?.[0] as string;
    // Simulate an arbitrary mid-line cutoff of the streamed prefix.
    const truncated = streamed.slice(0, streamed.length - 12);
    const { blocks } = parseFullMessage(truncated);
    const block = blocks[0];
    if (block.kind !== "custom-tag") throw new Error("expected custom tag");
    const parsed = parseSubagentEvents(block.content);
    expect(parsed.steps.length).toBeGreaterThanOrEqual(1);
    expect(parsed.steps[0].summary).toBe("one");
  });

  it("truncates oversized step detail", () => {
    const ctx = createCtx();
    const emitter = createSubagentUiEmitter({
      type: "code-explorer",
      title: "auth",
      ctx,
    });
    emitter.step({
      index: 1,
      toolName: "read_file",
      summary: "big",
      detail: "x".repeat(10_000),
      status: "done",
    });
    emitter.complete({ summary: "done", data: null });

    const finalXml = ctx.onXmlComplete.mock.calls[0][0] as string;
    const { blocks } = parseFullMessage(finalXml);
    const block = blocks[0];
    if (block.kind !== "custom-tag") throw new Error("expected custom tag");
    const parsed = parseSubagentEvents(block.content);
    expect(parsed.steps[0].detail?.length).toBeLessThan(2_100);
    expect(parsed.steps[0].detail).toContain("[truncated]");
  });

  it("commits status=error and ignores later calls once settled", () => {
    const ctx = createCtx();
    const emitter = createSubagentUiEmitter({
      type: "code-explorer",
      title: "auth",
      ctx,
    });
    emitter.error("Exploration failed: boom");
    emitter.step({
      index: 1,
      toolName: "grep",
      summary: "late",
      status: "done",
    });
    emitter.complete({ summary: "late", data: null });

    expect(ctx.onXmlComplete).toHaveBeenCalledTimes(1);
    const finalXml = ctx.onXmlComplete.mock.calls[0][0] as string;
    expect(finalXml).toContain('status="error"');
    const { blocks } = parseFullMessage(finalXml);
    const block = blocks[0];
    if (block.kind !== "custom-tag") throw new Error("expected custom tag");
    const parsed = parseSubagentEvents(block.content);
    expect(parsed.output?.summary).toBe("Exploration failed: boom");
    expect(parsed.steps).toHaveLength(0);
  });
});
