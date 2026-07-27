import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Rename a file and then overwrite it",
  turns: [
    {
      toolCalls: [
        {
          name: "rename_file",
          args: { from: "src/App.tsx", to: "src/Renamed.tsx" },
        },
        {
          name: "write_file",
          args: {
            path: "src/Renamed.tsx",
            content:
              "// newly added content to renamed file should exist\n",
            description: "Edit the renamed file",
          },
        },
      ],
    },
    { text: "Rename and edit complete." },
  ],
};
