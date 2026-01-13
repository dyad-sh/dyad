import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Call an MCP tool (calculator_add) from local-agent mode",
  turns: [
    {
      text: "I'll calculate the sum of 5 and 3 using the calculator.",
      toolCalls: [
        {
          // MCP tools are named as serverName__toolName
          name: "testing-mcp-server__calculator_add" as any,
          args: {
            a: 5,
            b: 3,
          },
        },
      ],
    },
    {
      text: "The sum of 5 and 3 is 8. The calculation was performed successfully using the MCP calculator tool.",
    },
  ],
};

