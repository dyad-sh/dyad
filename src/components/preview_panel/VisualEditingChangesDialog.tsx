import { useAtom, useAtomValue } from "jotai";
import { pendingVisualChangesAtom } from "@/atoms/previewAtoms";
import { Button } from "@/components/ui/button";
import { ipc, type VisualEditingChange } from "@/ipc/types";
import { Check, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { showError, showSuccess } from "@/lib/toast";
import { selectedAppIdAtom } from "@/atoms/appAtoms";

export const MAX_VISUAL_TEXT_CACHE_ENTRIES = 500;
export const MAX_VISUAL_TEXT_ENTRY_BYTES = 1024 * 1024;
export const MAX_VISUAL_TEXT_TOTAL_BYTES = 5 * 1024 * 1024;
export const VISUAL_TEXT_RESPONSE_TIMEOUT_MS = 10_000;

interface VisualEditingChangesDialogProps {
  onReset?: () => void;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
}

interface TextContentRequest {
  generation: number;
  source: Window;
  appId: number;
  changes: VisualEditingChange[];
  expectedComponentIds: Set<string>;
  textContentByComponentId: Map<string, string>;
  totalTextBytes: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

type SavePhase = "idle" | "collecting-text" | "applying";

function utf8ByteLengthWithinLimit(
  value: string,
  limit: number,
): number | null {
  let byteLength = 0;

  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit <= 0x7f) {
      byteLength += 1;
    } else if (codeUnit <= 0x7ff) {
      byteLength += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      byteLength += 4;
      index += 1;
    } else {
      // TextEncoder replaces unpaired surrogates with U+FFFD, which is 3 bytes.
      byteLength += 3;
    }

    if (byteLength > limit) {
      return null;
    }
  }

  return byteLength;
}

export function VisualEditingChangesDialog({
  onReset,
  iframeRef,
}: VisualEditingChangesDialogProps) {
  const [pendingChanges, setPendingChanges] = useAtom(pendingVisualChangesAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const [savePhase, setSavePhase] = useState<SavePhase>("idle");
  const activeTextRequestRef = useRef<TextContentRequest | null>(null);
  const saveGenerationRef = useRef(0);
  const iframeWindow = iframeRef?.current?.contentWindow ?? null;

  const clearTextRequest = useCallback((request: TextContentRequest) => {
    if (request.timeoutId !== null) {
      clearTimeout(request.timeoutId);
      request.timeoutId = null;
    }
    request.expectedComponentIds.clear();
    request.textContentByComponentId.clear();
    request.totalTextBytes = 0;
    if (activeTextRequestRef.current === request) {
      activeTextRequestRef.current = null;
    }
  }, []);

  const invalidateSave = useCallback(
    (updateUi: boolean) => {
      saveGenerationRef.current += 1;
      const request = activeTextRequestRef.current;
      if (request) {
        clearTextRequest(request);
      }
      if (updateUi) {
        setSavePhase("idle");
      }
    },
    [clearTextRequest],
  );

  const applyChanges = useCallback(
    async (request: TextContentRequest) => {
      const updatedChanges = request.changes.map((change) => {
        const cachedText = request.textContentByComponentId.get(
          change.componentId,
        );
        return cachedText === undefined
          ? change
          : { ...change, textContent: cachedText };
      });

      request.expectedComponentIds.clear();
      request.textContentByComponentId.clear();
      request.totalTextBytes = 0;

      try {
        await ipc.visualEditing.applyChanges({
          appId: request.appId,
          changes: updatedChanges,
        });

        if (saveGenerationRef.current !== request.generation) {
          return;
        }

        setPendingChanges(new Map());
        showSuccess("Visual changes saved to source files");
        onReset?.();
      } catch (error) {
        if (saveGenerationRef.current !== request.generation) {
          return;
        }
        console.error("Failed to save visual editing changes:", error);
        showError(`Failed to save changes: ${error}`);
      } finally {
        if (saveGenerationRef.current === request.generation) {
          setSavePhase("idle");
        }
      }
    },
    [onReset, setPendingChanges],
  );

  const finishTextRequest = useCallback(
    (request: TextContentRequest) => {
      if (activeTextRequestRef.current !== request) {
        return;
      }

      if (request.timeoutId !== null) {
        clearTimeout(request.timeoutId);
        request.timeoutId = null;
      }
      activeTextRequestRef.current = null;
      setSavePhase("applying");
      void applyChanges(request);
    },
    [applyChanges],
  );

  const failTextRequest = useCallback(
    (request: TextContentRequest, message: string) => {
      if (activeTextRequestRef.current !== request) {
        return;
      }

      clearTextRequest(request);
      saveGenerationRef.current += 1;
      setSavePhase("idle");
      showError(message);
    },
    [clearTextRequest],
  );

  // Only the current preview iframe may answer an active, expected request.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const request = activeTextRequestRef.current;
      if (
        !request ||
        !iframeWindow ||
        request.source !== iframeWindow ||
        event.source !== iframeWindow
      ) {
        return;
      }

      const data: unknown = event.data;
      if (
        typeof data !== "object" ||
        data === null ||
        !("type" in data) ||
        data.type !== "dyad-text-content-response" ||
        !("componentId" in data) ||
        typeof data.componentId !== "string" ||
        !("text" in data) ||
        (data.text !== null && typeof data.text !== "string") ||
        !request.expectedComponentIds.has(data.componentId)
      ) {
        return;
      }

      if (typeof data.text === "string") {
        if (
          request.textContentByComponentId.size >= MAX_VISUAL_TEXT_CACHE_ENTRIES
        ) {
          failTextRequest(
            request,
            `Could not save visual changes: more than ${MAX_VISUAL_TEXT_CACHE_ENTRIES} text responses were received.`,
          );
          return;
        }

        const textBytes = utf8ByteLengthWithinLimit(
          data.text,
          MAX_VISUAL_TEXT_ENTRY_BYTES,
        );
        if (textBytes === null) {
          failTextRequest(
            request,
            `Could not save visual changes: text content for component "${data.componentId}" exceeds the 1 MiB limit.`,
          );
          return;
        }
        if (request.totalTextBytes + textBytes > MAX_VISUAL_TEXT_TOTAL_BYTES) {
          failTextRequest(
            request,
            "Could not save visual changes: collected text content exceeds the 5 MiB limit.",
          );
          return;
        }

        request.textContentByComponentId.set(data.componentId, data.text);
        request.totalTextBytes += textBytes;
      }

      request.expectedComponentIds.delete(data.componentId);
      if (request.expectedComponentIds.size === 0) {
        finishTextRequest(request);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [failTextRequest, finishTextRequest, iframeWindow]);

  // Changing app/iframe invalidates stale responses. Cleanup also covers unmount.
  useEffect(() => {
    invalidateSave(true);
    return () => invalidateSave(false);
  }, [iframeWindow, invalidateSave, selectedAppId]);

  if (pendingChanges.size === 0) return null;

  const handleSave = () => {
    if (savePhase !== "idle") {
      return;
    }
    if (selectedAppId === null) {
      showError("Could not save visual changes: no app is selected.");
      return;
    }

    const changesToSave = Array.from(pendingChanges.values());
    if (changesToSave.length > MAX_VISUAL_TEXT_CACHE_ENTRIES) {
      showError(
        `Could not save more than ${MAX_VISUAL_TEXT_CACHE_ENTRIES} visual changes at once.`,
      );
      return;
    }

    const generation = saveGenerationRef.current + 1;
    saveGenerationRef.current = generation;

    const request: TextContentRequest = {
      generation,
      source: iframeWindow ?? window,
      appId: selectedAppId,
      changes: changesToSave,
      expectedComponentIds: new Set(
        changesToSave.map((change) => change.componentId),
      ),
      textContentByComponentId: new Map(),
      totalTextBytes: 0,
      timeoutId: null,
    };

    if (!iframeWindow) {
      setSavePhase("applying");
      void applyChanges(request);
      return;
    }

    setSavePhase("collecting-text");
    activeTextRequestRef.current = request;
    request.timeoutId = setTimeout(() => {
      failTextRequest(
        request,
        "Timed out waiting for text content from the preview. Please try again.",
      );
    }, VISUAL_TEXT_RESPONSE_TIMEOUT_MS);

    try {
      for (const change of changesToSave) {
        iframeWindow.postMessage(
          {
            type: "get-dyad-text-content",
            data: { componentId: change.componentId },
          },
          "*",
        );
      }

      if (request.expectedComponentIds.size === 0) {
        finishTextRequest(request);
      }
    } catch (error) {
      failTextRequest(
        request,
        `Failed to request text content from the preview: ${error}`,
      );
    }
  };

  const handleDiscard = () => {
    invalidateSave(true);
    setPendingChanges(new Map());
    onReset?.();
  };

  return (
    <div className="bg-[var(--background)] border-b border-[var(--border)] px-2 lg:px-4 py-1.5 flex flex-col lg:flex-row items-start lg:items-center lg:justify-between gap-1.5 lg:gap-4 flex-wrap">
      <p className="text-xs lg:text-sm w-full lg:w-auto">
        <span className="font-medium">{pendingChanges.size}</span> component
        {pendingChanges.size > 1 ? "s" : ""} modified
      </p>
      <div className="flex gap-1 lg:gap-2 w-full lg:w-auto flex-wrap">
        <Button size="sm" onClick={handleSave} disabled={savePhase !== "idle"}>
          <Check size={14} className="mr-1" />
          <span>{savePhase !== "idle" ? "Saving..." : "Save Changes"}</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleDiscard}
          disabled={savePhase === "applying"}
        >
          <X size={14} className="mr-1" />
          <span>Discard</span>
        </Button>
      </div>
    </div>
  );
}
