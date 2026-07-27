import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Write the first version of the index page",
  turns: [
    {
      text: "OK, I'm going to do some writing now...",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/pages/Index.tsx",
            content: `const Index = () => {
  return (
    <div>
        Testing:write-index!
    </div>
  );
};

export default Index;
`,
            description: "Write the index page",
          },
        },
      ],
    },
    {
      text: "And it's done!",
    },
  ],
};
