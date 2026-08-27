import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Fix the deterministic runtime error fixture",
  turns: [
    {
      text: "Fixing the error...",
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
        <h1 className="text-4xl font-bold mb-4">No more errors!</h1>
      </div>
      <MadeWithDyad />
    </div>
  );
};

export default Index;
`,
            description: "Fix the runtime error",
          },
        },
      ],
    },
    { text: "The runtime error is fixed." },
  ],
};
