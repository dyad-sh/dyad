# OpenAI Reasoning Model Errors

When using OpenAI reasoning models (o1, o3, o4-mini) via LiteLLM/Azure, you may see:

```
Item 'rs_...' of type 'reasoning' was provided without its required following item.
```

OpenAI's Responses API requires reasoning items to always be followed by an output item (text, tool-call). This error occurs when:

- The model produces reasoning then immediately makes tool calls (no text between)
- The stream is interrupted after reasoning but before output
- Only reasoning was generated in a turn

The fix in `src/ipc/utils/ai_messages_utils.ts` filters orphaned reasoning parts via `filterOrphanedReasoningParts()` before sending conversation history back to OpenAI.

## "Item with id ... not found" errors

OpenAI may return `Item with id 'rs_...' not found` when stale `itemId` references exist in provider metadata. The codebase handles this with a **retry strategy** rather than stripping itemIds upfront (preserving them benefits OpenAI caching):

- `stripItemIdsFromMessages()` — strips all itemId references in-place (used on retry)
- `isItemNotFoundError()` — detects the error to trigger retry
- Retry logic lives in `chat_stream_handlers.ts` for both agent-mode and build-mode streams

### Test coupling

When modifying `cleanMessageForOpenAI` in `ai_messages_utils.ts`, also update tests in **both**:

- `src/__tests__/ai_messages_utils.test.ts` (direct unit tests)
- `src/__tests__/prepare_step_utils.test.ts` (tests `prepareStepMessages` which calls `cleanMessageForOpenAI` internally)
