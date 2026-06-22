import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Fetch an MCP tool's signature with get_mcp_tool_schema",
  turns: [
    {
      text: "Let me get the schema for the calculator_add MCP tool.",
      toolCalls: [
        {
          name: "get_mcp_tool_schema",
          args: { tools: ["calculator_add"] },
        },
      ],
    },
    {
      text: "I have the calculator_add signature and can now call it.",
    },
  ],
};
