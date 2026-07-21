import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { useSelectChat } from "@/hooks/useSelectChat";
import { useRunApp } from "@/hooks/useRunApp";
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
  useManagerLifecycle(manager);
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
  const { restartApp } = useRunApp();
  const [manager] = useState(
    () =>
      new VersionPreviewManager(
        createVersionPreviewRuntime({
          queryClient,
          store,
          restartApp: (appId) => restartApp({ appId }),
          navigateToChat: ({ appId, chatId }) =>
            selectChat({ appId, chatId, scrollToBottom: true }),
        }),
        store,
      ),
  );

  useManagerLifecycle(manager);

  return (
    <VersionPreviewContext.Provider value={manager}>
      {children}
    </VersionPreviewContext.Provider>
  );
}

function useManagerLifecycle(manager: VersionPreviewManager) {
  const generation = useRef(0);
  useEffect(() => {
    const currentGeneration = ++generation.current;
    manager.start();
    return () => {
      // React StrictMode immediately replays effects without recreating state.
      // Defer irreversible disposal so the replay setup can claim the manager.
      queueMicrotask(() => {
        if (generation.current === currentGeneration) manager.dispose();
      });
    };
  }, [manager]);
}

export function useVersionPreviewManager(): VersionPreviewManager {
  const manager = useContext(VersionPreviewContext);
  if (!manager) {
    throw new Error("useVersionPreviewManager requires VersionPreviewProvider");
  }
  return manager;
}
