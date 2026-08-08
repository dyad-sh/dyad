import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Enable the Nitro server layer on a Vite app",
  turns: [
    {
      text: "I'll add a Nitro server layer so the app can run server-side code.",
      toolCalls: [
        {
          name: "enable_nitro",
          args: {
            reason: "User asked to store form submissions in Postgres.",
          },
        },
      ],
    },
    {
      text: "Server layer added. Now I'll write the API route.",
    },
  ],
};
