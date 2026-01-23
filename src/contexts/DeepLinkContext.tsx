import React, { createContext, useContext, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { IpcClient } from "../ipc/ipc_client";
import { DeepLinkData } from "../ipc/deep_link_data";
import { useScrollAndNavigateTo } from "@/hooks/useScrollAndNavigateTo";

type DeepLinkContextType = {
  lastDeepLink: (DeepLinkData & { timestamp: number }) | null;
  clearLastDeepLink: () => void;
};

const DeepLinkContext = createContext<DeepLinkContextType>({
  lastDeepLink: null,
  clearLastDeepLink: () => {},
});

export function DeepLinkProvider({ children }: { children: React.ReactNode }) {
  const [lastDeepLink, setLastDeepLink] = useState<
    (DeepLinkData & { timestamp: number }) | null
  >(null);
  const navigate = useNavigate();
  const scrollAndNavigateTo = useScrollAndNavigateTo("/settings", {
    behavior: "smooth",
    block: "start",
  });
  useEffect(() => {
    const ipcClient = IpcClient.getInstance();
    const unsubscribe = ipcClient.onDeepLinkReceived((data) => {
      // Update with timestamp to ensure state change even if same type comes twice
      setLastDeepLink({ ...data, timestamp: Date.now() });
      if (data.type === "add-mcp-server") {
        // Navigate to tools-mcp section
        scrollAndNavigateTo("tools-mcp");
      } else if (data.type === "add-prompt") {
        // Navigate to library page
        navigate({ to: "/library" });
      }
    });

    return unsubscribe;
  }, [navigate, scrollAndNavigateTo]);

  return (
    <DeepLinkContext.Provider
      value={{
        lastDeepLink,
        clearLastDeepLink: () => setLastDeepLink(null),
      }}
    >
      {children}
    </DeepLinkContext.Provider>
  );
}

export const useDeepLink = () => useContext(DeepLinkContext);
