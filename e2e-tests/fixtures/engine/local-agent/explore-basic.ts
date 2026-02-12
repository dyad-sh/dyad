import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

/**
 * Fixture for testing the explore sub-agent feature.
 * This fixture simulates a simple explore phase followed by the main agent response.
 * The explore phase uses list_files and grep tools to gather context.
 */
export const fixture: LocalAgentFixture = {
  description: "Explore sub-agent gathers codebase context then main agent responds",
  turns: [
    // Turn 1: Explore phase - list files to understand structure
    {
      text: "I'll explore the codebase to understand the project structure.",
      toolCalls: [
        {
          name: "list_files",
          args: {
            directory: "src",
            recursive: false,
          },
        },
      ],
    },
    // Turn 2: Explore phase - grep for relevant patterns
    {
      text: "Now I'll search for relevant patterns.",
      toolCalls: [
        {
          name: "grep",
          args: {
            pattern: "function",
            directory: "src",
          },
        },
      ],
    },
    // Turn 3: Explore phase summary (text-only, ends explore)
    {
      text: "Based on my exploration, this is a React application with components in the src directory. The main entry point is App.tsx.",
    },
    // Turn 4: Main agent responds using the gathered context
    {
      text: "Based on the codebase context I gathered, I can see this is a React application. Here's my answer to your question: The project structure follows standard React conventions with source files in the src directory.",
    },
  ],
};
