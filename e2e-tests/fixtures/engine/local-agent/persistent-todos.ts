import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Fixture that tests persistent todos across turns (turn 1 of 2).
 *
 * Pass 1: Agent creates 3 todos, completes only 1, writes a file, then emits
 *         text. The outer loop detects incomplete todos and sends a reminder.
 *
 * Pass 2: After receiving the todo reminder, agent acknowledges but does NOT
 *         complete the remaining todos (simulating running out of context/time).
 *
 * After both passes, 2 incomplete todos remain and are persisted to disk.
 * The follow-up test (persistent-todos-resume) sends a second prompt to verify
 * that the handler loads the persisted todos and injects a synthetic message.
 */
export const fixture: LocalAgentFixture = {
  description:
    "Turn 1: Create todos, partially complete, leave rest for next turn",
  passes: [
    {
      // First pass: Create todos and partially complete them
      turns: [
        {
          text: "I'll create a task list to track the work.",
          toolCalls: [
            {
              name: "update_todos",
              args: {
                merge: false,
                todos: [
                  {
                    id: "todo-1",
                    content: "Create utility module",
                    status: "in_progress",
                  },
                  {
                    id: "todo-2",
                    content: "Add error handling",
                    status: "pending",
                  },
                  {
                    id: "todo-3",
                    content: "Write tests",
                    status: "pending",
                  },
                ],
              },
            },
          ],
        },
        {
          text: "Let me create the utility module first.",
          toolCalls: [
            {
              name: "write_file",
              args: {
                path: "src/lib/utils.ts",
                content:
                  'export function formatDate(d: Date): string {\n  return d.toISOString();\n}\n',
                description: "Create utility module",
              },
            },
          ],
        },
        {
          text: "Marking the first task as done.",
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
          // Text-only response triggers the outer loop check.
          // Since there are still incomplete todos, it will inject a reminder.
          text: "I've completed the utility module. I'll continue with the remaining tasks.",
        },
      ],
    },
    {
      // Second pass (after todo reminder): acknowledge but don't complete.
      // This simulates running out of budget/context. The outer loop won't
      // fire again (maxTodoFollowUpLoops = 1), so the incomplete todos
      // persist to disk for the next turn.
      turns: [
        {
          text: "I see there are remaining tasks. I'll pick these up in the next turn.",
        },
      ],
    },
  ],
};
