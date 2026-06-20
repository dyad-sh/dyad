import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Discover an MCP tool with search_mcp_tools",
  turns: [
    {
      text: "Let me find an MCP tool for adding numbers.",
      toolCalls: [
        {
          name: "search_mcp_tools",
          args: { query: "add numbers" },
        },
      ],
    },
    {
      text: "I found the calculator_add MCP tool for adding two numbers.",
    },
  ],
};
