import { z } from "zod";

// The `/chat` route's search-param schema, extracted into its own module (rather
// than living directly in chat.tsx) so test harnesses can import the exact same
// schema WITHOUT pulling in chat.tsx's transitive `ChatPage` -> `PreviewPanel`
// -> Monaco graph. The hybrid chat harness imports this to keep its private
// `/chat` route from drifting. See src/testing/hybrid_chat_harness.tsx.
export const chatSearchSchema = z.object({
  id: z.number().optional(),
  appId: z.number().optional(),
});
