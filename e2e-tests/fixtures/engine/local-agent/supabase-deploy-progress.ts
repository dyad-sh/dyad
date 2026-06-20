import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

const functionWrites = Array.from({ length: 20 }, (_, index) => {
  const functionName = `queue-test-${String(index + 1).padStart(2, "0")}`;
  return {
    name: "write_file",
    args: {
      path: `supabase/functions/${functionName}/index.ts`,
      content: `import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(() => {
  return new Response(JSON.stringify({ functionName: "${functionName}" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
`,
      description: `Create ${functionName} edge function`,
    },
  };
});

export const fixture: LocalAgentFixture = {
  description: "Create shared Supabase code and many edge functions",
  turns: [
    {
      text: "I'll create shared Supabase code and several edge functions.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "supabase/functions/_shared/cors.ts",
            content: `export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
`,
            description: "Create shared CORS helper",
          },
        },
        ...functionWrites,
      ],
    },
    {
      text: "Done. The shared helper and edge functions have been created.",
    },
  ],
};
