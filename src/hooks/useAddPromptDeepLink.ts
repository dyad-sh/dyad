import { useState, useEffect, useCallback } from "react";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { AddPromptDeepLinkData } from "@/ipc/deep_link_data";
import { showInfo } from "@/lib/toast";

export function useAddPromptDeepLink() {
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prefillData, setPrefillData] = useState<
    { title: string; description: string; content: string } | undefined
  >(undefined);

  useEffect(() => {
    if (lastDeepLink?.type === "add-prompt") {
      const deepLink = lastDeepLink as unknown as AddPromptDeepLinkData;
      const payload = deepLink.payload;
      showInfo(`Prefilled prompt: ${payload.title}`);
      setPrefillData({
        title: payload.title,
        description: payload.description,
        content: payload.content,
      });
      setDialogOpen(true);
      clearLastDeepLink();
    }
  }, [lastDeepLink?.timestamp, clearLastDeepLink]);

  const handleDialogClose = useCallback((open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setPrefillData(undefined);
    }
  }, []);

  return { prefillData, dialogOpen, handleDialogClose, setDialogOpen };
}
