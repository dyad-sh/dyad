# Request ID Implementation - Complete Summary

## Problem Statement

Dyad Pro customers occasionally have concerns around AI requests (e.g., credit usage, bad responses). By recording and displaying the request ID, we can help users troubleshoot these issues more easily, similar to how Cursor provides request IDs.

## Implementation Status

### ✅ COMPLETED

All changes have been implemented to allow users to copy request IDs for each AI assistant response.

## Changes Made

### 1. Database Schema (`src/db/schema.ts`)

**Added:** `requestId` column to the `messages` table

```typescript
export const messages = sqliteTable("messages", {
  // ... existing columns
  requestId: text("request_id"),
  // ...
});
```

**Migration:** `drizzle/0014_needy_vertigo.sql`

```sql
ALTER TABLE `messages` ADD `request_id` text;
```

### 2. Type Definitions (`src/ipc/ipc_types.ts`)

**Updated `Message` interface:**

```typescript
export interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  approvalState?: "approved" | "rejected" | null;
  commitHash?: string | null;
  dbTimestamp?: string | null;
  createdAt?: Date | string;
  requestId?: string | null; // ← ADDED
}
```

**Updated `ChatResponseEnd` interface:**

```typescript
export interface ChatResponseEnd {
  chatId: number;
  updatedFiles: boolean;
  extraFiles?: string[];
  extraFilesError?: string;
  requestId?: string; // ← ADDED
}
```

### 3. Backend Handler (`src/ipc/handlers/chat_stream_handlers.ts`)

**Changes made:**

1. **Early Request ID Generation** (Line ~210, ~387):
   - Generate `dyadRequestId` using `uuidv4()` before creating the assistant message
   - Store it in the database when inserting the assistant message

```typescript
// Generate requestId early so it can be saved with the message
dyadRequestId = uuidv4();

// Add a placeholder assistant message immediately
const [placeholderAssistantMessage] = await db
  .insert(messages)
  .values({
    chatId: req.chatId,
    role: "assistant",
    content: "",
    requestId: dyadRequestId, // ← ADDED
  })
  .returning();
```

2. **Include in Chunk Responses** (Lines 410, 843, 1147):
   - All `chat:response:chunk` events now include `requestId`

```typescript
safeSend(event.sender, "chat:response:chunk", {
  chatId: req.chatId,
  messages: updatedChat.messages,
  requestId: dyadRequestId, // ← ADDED
});
```

3. **Include in End Responses** (Lines 1168, 1174, 1234):
   - All `chat:response:end` events now include `requestId`

```typescript
safeSend(event.sender, "chat:response:end", {
  chatId: req.chatId,
  updatedFiles: status.updatedFiles ?? false,
  extraFiles: status.extraFiles,
  extraFilesError: status.extraFilesError,
  requestId: dyadRequestId, // ← ADDED
} satisfies ChatResponseEnd);
```

### 4. IPC Client (`src/ipc/ipc_client.ts`)

**Updated chunk listener** (Line ~139):

```typescript
const { chatId, messages, requestId } = data as {
  chatId: number;
  messages: Message[];
  requestId?: string; // ← ADDED
};
```

### 5. Frontend Hook (`src/hooks/useStreamChat.ts`)

**Added logging** (Line ~101):

```typescript
onEnd: (response: ChatResponseEnd) => {
  console.log("RequestId:", response.requestId); // ← ADDED for debugging
  // ... rest of the code
};
```

### 6. UI Display (`src/components/chat/ChatMessage.tsx`)

**Added Request ID copy button** (Lines ~221-239):

- Displays a "Request ID" button next to timestamp and commit info
- Shows tooltip with first 8 characters of request ID
- Copies full request ID to clipboard on click

```typescript
{message.requestId && (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => {
            navigator.clipboard.writeText(message.requestId || "");
          }}
          className="flex items-center space-x-1 px-1 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors duration-200 cursor-pointer"
        >
          <Copy className="h-3 w-3" />
          <span className="text-xs">Request ID</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        Copy Request ID: {message.requestId.slice(0, 8)}...
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
)}
```

## User Experience

### How It Works:

1. **When a user sends a message:**

   - A unique UUID is generated as the `requestId`
   - This ID is saved with the assistant's message in the database

2. **During streaming:**

   - The `requestId` is included in every chunk update
   - The `requestId` is included in the final end event

3. **After the response is complete:**

   - The Request ID button appears below the assistant message
   - Located next to the timestamp and commit hash
   - Shows as: `[Copy Icon] Request ID`

4. **When the user clicks the Request ID button:**
   - The full UUID is copied to clipboard
   - A tooltip shows a preview (first 8 characters)
   - User can share this ID with support for troubleshooting

### Visual Location:

```
[Assistant Message Content]
---
[Copy Button]
---
[Clock Icon] 2 minutes ago | [Commit Icon] Add feature | [Copy Icon] Request ID
                                                          ↑ NEW BUTTON
```

## Database Migration

To apply the database changes, run:

```bash
npm run db:push
```

This will add the `request_id` column to the existing `messages` table.

## Testing Checklist

- [x] TypeScript compilation passes (`npm run ts:main`)
- [x] Linting passes (`npm run lint`)
- [x] Database migration generated
- [ ] Manual testing: Send a message and verify Request ID appears
- [ ] Manual testing: Click Request ID button and verify it copies to clipboard
- [ ] Manual testing: Verify Request ID persists after page reload
- [ ] Manual testing: Verify Request ID is included in error responses

## Files Modified

1. `src/db/schema.ts` - Added requestId column
2. `src/ipc/ipc_types.ts` - Added requestId to Message and ChatResponseEnd interfaces
3. `src/ipc/handlers/chat_stream_handlers.ts` - Generate and send requestId
4. `src/ipc/ipc_client.ts` - Handle requestId in responses
5. `src/hooks/useStreamChat.ts` - Log requestId for debugging
6. `src/components/chat/ChatMessage.tsx` - Display Request ID copy button
7. `drizzle/0014_needy_vertigo.sql` - Database migration

## Next Steps

1. **Apply database migration:**

   ```bash
   npm run db:push
   ```

2. **Test the implementation:**

   - Start the app
   - Send a message to an AI assistant
   - Verify the Request ID button appears
   - Click it and verify the ID is copied

3. **Optional enhancements:**
   - Add toast notification when Request ID is copied
   - Add Request ID to error messages
   - Include Request ID in chat export/download features
   - Add Request ID to analytics/telemetry

## Support Workflow

When a customer reports an issue:

1. Ask them to click the "Request ID" button on the problematic message
2. Request they share the copied ID
3. Use this ID to look up the request in backend logs/analytics
4. Investigate credit usage, error logs, or response quality issues

This matches the Cursor workflow and makes customer support significantly easier.
