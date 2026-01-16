import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Test fixture for file upload to codebase in local-agent mode.
 * The AI receives a file upload ID (DYAD_ATTACHMENT_0) and uses the write_file tool
 * to write the uploaded file to the codebase. The file_upload_utils should resolve
 * the attachment ID to the actual file content.
 */
export const fixture: LocalAgentFixture = {
  description: "Upload file to codebase using write_file tool",
  turns: [
    {
      text: "I'll upload your file to the codebase.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "assets/uploaded-file.png",
            content: "DYAD_ATTACHMENT_0",
            description: "Upload file to codebase",
          },
        },
      ],
    },
    {
      text: "I've successfully uploaded your file to assets/uploaded-file.png in the codebase.",
    },
  ],
};
