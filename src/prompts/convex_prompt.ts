export function getConvexAvailableSystemPrompt(deploymentUrl: string) {
  return `
# Convex Instructions

The user has Convex available for their app so use it for any backend, database, real-time data, or server-side functions.

## What is Convex

Convex is a reactive backend-as-a-service. It provides:
- **Database**: A document-based database with automatic indexes and real-time subscriptions
- **Functions**: TypeScript server functions (queries, mutations, actions) that run on Convex's servers
- **Real-time**: All queries are automatically reactive - UI updates instantly when data changes
- **File Storage**: Built-in file storage for uploads
- **Authentication**: Easy integration with auth providers

## Convex Deployment URL

The Convex deployment URL for this project is: ${deploymentUrl}

## Project Setup

### 1. Install Dependencies

The project needs these packages:
\`\`\`
convex
\`\`\`

### 2. Convex Client Setup

Check if a Convex client provider exists. If not, set up the ConvexProvider in the app's root/entry point:

**File: \`src/main.tsx\` (or app entry)**
\`\`\`tsx
import { ConvexProvider, ConvexReactClient } from "convex/react";

const convex = new ConvexReactClient("${deploymentUrl}");

// Wrap your app with ConvexProvider
<ConvexProvider client={convex}>
  <App />
</ConvexProvider>
\`\`\`

### 3. Directory Structure

Convex functions live in the \`convex/\` directory at the project root:

\`\`\`
convex/
  _generated/     # Auto-generated types (don't edit)
  schema.ts       # Database schema definition
  [functions].ts  # Your query, mutation, and action functions
\`\`\`

## Database Schema

Define your schema in \`convex/schema.ts\`:

\`\`\`typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  tasks: defineTable({
    text: v.string(),
    isCompleted: v.boolean(),
    userId: v.string(),
  }).index("by_user", ["userId"]),
});
\`\`\`

### Convex Value Types

Use \`v\` validators for schema fields:
- \`v.string()\` - string
- \`v.number()\` - number (float64)
- \`v.boolean()\` - boolean
- \`v.id("tableName")\` - reference to another table's document
- \`v.array(v.string())\` - array
- \`v.object({ key: v.string() })\` - nested object
- \`v.optional(v.string())\` - optional field
- \`v.union(v.string(), v.number())\` - union type
- \`v.null()\` - null value
- \`v.int64()\` - 64-bit integer
- \`v.bytes()\` - binary data
- \`v.any()\` - any value (avoid when possible)

## Server Functions

### Queries (read-only, reactive)

\`\`\`typescript
import { query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});
\`\`\`

### Mutations (read-write)

\`\`\`typescript
import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: { text: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const taskId = await ctx.db.insert("tasks", {
      text: args.text,
      isCompleted: false,
      userId: args.userId,
    });
    return taskId;
  },
});
\`\`\`

### Actions (for external API calls)

\`\`\`typescript
import { action } from "./_generated/server";
import { v } from "convex/values";

export const sendEmail = action({
  args: { to: v.string(), subject: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    // Can call external APIs
    const response = await fetch("https://api.email.com/send", {
      method: "POST",
      body: JSON.stringify(args),
    });
    return await response.json();
  },
});
\`\`\`

## Using Convex in React

### Queries (reactive - UI auto-updates)

\`\`\`tsx
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

function TaskList({ userId }: { userId: string }) {
  const tasks = useQuery(api.tasks.list, { userId });

  if (tasks === undefined) return <div>Loading...</div>;

  return (
    <ul>
      {tasks.map((task) => (
        <li key={task._id}>{task.text}</li>
      ))}
    </ul>
  );
}
\`\`\`

### Mutations

\`\`\`tsx
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

function AddTask({ userId }: { userId: string }) {
  const createTask = useMutation(api.tasks.create);

  return (
    <button onClick={() => createTask({ text: "New task", userId })}>
      Add Task
    </button>
  );
}
\`\`\`

### Actions

\`\`\`tsx
import { useAction } from "convex/react";
import { api } from "../convex/_generated/api";

function SendEmailButton() {
  const sendEmail = useAction(api.emails.sendEmail);

  return (
    <button onClick={() => sendEmail({ to: "user@example.com", subject: "Hello", body: "World" })}>
      Send Email
    </button>
  );
}
\`\`\`

## Key Principles

1. **Queries are reactive**: Any component using \`useQuery\` automatically re-renders when the underlying data changes. No need for manual refetching or polling.

2. **Mutations are transactional**: All database operations in a mutation are atomic.

3. **Actions for side effects**: Use actions (not mutations) when you need to call external APIs or do non-deterministic work.

4. **Type safety**: Convex auto-generates TypeScript types from your schema. Use \`api.moduleName.functionName\` for type-safe function references.

5. **No raw SQL**: Convex uses its own query builder. Don't write SQL queries.

6. **Indexes for performance**: Define indexes in your schema for fields you query by frequently.

7. **Document IDs**: Every document has a system-generated \`_id\` field of type \`Id<"tableName">\` and a \`_creationTime\` field.

8. **File paths**: Import from \`convex/_generated/api\` for the API object, and from \`convex/_generated/server\` for \`query\`, \`mutation\`, \`action\`.

## Authentication with Convex

When the user wants authentication, use Convex's built-in auth support:

\`\`\`typescript
// In convex functions, access the authenticated user:
export const myFunction = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    // identity.subject is the user ID
    // identity.email, identity.name, etc. are available
  },
});
\`\`\`

For the client side, wrap with the appropriate auth provider (e.g., Clerk, Auth0, or Convex's own auth).
`;
}

export const CONVEX_NOT_AVAILABLE_SYSTEM_PROMPT = `
If the user wants to use Convex or wants a real-time reactive backend,
tell them that they need to add Convex to their app.

The following response will show a button that allows the user to add Convex to their app.

<dyad-add-integration provider="convex"></dyad-add-integration>

# Examples

## Example 1: User wants to use Convex

### User prompt

I want to use Convex in my app.

### Assistant response

You need to first add Convex to your app.

<dyad-add-integration provider="convex"></dyad-add-integration>
`;
