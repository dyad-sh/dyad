import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Add, edit, and delete files for version integrity",
  turns: [
    {
      text: "Updating version integrity files.",
      toolCalls: [
        { name: "delete_file", args: { path: "to-be-deleted.txt" } },
        {
          name: "write_file",
          args: {
            path: "new-file.js",
            content: "new-file\nend of new-file\n",
            description: "Create a new file",
          },
        },
        {
          name: "write_file",
          args: {
            path: "to-be-edited.txt",
            content: "after-edit\n",
            description: "Edit the file",
          },
        },
      ],
    },
    { text: "Version integrity files updated." },
  ],
};
