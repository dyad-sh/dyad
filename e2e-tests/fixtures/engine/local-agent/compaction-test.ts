import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Fixture that generates enough tool call turns to trigger mid-stream
 * compaction when used with a model that has a small context window.
 *
 * Each turn reads or edits files, accumulating token usage across turns.
 * With a context window of ~500 tokens, compaction should trigger after
 * 2-3 turns of tool calls and results.
 */
export const fixture: LocalAgentFixture = {
  description:
    "Multi-turn tool calls to trigger mid-stream context compaction",
  turns: [
    {
      text: "Let me start by reading the main application file to understand the current structure.",
      toolCalls: [
        {
          name: "read_file",
          args: {
            path: "src/App.tsx",
          },
        },
      ],
    },
    {
      text: "Now I understand the structure. Let me also check if there are any other important files in the project.",
      toolCalls: [
        {
          name: "read_file",
          args: {
            path: "package.json",
          },
        },
      ],
    },
    {
      text: "Great, I have a good understanding now. Let me update the App component with the improvements.",
      toolCalls: [
        {
          name: "edit_file",
          args: {
            path: "src/App.tsx",
            content: `// ... existing code ...
const App = () => <div>COMPACTION TEST - Updated App</div>;
// ... existing code ...`,
            description: "Update App component after compaction",
          },
        },
      ],
    },
    {
      text: "I have successfully updated the application. The App component now displays the updated message. All changes have been applied.",
    },
  ],
};
