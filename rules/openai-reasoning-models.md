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
