import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

// print_envs is the tool the fake classifier deliberately answers slowly for, so
// the consent spinner is observable and the user can decide before the AI does.
export const fixture: LocalAgentFixture = {
  description: "Call an MCP tool (print_envs) that the classifier reviews slowly",
  turns: [
    {
      text: "I'll read the server's environment variables.",
      toolCalls: [
        {
          name: "execute_sandbox_script",
          args: {
            description: "Call print_envs through MCP",
            script: [
              "async function main() {",
              "  const result = await testing_mcp_server__print_envs({});",
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
      text: "Done reading the environment variables.",
    },
  ],
};
