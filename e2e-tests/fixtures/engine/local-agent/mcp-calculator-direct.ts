import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

// With sandbox script execution OFF, MCP tools are registered as direct agent
// tools (not host functions called from execute_sandbox_script). The agent
// calls the sanitized server__tool name directly.
export const fixture: LocalAgentFixture = {
  description: "Call an MCP tool directly (sandbox script execution off)",
  turns: [
    {
      text: "I'll add 5 and 3 using the calculator tool.",
      toolCalls: [
        {
          name: "testing_mcp_server__calculator_add",
          args: { a: 5, b: 3 },
        },
      ],
    },
    {
      text: "The sum of 5 and 3 is 8.",
    },
  ],
};
