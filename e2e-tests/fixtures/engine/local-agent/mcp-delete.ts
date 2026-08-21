import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Call a destructive MCP tool (delete_record) from local-agent mode",
  turns: [
    {
      text: "I'll delete the record using the MCP tool.",
      toolCalls: [
        {
          name: "execute_sandbox_script",
          args: {
            description: "Call delete_record through MCP",
            script: [
              "async function main() {",
              '  const result = await testing_mcp_server__delete_record({ id: "123" });',
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
      text: "The record was deleted using the MCP tool.",
    },
  ],
};
