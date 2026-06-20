import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Call an MCP tool (calculator_add) from local-agent mode",
  turns: [
    {
      text: "I'll calculate the sum of 5 and 3 using the calculator.",
      toolCalls: [
        {
          name: "execute_sandbox_script",
          args: {
            description: "Call calculator_add through MCP",
            script: [
              "async function main() {",
              "  const result = await testing_mcp_server__calculator_add({ a: 5, b: 3 });",
              "  return JSON.stringify(result);",
              "}",
              "main();",
            ].join("\n"),
            execution_thread: "main",
          },
        },
      ],
    },
    {
      text: "The sum of 5 and 3 is 8. The calculation was performed successfully using the MCP calculator tool.",
    },
  ],
};
