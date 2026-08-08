import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Fixture that tests persistent todos across turns (turn 2 of 2).
 *
 * This runs after persistent-todos.ts which left 2 incomplete todos on disk:
 *   - todo-2: "Add error handling" (pending)
 *   - todo-3: "Write tests" (pending)
 *
 * The handler loads these from .dyad/todos/<chatId>.json and injects a
 * synthetic "[System] You have unfinished todos..." user message before
 * this prompt. The agent then picks up the remaining work and completes
 * all todos.
 */
export const fixture: LocalAgentFixture = {
  description: "Turn 2: Resume and complete persisted todos from previous turn",
  turns: [
    {
      text: "I see there are unfinished todos from last time. Let me continue.",
      toolCalls: [
        {
          name: "update_todos",
          args: {
            merge: true,
            todos: [
              {
                id: "todo-2",
                status: "in_progress",
              },
            ],
          },
        },
      ],
    },
    {
      text: "Adding error handling to the utility module.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/lib/utils.ts",
            content:
              'export function formatDate(d: Date): string {\n  return d.toISOString();\n}\n\nexport function safeParseJSON(str: string): unknown {\n  try {\n    return JSON.parse(str);\n  } catch {\n    return null;\n  }\n}\n',
            description: "Add error handling utility",
          },
        },
      ],
    },
    {
      text: "Now writing the tests.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/lib/utils.test.ts",
            content:
              'import { formatDate, safeParseJSON } from "./utils";\n\ntest("formatDate returns ISO string", () => {\n  const d = new Date("2024-01-01");\n  expect(formatDate(d)).toBe("2024-01-01T00:00:00.000Z");\n});\n\ntest("safeParseJSON parses valid JSON", () => {\n  expect(safeParseJSON(\'{"a":1}\')).toEqual({ a: 1 });\n});\n\ntest("safeParseJSON returns null for invalid JSON", () => {\n  expect(safeParseJSON("not json")).toBeNull();\n});\n',
            description: "Write tests for utility module",
          },
        },
      ],
    },
    {
      text: "Marking all remaining tasks as done.",
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
      text: "All tasks from the previous turn are now complete! I created the utility module, added error handling, and wrote the tests.",
    },
  ],
};
