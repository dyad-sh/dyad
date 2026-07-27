import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

const brokenIndex = `// Intentionally broken runtime fixture.

import { MadeWithDyad } from "@/components/made-with-dyad";

const Index = () => {
throw new Error("Line 6 error");
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Welcome to Your Blank App</h1>
      </div>
      <MadeWithDyad />
    </div>
  );
};

export default Index;
`;

export const fixture: LocalAgentFixture = {
  description: "Create a runtime error",
  turns: [
    {
      text: "I will intentionally add an error.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/pages/Index.tsx",
            content: brokenIndex,
            description: "Intentionally add an error",
          },
        },
      ],
    },
    { text: "The runtime error is ready." },
  ],
};
