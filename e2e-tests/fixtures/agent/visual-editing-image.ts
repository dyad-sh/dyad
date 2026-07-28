import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Create a React page with an image for visual editing",
  turns: [
    {
      text: "I'll add an image to the page.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/pages/Index.tsx",
            content: `import { MadeWithDyad } from "@/components/made-with-dyad";

const Index = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Welcome to Your Blank App</h1>
        <img src="/placeholder.svg" alt="Hero image" className="mx-auto mb-4 w-64 h-64" />
        <p className="text-xl text-gray-600">
          Start building your amazing project here!
        </p>
      </div>
      <MadeWithDyad />
    </div>
  );
};

export default Index;
`,
            description: "Add a hero image to the page",
          },
        },
      ],
    },
    {
      text: "The page now includes a hero image.",
    },
  ],
};
