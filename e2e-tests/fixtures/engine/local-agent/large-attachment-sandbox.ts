import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Reads a large uploaded attachment through execute_sandbox_script.
 * This exercises the real MustardScript sandbox and host attachment resolver.
 */
export const fixture: LocalAgentFixture = {
  description: "Read a large attachment with execute_sandbox_script",
  turns: [
    {
      text: "I'll inspect the attached log with a sandbox script.",
      toolCalls: [
        {
          name: "execute_sandbox_script",
          args: {
            description: "Summarize large-log.txt",
            script: `
async function main() {
  const text = await read_file("attachments:large-log.txt");
  const markerCount = text.split("DYAD_LARGE_ATTACHMENT_MARKER").length - 1;
  return {
    markerCount,
    hasTail: text.includes("TAIL_SENTINEL_98765")
  };
}
main();
`,
          },
        },
      ],
    },
    {
      text: "The sandbox script read the large attachment and found the expected marker count and tail sentinel.",
    },
  ],
};
