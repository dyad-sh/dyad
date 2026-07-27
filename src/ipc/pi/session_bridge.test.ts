// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import {
  parsePiTranscript,
  rebuildAgentMessages,
  serializePiTranscript,
} from "./session_bridge";

describe("pi session bridge", () => {
  it("round-trips a complete pi transcript without losing provider state", () => {
    const transcript: AgentMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
        ],
        timestamp: 1_700_000_000_000,
      },
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "I should inspect it.",
            thinkingSignature: "encrypted-thinking",
          },
          {
            type: "toolCall",
            id: "call-1",
            name: "read_file",
            arguments: { path: "src/App.tsx" },
            thoughtSignature: "signed-tool-call",
          },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-test",
        responseId: "response-1",
        usage: {
          input: 10,
          output: 5,
          cacheRead: 2,
          cacheWrite: 1,
          totalTokens: 18,
          cost: {
            input: 0.1,
            output: 0.2,
            cacheRead: 0.01,
            cacheWrite: 0.02,
            total: 0.33,
          },
        },
        stopReason: "toolUse",
        timestamp: 1_700_000_000_001,
      },
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read_file",
        content: [{ type: "text", text: "file contents" }],
        details: { xml: "<dyad-read>file contents</dyad-read>" },
        isError: false,
        timestamp: 1_700_000_000_002,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "The image shows the app." }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-test",
        usage: {
          input: 20,
          output: 8,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 28,
          cost: {
            input: 0.2,
            output: 0.3,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0.5,
          },
        },
        stopReason: "stop",
        timestamp: 1_700_000_000_003,
      },
    ];

    const stored = serializePiTranscript(transcript);

    expect(stored).toEqual({ runtime: "pi", version: 1, messages: transcript });
    expect(parsePiTranscript(stored)).toEqual(transcript);
  });

  it("rebuilds structured row fragments and annotates only the final assistant message", () => {
    const user = {
      role: "user" as const,
      content: [{ type: "text" as const, text: "Read the app" }],
      timestamp: 1000,
    };
    const toolCall = {
      role: "assistant" as const,
      content: [
        {
          type: "toolCall" as const,
          id: "call-1",
          name: "read_file",
          arguments: { path: "src/App.tsx" },
        },
      ],
      api: "anthropic-messages" as const,
      provider: "anthropic" as const,
      model: "claude-test",
      usage: zeroUsage(),
      stopReason: "toolUse" as const,
      timestamp: 1001,
    };
    const toolResult = {
      role: "toolResult" as const,
      toolCallId: "call-1",
      toolName: "read_file",
      content: [{ type: "text" as const, text: "contents" }],
      isError: false,
      timestamp: 1002,
    };
    const answer = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "Done" }],
      api: "anthropic-messages" as const,
      provider: "anthropic" as const,
      model: "claude-test",
      usage: zeroUsage(),
      stopReason: "stop" as const,
      timestamp: 1003,
    };

    const rebuilt = rebuildAgentMessages([
      {
        id: 1,
        role: "user",
        content: "display text",
        aiMessagesJson: serializePiTranscript([user]),
        createdAt: new Date(1000),
        isCompactionSummary: false,
      },
      {
        id: 2,
        role: "assistant",
        content: "display response",
        aiMessagesJson: serializePiTranscript([toolCall, toolResult, answer]),
        commitHash: "abc&123",
        createdAt: new Date(1003),
        isCompactionSummary: false,
      },
    ]);

    expect(rebuilt.slice(0, 3)).toEqual([user, toolCall, toolResult]);
    expect(rebuilt[3]).toEqual({
      ...answer,
      content: [
        { type: "text", text: "Done" },
        {
          type: "text",
          text: '<dyad-git-context commit="abc&amp;123"></dyad-git-context>',
        },
      ],
    });
  });

  it("converts legacy AI SDK history into paired pi messages", () => {
    const rebuilt = rebuildAgentMessages([
      {
        id: 7,
        role: "assistant",
        content: "fallback",
        model: "claude-legacy",
        createdAt: new Date(2000),
        isCompactionSummary: false,
        aiMessagesJson: {
          sdkVersion: "ai@v6",
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "reasoning",
                  text: "Inspect first",
                  providerMetadata: {
                    anthropic: { signature: "legacy-thinking-signature" },
                  },
                },
                {
                  type: "tool-call",
                  toolCallId: "legacy-call",
                  toolName: "read_file",
                  input: { path: "src/App.tsx" },
                  providerMetadata: {
                    anthropic: { signature: "legacy-tool-signature" },
                  },
                },
              ],
            },
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: "legacy-call",
                  toolName: "read_file",
                  output: { type: "text", value: "legacy contents" },
                },
              ],
            },
            {
              role: "assistant",
              content: [{ type: "text", text: "Legacy done" }],
            },
          ],
        },
      },
    ]);

    expect(rebuilt).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "Inspect first",
            thinkingSignature: "legacy-thinking-signature",
          },
          {
            type: "toolCall",
            id: "legacy-call",
            name: "read_file",
            arguments: { path: "src/App.tsx" },
            thoughtSignature: "legacy-tool-signature",
          },
        ],
        api: "openai-completions",
        provider: "unknown",
        model: "claude-legacy",
        usage: zeroUsage(),
        stopReason: "toolUse",
        timestamp: 2000,
      },
      {
        role: "toolResult",
        toolCallId: "legacy-call",
        toolName: "read_file",
        content: [{ type: "text", text: "legacy contents" }],
        isError: false,
        timestamp: 2001,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Legacy done" }],
        api: "openai-completions",
        provider: "unknown",
        model: "claude-legacy",
        usage: zeroUsage(),
        stopReason: "stop",
        timestamp: 2002,
      },
    ]);
  });

  it("repairs interrupted tool-call history without discarding the aborted assistant message", () => {
    const interruptedAssistant = {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "Reading files" },
        {
          type: "toolCall" as const,
          id: "call-missing",
          name: "read_file",
          arguments: { path: "missing.ts" },
        },
        {
          type: "toolCall" as const,
          id: "call-complete",
          name: "read_file",
          arguments: { path: "complete.ts" },
        },
      ],
      api: "anthropic-messages" as const,
      provider: "anthropic" as const,
      model: "claude-test",
      usage: zeroUsage(),
      stopReason: "aborted" as const,
      errorMessage: "Cancelled by user",
      timestamp: 3000,
    };
    const completedResult = {
      role: "toolResult" as const,
      toolCallId: "call-complete",
      toolName: "read_file",
      content: [{ type: "text" as const, text: "complete contents" }],
      isError: false,
      timestamp: 3002,
    };
    const injectedUser = {
      role: "user" as const,
      content: "Please continue",
      timestamp: 3001,
    };

    const rebuilt = rebuildAgentMessages([
      {
        id: 8,
        role: "assistant",
        content: "Reading files",
        createdAt: new Date(3000),
        aiMessagesJson: serializePiTranscript([
          interruptedAssistant,
          injectedUser,
          completedResult,
        ]),
      },
    ]);

    expect(rebuilt[0]).toEqual(interruptedAssistant);
    expect(rebuilt[1]).toMatchObject({
      role: "toolResult",
      toolCallId: "call-missing",
      toolName: "read_file",
      isError: true,
      details: { interrupted: true },
    });
    expect(rebuilt[2]).toEqual(completedResult);
    expect(rebuilt[3]).toEqual(injectedUser);
  });

  it("restores only the latest compaction boundary and keeps a mid-turn summary after its user prompt", () => {
    const rebuilt = rebuildAgentMessages([
      {
        id: 1,
        role: "user",
        content: "old user",
        createdAt: new Date(1000),
        isCompactionSummary: false,
      },
      {
        id: 2,
        role: "assistant",
        content: "old answer",
        createdAt: new Date(1001),
        isCompactionSummary: false,
      },
      {
        id: 3,
        role: "user",
        content: "current request",
        createdAt: new Date(2000),
        isCompactionSummary: false,
      },
      {
        id: 4,
        role: "assistant",
        content: "current answer",
        createdAt: new Date(2001),
        isCompactionSummary: false,
      },
      {
        id: 5,
        role: "assistant",
        content: "<dyad-compaction>summary</dyad-compaction>",
        createdAt: new Date(2002),
        isCompactionSummary: true,
      },
    ]);

    expect(
      rebuilt.map((message) => {
        if (!("content" in message)) return "";
        if (typeof message.content === "string") return message.content;
        return message.content
          .filter(
            (part): part is Extract<typeof part, { type: "text" }> =>
              part.type === "text",
          )
          .map((part) => part.text)
          .join("");
      }),
    ).toEqual([
      "current request",
      "<dyad-compaction>summary</dyad-compaction>",
      "current answer",
    ]);
  });

  it("falls back to DB display content when persisted data is malformed or from an unknown version", () => {
    const rebuilt = rebuildAgentMessages([
      {
        id: 10,
        role: "user",
        content: "safe user fallback",
        createdAt: new Date(4000),
        aiMessagesJson: {
          runtime: "pi",
          version: 1,
          messages: [{ role: "user", content: { invalid: true } }],
        },
      },
      {
        id: 11,
        role: "assistant",
        content: "safe assistant fallback",
        model: "fallback-model",
        createdAt: new Date(4001),
        aiMessagesJson: {
          runtime: "pi",
          version: 2,
          messages: [],
        },
      },
    ]);

    expect(rebuilt[0]).toMatchObject({
      role: "user",
      content: "safe user fallback",
      timestamp: 4000,
    });
    expect(rebuilt[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "safe assistant fallback" }],
      model: "fallback-model",
      timestamp: 4001,
    });
  });
});

function zeroUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
