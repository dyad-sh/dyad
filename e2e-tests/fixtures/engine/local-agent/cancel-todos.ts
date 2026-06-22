import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Fixture for testing todo cleanup on cancellation.
 *
 * Turn 0: Agent creates 2 incomplete todos (persisted to disk).
 * Turn 1: A long-delayed text turn keeps the stream open so the test can cancel
 *         it while the todos are still visible. On cancellation, the handler
 *         should delete the persisted todos file and clear the UI list.
 */
export const fixture: LocalAgentFixture = {
  description: "Create todos, then stall so the test can cancel mid-stream",
  turns: [
    {
      text: "I'll set up a task list before starting.",
      toolCalls: [
        {
          name: "update_todos",
          args: {
            merge: false,
            todos: [
              {
                id: "todo-1",
                content: "First cancellable task",
                status: "in_progress",
              },
              {
                id: "todo-2",
                content: "Second cancellable task",
                status: "pending",
              },
            ],
          },
        },
      ],
    },
    {
      // Stall long enough for the test to click "Cancel generation".
      delayMs: 30_000,
      text: "Working on the tasks...",
    },
  ],
};
