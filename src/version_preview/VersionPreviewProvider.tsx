import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { useSelectChat } from "@/hooks/useSelectChat";
import { createVersionPreviewRuntime } from "./commands";
import { VersionPreviewManager } from "./manager";

const VersionPreviewContext = createContext<VersionPreviewManager | null>(null);

export function VersionPreviewProvider({
  children,
  manager: providedManager,
}: {
  children: ReactNode;
  manager?: VersionPreviewManager;
}) {
  if (providedManager) {
    return (
      <ProvidedVersionPreviewProvider manager={providedManager}>
        {children}
      </ProvidedVersionPreviewProvider>
    );
  }
  return <OwnedVersionPreviewProvider>{children}</OwnedVersionPreviewProvider>;
}

function ProvidedVersionPreviewProvider({
  children,
  manager,
}: {
  children: ReactNode;
  manager: VersionPreviewManager;
}) {
  useEffect(() => () => manager.dispose(), [manager]);
  return (
    <VersionPreviewContext.Provider value={manager}>
      {children}
    </VersionPreviewContext.Provider>
  );
}

function OwnedVersionPreviewProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const store = useStore();
  const { selectChat } = useSelectChat();
  const [manager] = useState(
    () =>
      new VersionPreviewManager(
        createVersionPreviewRuntime({
          queryClient,
          store,
          navigateToChat: ({ appId, chatId }) =>
            selectChat({ appId, chatId, scrollToBottom: true }),
        }),
        store,
      ),
  );

  useEffect(() => () => manager.dispose(), [manager]);

  return (
    <VersionPreviewContext.Provider value={manager}>
      {children}
    </VersionPreviewContext.Provider>
  );
}

export function useVersionPreviewManager(): VersionPreviewManager {
  const manager = useContext(VersionPreviewContext);
  if (!manager) {
    throw new Error("useVersionPreviewManager requires VersionPreviewProvider");
  }
  return manager;
}
