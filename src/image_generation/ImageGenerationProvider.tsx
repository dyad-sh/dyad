import { useEffect, useRef, type PropsWithChildren } from "react";
import {
  dismissImageGenerationToast,
  showImageGeneratingToast,
  showImageSuccessToast,
} from "@/components/ImageGenerationToast";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";

export function ImageGenerationProvider({ children }: PropsWithChildren) {
  const pendingCountRef = useRef(0);
  useEffect(() => {
    const unsubscribe = ipc.events.imageGeneration.onPresentation((event) => {
      pendingCountRef.current = event.pendingCount;
      if (event.type === "succeeded") {
        showImageSuccessToast(event.result, () => pendingCountRef.current);
        return;
      }
      if (event.pendingCount > 0) {
        showImageGeneratingToast(event.pendingCount);
      } else {
        dismissImageGenerationToast();
      }
      if (event.type === "failed") showError(event.message);
    });
    return () => {
      unsubscribe();
      dismissImageGenerationToast();
    };
  }, []);

  return children;
}
