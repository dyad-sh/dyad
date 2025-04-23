import React, { createContext, useContext, useEffect, useState } from "react";
import { IpcClient, DeepLinkData } from "../ipc/ipc_client";

type DeepLinkContextType = {
  lastDeepLink: (DeepLinkData & { timestamp: number }) | null;
};

const DeepLinkContext = createContext<DeepLinkContextType>({
  lastDeepLink: null,
});

export function DeepLinkProvider({ children }: { children: React.ReactNode }) {
  const [lastDeepLink, setLastDeepLink] = useState<
    (DeepLinkData & { timestamp: number }) | null
  >(null);

  useEffect(() => {
    const ipcClient = IpcClient.getInstance();
    const unsubscribe = ipcClient.onDeepLinkReceived((data) => {
      // Update with timestamp to ensure state change even if same type comes twice
      setLastDeepLink({ ...data, timestamp: Date.now() });
    });

    return unsubscribe;
  }, []);

  return (
    <DeepLinkContext.Provider value={{ lastDeepLink }}>
      {children}
    </DeepLinkContext.Provider>
  );
}

export const useDeepLink = () => useContext(DeepLinkContext);
