import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Edit the Made with Dyad component",
  turns: [
    {
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "src/components/made-with-dyad.tsx",
            content: `export const MadeWithDyad = () => {
  return (
    <div className="p-4 text-center">
      <a
        href="https://www.dyad.sh/"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        Made with Dyad (EDITED)
      </a>
    </div>
  );
};
`,
            description: "Edit the Made with Dyad component",
          },
        },
      ],
    },
    { text: "Component updated." },
  ],
};
