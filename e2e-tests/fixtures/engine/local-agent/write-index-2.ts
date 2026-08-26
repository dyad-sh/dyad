import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Write the second Index page version",
  turns: [
    {
      text: "OK, I'm going to update the page now...",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/pages/Index.tsx",
            content: `const Index = () => {
  return <div>Testing:write-index(2)!</div>;
};

export default Index;
`,
            description: "write-description",
          },
        },
      ],
    },
    { text: "And it's done!" },
  ],
};
