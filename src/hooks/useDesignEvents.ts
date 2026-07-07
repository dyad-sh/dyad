import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  designStateAtom,
  regeneratingInterfacesAtom,
  setDesignSpec,
} from "@/atoms/designAtoms";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  designEventClient,
  designClient,
  type DesignUpdatePayload,
} from "@/ipc/types/design";
import { useAtomValue } from "jotai";

/**
 * Handles Design mode IPC events. Call at the app root, alongside usePlanEvents.
 *
 * On a design:update event it (1) stores the spec in memory, (2) persists it to
 * `.dyad/design/<chatId>.json`, (3) clears any per-interface regenerating flags,
 * and (4) surfaces the Design preview panel.
 */
export function useDesignEvents() {
  const setDesignState = useSetAtom(designStateAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const setRegenerating = useSetAtom(regeneratingInterfacesAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = designEventClient.onUpdate(
      (payload: DesignUpdatePayload) => {
        setDesignState((prev) =>
          setDesignSpec(prev, payload.chatId, payload.spec),
        );

        // Persist to disk so the design survives reloads. Best-effort — the
        // in-memory state already reflects the update for the UI.
        if (appId != null) {
          void designClient
            .saveDesignSpec({
              appId,
              chatId: payload.chatId,
              spec: payload.spec,
            })
            .then(() => {
              queryClient.invalidateQueries({
                queryKey: queryKeys.designs.forChat({
                  appId,
                  chatId: payload.chatId,
                }),
              });
            })
            .catch((error) => {
              console.error("Failed to persist design spec:", error);
            });
        }

        // Clear regenerating flags for this chat now that a new spec arrived.
        setRegenerating((prev) => {
          if (!prev.has(payload.chatId)) return prev;
          const next = new Map(prev);
          next.delete(payload.chatId);
          return next;
        });

        setPreviewMode("design");
      },
    );

    return () => {
      unsubscribe();
    };
  }, [setDesignState, setPreviewMode, setRegenerating, appId, queryClient]);
}
