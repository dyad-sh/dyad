import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Reads an entry of an unpacked zip attachment with read_file, then
 * enumerates and reads the archive through execute_sandbox_script. Both go
 * through the attachment manifest's nested `attachments:<zip>/<path>` names.
 */
export const fixture: LocalAgentFixture = {
  description: "Inspect an unpacked zip attachment",
  turns: [
    {
      text: "I'll look at the archive's entry point first.",
      toolCalls: [
        {
          name: "read_file",
          args: { path: "attachments:project.zip/src/index.ts" },
        },
      ],
    },
    {
      text: "Now I'll enumerate the whole archive from a sandbox script.",
      toolCalls: [
        {
          name: "execute_sandbox_script",
          args: {
            description: "List project.zip entries",
            script: `
async function main() {
  const entries = await list_files("attachments:project.zip");
  const readme = await read_file("attachments:project.zip/README.md");
  return { entries, readme };
}
main();
`,
          },
        },
      ],
    },
    {
      text: "The archive holds a small TypeScript project with a README, an entry point and a logo.",
    },
  ],
};
