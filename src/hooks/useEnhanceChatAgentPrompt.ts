import { useCallback, useState } from "react";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";

export function useEnhanceChatAgentPrompt() {
  const [isEnhancing, setIsEnhancing] = useState(false);

  const enhancePrompt = useCallback(
    async (draft: string): Promise<string | null> => {
      const trimmed = draft.trim();
      if (!trimmed) return null;

      setIsEnhancing(true);
      try {
        const { enhanced } = await ipc.chatAgent.enhancePrompt({
          prompt: trimmed,
        });
        return enhanced.trim() || null;
      } catch (error) {
        showError(
          error instanceof Error ? error.message : "Failed to enhance prompt",
        );
        return null;
      } finally {
        setIsEnhancing(false);
      }
    },
    [],
  );

  return { enhancePrompt, isEnhancing };
}
