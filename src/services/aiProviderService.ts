import { supabase } from "@/integrations/supabase/client";

interface ChatRequest {
  message: string;
  systemPrompt?: string;
  provider?: string;
  model?: string;
}

interface ChatResponse {
  response: string | null;
  error?: string;
}

/**
 * Unified AI provider service for the renderer.
 * Routes through Supabase edge functions (deepseek-analyze, etc.).
 */
export const aiProviderService = {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    try {
      const { data, error } = await supabase.functions.invoke("deepseek-analyze", {
        body: {
          prompt: req.message,
          systemPrompt: req.systemPrompt ?? "You are a helpful AI assistant.",
          taskType: "general",
          provider: req.provider ?? "local-deepseek",
          model: req.model,
        },
      });

      if (error) {
        return { response: null, error: error.message ?? "AI service error" };
      }

      const text =
        typeof data?.result === "string"
          ? data.result
          : data?.result?.text ?? data?.text ?? JSON.stringify(data);

      return { response: text };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";

      // Fallback: try direct fetch to the edge function base URL
      try {
        const base = "https://jgsbmnzhvuwiujqbaieo.supabase.co/functions/v1";
        const res = await fetch(`${base}/deepseek-analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: req.message,
            systemPrompt: req.systemPrompt,
            taskType: "general",
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return { response: json?.result ?? JSON.stringify(json) };
      } catch {
        return { response: null, error: msg };
      }
    }
  },
};
