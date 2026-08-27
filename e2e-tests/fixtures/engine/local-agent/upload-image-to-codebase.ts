import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Upload an attached image to the requested codebase path",
  turns: [
    {
      text: "I'll upload your image to the codebase.",
      toolCalls: [
        {
          name: "copy_file",
          args: {
            from: "attachments:logo.png",
            to: "new/image/file.png",
            description: "Copy uploaded image to codebase",
          },
        },
      ],
    },
    {
      text: "I've copied the image to new/image/file.png.",
    },
  ],
};
