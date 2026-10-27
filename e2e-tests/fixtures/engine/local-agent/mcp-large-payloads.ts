import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

// 30 sandbox MCP calls with 100 KB arguments and results above the transcript
// cap, enough to spend the turn's transcript budget.
export const fixture: LocalAgentFixture = {
  description: "Call an MCP tool many times with large arguments and results",
  turns: [
    {
      text: "I'll send the payloads to the MCP tool.",
      toolCalls: [
        {
          name: "execute_sandbox_script",
          args: {
            description: "Send payloads through MCP",
            script: [
              "async function main() {",
              '  const payload = "abcdefgh".repeat(12500);',
              "  for (let i = 0; i < 30; i++) {",
              "    await testing_mcp_server__ingest_payload({ payload, resultBytes: 200000 });",
              "  }",
              '  return "done";',
              "}",
              "main();",
            ].join("\n"),
          },
        },
      ],
    },
    {
      text: "The payloads were sent successfully. LARGE_PAYLOADS_DONE",
    },
  ],
};
