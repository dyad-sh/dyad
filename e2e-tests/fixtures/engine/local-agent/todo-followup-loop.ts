import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Fixture that tests the outer loop todo follow-up behavior:
 *
 * Pass 1: Agent creates 3 todos, completes only 1 of them, then emits chat text.
 *         The outer loop detects incomplete todos and sends a reminder.
 *
 * Pass 2: After receiving the todo reminder, agent completes the remaining 2 todos.
 *
 * This tests that the outer loop correctly:
 * 1. Detects incomplete todos after a pass
 * 2. Injects a reminder message
 * 3. Runs another pass to allow the agent to complete remaining work
 */
export const fixture: LocalAgentFixture = {
  description: "Test outer loop todo follow-up when todos are partially complete",
  passes: [
    {
      // First pass: Create todos and partially complete them
      turns: [
        {
          text: "I'll create a todo list to track these tasks.",
          toolCalls: [
            {
              name: "update_todos",
              args: {
                merge: false,
                todos: [
                  {
                    id: "todo-1",
                    content: "Create utility function",
                    status: "in_progress",
                  },
                  {
                    id: "todo-2",
                    content: "Write unit tests",
                    status: "pending",
                  },
                  {
                    id: "todo-3",
                    content: "Update documentation",
                    status: "pending",
                  },
                ],
              },
            },
          ],
        },
        {
          text: "Let me create the utility function first.",
          toolCalls: [
            {
              name: "write_file",
              args: {
                path: "src/utils/helper.ts",
                content:
                  "export function helper(x: number): number {\n  return x * 2;\n}\n",
                description: "Create helper utility function",
              },
            },
          ],
        },
        {
          text: "Now marking the first task as done.",
          toolCalls: [
            {
              name: "update_todos",
              args: {
                merge: true,
                todos: [
                  {
                    id: "todo-1",
                    status: "completed",
                  },
                ],
              },
            },
          ],
        },
        {
          // This text-only response triggers the outer loop check.
          // Since there are still incomplete todos, it will inject a reminder.
          text: "I've completed the utility function. Let me continue with the remaining tasks.",
        },
      ],
    },
    {
      // Second pass: After receiving todo reminder, complete remaining tasks
      turns: [
        {
          text: "I see there are still incomplete todos. Let me write the unit tests.",
          toolCalls: [
            {
              name: "write_file",
              args: {
                path: "src/utils/helper.test.ts",
                content:
                  'import { helper } from "./helper";\n\ntest("helper doubles input", () => {\n  expect(helper(5)).toBe(10);\n});\n',
                description: "Create unit tests for helper",
              },
            },
          ],
        },
        {
          text: "Marking tests as done.",
          toolCalls: [
            {
              name: "update_todos",
              args: {
                merge: true,
                todos: [
                  {
                    id: "todo-2",
                    status: "completed",
                  },
                ],
              },
            },
          ],
        },
        {
          text: "Now updating the documentation.",
          toolCalls: [
            {
              name: "write_file",
              args: {
                path: "src/utils/README.md",
                content:
                  "# Utils\n\n## helper(x)\n\nDoubles the input number.\n",
                description: "Update documentation",
              },
            },
          ],
        },
        {
          text: "Marking documentation as done.",
          toolCalls: [
            {
              name: "update_todos",
              args: {
                merge: true,
                todos: [
                  {
                    id: "todo-3",
                    status: "completed",
                  },
                ],
              },
            },
          ],
        },
        {
          // All todos complete - no more follow-up passes
          text: "All tasks are now complete! I've created the utility function, written unit tests, and updated the documentation.",
        },
      ],
    },
  ],
};
