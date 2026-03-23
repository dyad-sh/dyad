import type {
  LocalAgentFixture,
  Turn,
} from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Fixture that triggers the step limit by generating 100 tool call turns.
 * The AI SDK's stepCountIs(100) will stop after 100 steps, and the handler
 * will append a <dyad-step-limit> notice to the response.
 */
const toolCallTurns: Turn[] = Array.from({ length: 100 }, (_, i) => ({
  text: `Step ${i + 1}: reading file.`,
  toolCalls: [
    {
      name: "read_file",
      args: { path: "package.json" },
    },
  ],
}));

// Final text-only turn (won't be reached because stepCountIs(100) stops first)
const finalTurn: Turn = {
  text: "All steps completed.",
};

export const fixture: LocalAgentFixture = {
  description:
    "Triggers step limit by making 50+ tool call rounds, causing a pause notification",
  turns: [...toolCallTurns, finalTurn],
};
