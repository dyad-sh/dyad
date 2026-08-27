# OpenAI Reasoning Model Errors

When using OpenAI reasoning models (o1, o3, o4-mini) via LiteLLM/Azure, you may see:

```
Item 'rs_...' of type 'reasoning' was provided without its required following item.
```

OpenAI's Responses API requires reasoning items to always be followed by an output item (text, tool-call). This error occurs when:

- The model produces reasoning then immediately makes tool calls (no text between)
- The stream is interrupted after reasoning but before output
- Only reasoning was generated in a turn

The fix in `src/ipc/utils/ai_messages_utils.ts` filters orphaned reasoning parts within `cleanMessage()` before sending conversation history back to OpenAI.

## Dyad Engine model aliases

When a Dyad Engine alias is backed by an OpenAI reasoning model, create it with `provider.responses(...)` and pass `providerId: "openai"`. Passing the alias provider (for example, `"auto"`) prevents `getExtraProviderOptionsForEngine()` from adding reasoning effort, summaries, encrypted reasoning content, and `store: false`.

Dyad Engine models expose the AI SDK provider name `dyad-engine`; provider-family call options such as `providerOptions.google` are ignored. Pass the resolved family through `providerId` and let `createDyadFetch()` inject `getExtraProviderOptionsForEngine()` instead of duplicating family options on fallback entries.

Every multi-step `streamText` loop must clean or sanitize the complete message array in `prepareStep`, including same-turn tool-call/results. With `store: false`, replaying an OpenAI/Azure reasoning `itemId` (`rs_...`) on the post-tool request fails with “Item with id ... not found”; use the shared `cleanMessage` / `sanitizeStepMessages` helpers rather than cleaning only persisted history.
