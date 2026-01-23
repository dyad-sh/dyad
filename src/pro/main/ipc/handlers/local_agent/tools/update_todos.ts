import { z } from "zod";
import { ToolDefinition, AgentContext, Todo } from "./types";

const todoSchema = z.object({
  id: z.string().describe("Unique identifier for the todo item"),
  content: z
    .string()
    .optional()
    .describe("The description/content of the todo item"),
  status: z
    .enum(["pending", "in_progress", "completed"])
    .optional()
    .describe("The current status of the todo item"),
});

const updateTodosSchema = z.object({
  merge: z
    .boolean()
    .describe(
      "Whether to merge the todos with the existing todos. If true, the todos will be merged into the existing todos based on the id field. You can leave unchanged properties undefined. If false, the new todos will replace the existing todos.",
    ),
  todos: z
    .array(todoSchema)
    .describe(
      "Array of todo items. When merge is true, only include todos that need updates. When merge is false, this is the complete list.",
    ),
});
const DESCRIPTION = `
### When to Use This Tool

Use proactively for:
1. Complex multi-step tasks (3+ distinct steps)
2. Non-trivial tasks requiring careful planning
3. User explicitly requests todo list
4. User provides multiple tasks (numbered/comma-separated)
5. After completing tasks - mark complete with merge=true and add follow-ups
6. When starting new tasks - mark as in_progress (ideally only one at a time)

### When NOT to Use

Skip for:
1. Single, straightforward tasks
2. Trivial tasks with no organizational benefit
3. Tasks completable in < 3 trivial steps
4. Purely conversational/informational requests
5. Todo items should NOT include operational actions done in service of higher-level tasks.

NEVER INCLUDE THESE IN TODOS: linting; testing; searching or examining the codebase.

### Examples

<example>
User: Add dark mode toggle to settings
Assistant:
- *Creates todo list:*
1. Add state management [in_progress]
2. Implement styles
3. Create toggle component
4. Update components
- [Immediately begins working on todo 1 in the same tool call batch]
<reasoning>
Multi-step feature with dependencies.
</reasoning>
</example>

<example>
// User: Implement user registration, product catalog, shopping cart, checkout flow.
Assistant: *Creates todo list breaking down each feature into specific tasks*
<reasoning>
Multiple complex features provided as list requiring organized task management.
</reasoning>
</example>

### Task States and Management

1. **Task States:**
- pending: Not yet started
- in_progress: Currently working on
- completed: Finished successfully

2. **Task Management:**
- Update status in real-time
- Mark complete IMMEDIATELY after finishing
- Only ONE task in_progress at a time
- Complete current tasks before starting new ones

3. **Task Breakdown:**
- Create specific, actionable items
- Break complex tasks into manageable steps
- Use clear, descriptive names

4. **Parallel Todo Writes:**
- Prefer creating the first todo as in_progress
- Start working on todos by using tool calls in the same tool call batch as the todo write
- Batch todo updates with other tool calls for better latency and lower costs for the user
`;
export const updateTodosTool: ToolDefinition<
  z.infer<typeof updateTodosSchema>
> = {
  name: "update_todos",
  description: DESCRIPTION,
  inputSchema: updateTodosSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => {
    const count = args.todos.length;
    const completed = args.todos.filter((t) => t.status === "completed").length;
    return `${completed}/${count} todos completed`;
  },

  execute: async (args, ctx: AgentContext) => {
    if (args.merge) {
      // Merge todos based on id
      const existingTodosMap = new Map(ctx.todos.map((t) => [t.id, t]));
      for (const todo of args.todos) {
        const existing = existingTodosMap.get(todo.id);
        if (existing) {
          // Merge: only update defined properties
          existingTodosMap.set(todo.id, {
            ...existing,
            ...(todo.content !== undefined && { content: todo.content }),
            ...(todo.status !== undefined && { status: todo.status }),
          });
        } else {
          // New todo - require all fields
          if (todo.content === undefined || todo.status === undefined) {
            throw new Error(
              `New todo with id "${todo.id}" must have content and status defined`,
            );
          }
          existingTodosMap.set(todo.id, todo as Todo);
        }
      }
      ctx.todos = Array.from(existingTodosMap.values());
    } else {
      // Replace mode: require all fields
      for (const todo of args.todos) {
        if (todo.content === undefined || todo.status === undefined) {
          throw new Error(
            `Todo with id "${todo.id}" must have content and status defined when merge is false`,
          );
        }
      }
      ctx.todos = args.todos as Todo[];
    }

    // Send todos to renderer for UI display
    ctx.onUpdateTodos(ctx.todos);

    const completed = ctx.todos.filter((t) => t.status === "completed").length;
    const inProgressTodos = ctx.todos.filter((t) => t.status === "in_progress");
    const pendingTodos = ctx.todos.filter((t) => t.status === "pending");

    const outstandingTodos = [...inProgressTodos, ...pendingTodos];
    const outstandingList =
      outstandingTodos.length > 0
        ? `\n\nOutstanding todos:\n${outstandingTodos.map((t) => `- [${t.status}] ${t.content}`).join("\n")}`
        : "";

    return `Updated todos: ${completed} completed, ${inProgressTodos.length} in progress, ${pendingTodos.length} pending${outstandingList}`;
  },
};
