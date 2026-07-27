import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const BASH_WRITE_INDEX_COMMAND =
  'node -e "require(\'node:fs\').writeFileSync(\'src/App.tsx\',Buffer.from(\'ZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gQXBwKCkgeyByZXR1cm4gPG1haW4+Q3JlYXRlZCBieSBCYXNoIFRvb2w8L21haW4+OyB9Cg==\',\'base64\'))"';

export const fixture: LocalAgentFixture = {
  description: "Write the index page through the Bash tool",
  turns: [
    {
      text: "I will update the page with a shell command.",
      toolCalls: [
        {
          name: "bash",
          args: { command: BASH_WRITE_INDEX_COMMAND },
        },
      ],
    },
    {
      text: "The Bash tool request finished.",
    },
  ],
};
