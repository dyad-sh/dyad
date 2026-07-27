import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Read an attachment before dumping the follow-up request",
  turns: [
    {
      toolCalls: [
        {
          name: "read_file",
          args: { path: "attachments:attachment-only-setup-resume.txt" },
        },
      ],
    },
    { text: "Attachment read." },
  ],
};
