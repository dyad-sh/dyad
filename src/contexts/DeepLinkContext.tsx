import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { ipc, DeepLinkData } from "../ipc/types";

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
  useEffect(() => {
    const unsubscribe = ipc.events.misc.onDeepLinkReceived((data) => {
      // Update with timestamp to ensure state change even if same type comes twice
      setLastDeepLink({ ...data, timestamp: Date.now() });
      if (data.type === "add-mcp-server") {
        // Navigate to the Plugins page; it opens the add dialog with
        // the prefilled form.
        navigate({ to: "/plugins" });
      } else if (data.type === "add-prompt") {
        // Navigate to library page
        navigate({ to: "/library" });
      }
    });

    return unsubscribe;
  }, [navigate]);

  const clearLastDeepLink = useCallback(() => setLastDeepLink(null), []);

  return (
    <DeepLinkContext.Provider
      value={{
        lastDeepLink,
        clearLastDeepLink,
      }}
    >
      {children}
    </DeepLinkContext.Provider>
  );
}

export const useDeepLink = () => useContext(DeepLinkContext);
