import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { useSelectChat } from "@/hooks/useSelectChat";
import { useRunApp } from "@/hooks/useRunApp";
import {
  createMachineProvider,
  useRegisterEntityDisposer,
} from "@/state_machines/react";
import { createVersionPreviewRuntime } from "./commands";
import { VersionPreviewManager } from "./manager";

function useOwnedVersionPreviewManager(): VersionPreviewManager {
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
  return manager;
}

function useVersionPreviewMount(manager: VersionPreviewManager): void {
  useRegisterEntityDisposer("app", manager.disposeKey);
}

const versionPreviewProvider = createMachineProvider({
  name: "VersionPreview",
  useOwnedManager: useOwnedVersionPreviewManager,
  useOnMount: useVersionPreviewMount,
});

export const VersionPreviewProvider = versionPreviewProvider.Provider;
export const useVersionPreviewManager = versionPreviewProvider.useManager;
