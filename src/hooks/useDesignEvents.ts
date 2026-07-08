import { useEffect } from "react";
import { useSetAtom, useAtomValue } from "jotai";
import { designStateAtom } from "@/atoms/designAtoms";
import { previewModeAtom } from "@/atoms/appAtoms";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { ipc } from "@/ipc/types";
import {
  designEventClient,
  type DesignBriefUpdatePayload,
  type DesignInterfaceUpdatePayload,
} from "@/ipc/types/design";

/**
 * Handles design-mode state. Should be called once at the app root.
 *
 * Two sources feed the design store:
 * - Live IPC events, as the agent commits a brief and generates interfaces.
 * - Persisted state on disk (`<appPath>/.dyad/designs/<chatId>.json`), loaded
 *   when a chat is (re)opened so mockups survive reloads.
 *
 * Either source switches the preview panel to the "design" view so the user
 * sees the mockups. The "design" view is programmatic-only (no toolbar button),
 * so we must switch to it whenever design data is present.
 */
export function useDesignEvents() {
  const setDesignState = useSetAtom(designStateAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);

  useEffect(() => {
    const showDesignPreview = () => {
      setIsPreviewOpen(true);
      setPreviewMode("design");
    };

    const unsubscribeBrief = designEventClient.onBriefUpdate(
      (payload: DesignBriefUpdatePayload) => {
        setDesignState((prev) => {
          const nextBriefs = new Map(prev.briefByChatId);
          nextBriefs.set(payload.chatId, payload.data);
          return { ...prev, briefByChatId: nextBriefs };
        });
        showDesignPreview();
      },
    );

    const unsubscribeInterface = designEventClient.onInterfaceUpdate(
      (payload: DesignInterfaceUpdatePayload) => {
        setDesignState((prev) => {
          const nextInterfaces = new Map(prev.interfacesByChatId);
          const chatInterfaces = new Map(
            nextInterfaces.get(payload.chatId) ?? [],
          );
          chatInterfaces.set(payload.data.id, payload.data);
          nextInterfaces.set(payload.chatId, chatInterfaces);
          return { ...prev, interfacesByChatId: nextInterfaces };
        });
        showDesignPreview();
      },
    );

    return () => {
      unsubscribeBrief();
      unsubscribeInterface();
    };
  }, [setDesignState, setPreviewMode, setIsPreviewOpen]);

  // Rehydrate persisted design state whenever the selected chat changes. If the
  // chat has a saved design, load it into the store and switch to the design
  // view. Chats that were never designed return an empty state and are ignored.
  useEffect(() => {
    if (!selectedChatId) return;
    let cancelled = false;

    ipc.design
      .getDesignState({ chatId: selectedChatId })
      .then((state) => {
        if (cancelled) return;
        if (!state.brief && state.interfaces.length === 0) return;

        setDesignState((prev) => {
          const nextBriefs = new Map(prev.briefByChatId);
          if (state.brief) {
            nextBriefs.set(selectedChatId, state.brief);
          }
          const nextInterfaces = new Map(prev.interfacesByChatId);
          if (state.interfaces.length > 0) {
            const chatInterfaces = new Map(
              nextInterfaces.get(selectedChatId) ?? [],
            );
            for (const iface of state.interfaces) {
              chatInterfaces.set(iface.id, iface);
            }
            nextInterfaces.set(selectedChatId, chatInterfaces);
          }
          return {
            ...prev,
            briefByChatId: nextBriefs,
            interfacesByChatId: nextInterfaces,
          };
        });
        setIsPreviewOpen(true);
        setPreviewMode("design");
      })
      .catch(() => {
        // Non-fatal: a chat with no persisted design (or a load error) simply
        // shows no mockups until the agent regenerates them.
      });

    return () => {
      cancelled = true;
    };
  }, [selectedChatId, setDesignState, setPreviewMode, setIsPreviewOpen]);
}
