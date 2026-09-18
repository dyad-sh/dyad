import { expect, it } from "vitest";
import {
  modelForChatBackend,
  requiresNewChatForModel,
} from "./execution_backend";

it.each([
  { messages: [], provider: "claude-code", expected: false },
  { messages: [], provider: "openai", expected: false },
  { messages: [{}], provider: "claude-code", expected: true },
  { messages: [{}], provider: "openai", expected: false },
  {
    messages: [{ executionBackend: "dyad" as const }],
    provider: "claude-code",
    expected: true,
  },
  {
    messages: [{ executionBackend: "dyad" as const }],
    provider: "openai",
    expected: false,
  },
  {
    messages: [{}, { executionBackend: "claude-code" as const }],
    provider: "claude-code",
    expected: false,
  },
  {
    messages: [{}, { executionBackend: "claude-code" as const }],
    provider: "openai",
    expected: true,
  },
])(
  "requires a new chat: $messages → $provider = $expected",
  ({ messages, provider, expected }) => {
    expect(requiresNewChatForModel(messages, { provider })).toBe(expected);
  },
);
it("keeps legacy Dyad chats on their backend when the global default is Claude", () => {
  const selectedModel = { provider: "claude-code", name: "sonnet" };
  const previous = { provider: "anthropic", name: "claude-sonnet" };
  expect(
    modelForChatBackend(
      { executionBackend: "dyad" },
      { selectedModel, recentModels: [selectedModel, previous] },
    ),
  ).toEqual(previous);
  expect(
    modelForChatBackend({ executionBackend: "dyad" }, { selectedModel }),
  ).toEqual({ provider: "auto", name: "auto" });
  expect(
    modelForChatBackend(null, {
      selectedModel,
      enableClaudeCodeSubscription: true,
    }),
  ).toEqual(selectedModel);
  expect(modelForChatBackend(null, { selectedModel })).toEqual({
    provider: "auto",
    name: "auto",
  });
  expect(
    modelForChatBackend(
      {
        executionBackend: "dyad",
        modelSelection: { ...previous, effortLevel: "medium" },
      },
      { selectedModel },
    ),
  ).toMatchObject(previous);
});
