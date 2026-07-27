import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

const fileNames = ["A", "B", "C", "D", "E"];

export const fixture: LocalAgentFixture = {
  description: "Create five files to verify tool-card stability",
  turns: [
    {
      text: "Creating five files to verify tool-card stability.",
      toolCalls: fileNames.map((suffix) => ({
        name: "write_file",
        args: {
          path: `src/streaming/StreamingRenderBlock${suffix}.tsx`,
          content: `export default function StreamingRenderBlock${suffix}() {\n  return <div>Streaming Render Block ${suffix}</div>;\n}\n`,
          description: `Create block ${suffix}`,
        },
      })),
    },
    { text: "All five files generated." },
  ],
};
