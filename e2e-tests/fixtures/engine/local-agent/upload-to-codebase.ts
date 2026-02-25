import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Test fixture for file upload to codebase in local-agent mode.
 * The AI receives a .dyad/media file path and uses the copy_file tool
 * to copy the uploaded file into the codebase.
 */
export const fixture: LocalAgentFixture = {
  description: "Upload file to codebase using copy_file tool",
  turns: [
    {
      text: "I'll upload your file to the codebase.",
      toolCalls: [
        {
          name: "copy_file",
          args: {
            from: "{{ATTACHMENT_PATH}}",
            to: "assets/uploaded-file.png",
            description: "Copy uploaded file to codebase",
          },
        },
      ],
    },
    {
      text: "I've successfully copied your file to assets/uploaded-file.png in the codebase.",
    },
  ],
};
