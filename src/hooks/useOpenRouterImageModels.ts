import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";

/**
 * Fetches all OpenRouter models capable of image output (image-generation
 * models). The OpenRouter /models endpoint is public, so this works without an
 * API key configured.
 */
export function useOpenRouterImageModels() {
  return useQuery({
    queryKey: ["openrouter-image-models"],
    queryFn: () => ipc.imageGeneration.listImageModels(),
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}
