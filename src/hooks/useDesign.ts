import { useEffect } from "react";
import { useSetAtom, useAtomValue } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { designStateAtom, setDesignSpec } from "@/atoms/designAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { designClient } from "@/ipc/types/design";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Loads a saved design spec from disk and syncs it into memory state for the
 * current chat (mirrors usePlan).
 */
export function useDesign({ enabled = true }: { enabled?: boolean } = {}) {
  const chatId = useAtomValue(selectedChatIdAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const designState = useAtomValue(designStateAtom);
  const setDesignState = useSetAtom(designStateAtom);

  const hasSpecInMemory = chatId
    ? designState.specsByChatId.has(chatId)
    : false;

  const { data: savedDesign, isLoading } = useQuery({
    queryKey: queryKeys.designs.forChat({
      appId: appId ?? null,
      chatId: chatId ?? null,
    }),
    queryFn: async () => {
      if (!appId || !chatId) return null;
      return designClient.getDesignForChat({ appId, chatId });
    },
    enabled: !!appId && !!chatId && !hasSpecInMemory && enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  useEffect(() => {
    if (savedDesign && chatId && !hasSpecInMemory) {
      setDesignState((prev) => setDesignSpec(prev, chatId, savedDesign));
    }
  }, [savedDesign, chatId, hasSpecInMemory, setDesignState]);

  return {
    savedDesign,
    hasSpecInMemory,
    isLoading,
  };
}
