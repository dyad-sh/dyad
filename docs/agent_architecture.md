# Agent Architecture

Previously, Dyad used a pseudo tool-calling strategy using custom XML instead of model's formal tool calling capabilities. Now that models have gotten much better with tool calling, particularly with parallel tool calling, it's beneficial to use a more standard tool calling approach which will also make it much easier to add new tools.

- The heart of the local agent is in `src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts` which contains the core agent loop: which keeps calling the LLM until it chooses not to do a tool call or hits the maximum number of steps for the turn.
- `src/pro/main/ipc/handlers/local_agent/tool_definitions.ts` contains the list of all the tools available to the Dyad local agent.

## Add a tool

If you want to add a new tool, you will want to create a new tool in the `src/pro/main/ipc/handlers/local_agent/tools` directory. You can look at the existing tools as examples.

Then, import the tool and include it in `src/pro/main/ipc/handlers/local_agent/tool_definitions.ts`

Finally, you will need to define how to render the custom XML tag (e.g. `<dyad-$foo-tool-name>`) inside `src/components/chat/DyadMarkdownParser.tsx` which will typically involve creating a new React component to render the custom XML tag.

## Testing

You can add an E2E test by looking at the existing local agent E2E tests which are named like `e2e-tests/local_agent*.spec.ts`

You can define a tool call testing fixture at `e2e-tests/fixtures/engine` which allows you to simulate a tool call.
