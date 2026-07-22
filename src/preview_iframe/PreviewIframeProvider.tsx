import { createContext, useContext, useState, type ReactNode } from "react";
import { useStore } from "jotai";
import { useManagerLifecycle } from "@/state_machines/react";
import { createPreviewIframeCommandAdapter } from "./commands";
import { PreviewIframeManager } from "./manager";

const PreviewIframeContext = createContext<PreviewIframeManager | null>(null);

export function PreviewIframeProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const [manager] = useState(
    () => new PreviewIframeManager(createPreviewIframeCommandAdapter(store)),
  );
  useManagerLifecycle(manager);
  return (
    <PreviewIframeContext.Provider value={manager}>
      {children}
    </PreviewIframeContext.Provider>
  );
}

export function usePreviewIframeManager(): PreviewIframeManager {
  const manager = useContext(PreviewIframeContext);
  if (!manager) {
    throw new Error("usePreviewIframeManager requires PreviewIframeProvider");
  }
  return manager;
}
