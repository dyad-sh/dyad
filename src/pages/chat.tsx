import { useState, useRef, useEffect } from "react";
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import { ChatPanel } from "../components/ChatPanel";
import { PreviewPanel } from "../components/preview_panel/PreviewPanel";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  isPreviewOpenAtom,
  isChatPanelHiddenAtom,
  workspacePanelSizesAtom,
} from "@/atoms/viewAtoms";
import { useChats } from "@/hooks/useChats";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { usePlanImplementation } from "@/hooks/usePlanImplementation";
import { ipc } from "@/ipc/types";

export default function ChatPage() {
  const { id: chatId, appId: routeAppId } = useSearch({ from: "/chat" });
  const navigate = useNavigate();
  const [isPreviewOpen, setIsPreviewOpen] = useAtom(isPreviewOpenAtom);
  const [isChatPanelHidden, setIsChatPanelHidden] = useAtom(
    isChatPanelHiddenAtom,
  );
  const [workspacePanelSizes, setWorkspacePanelSizes] = useAtom(
    workspacePanelSizesAtom,
  );
  const previewMode = useAtomValue(previewModeAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const [isResizing, setIsResizing] = useState(false);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const { chats, loading } = useChats(selectedAppId);
  const selectedAppIdRef = useRef(selectedAppId);
  const latestLayoutRef = useRef<number[]>([
    workspacePanelSizes.default,
    100 - workspacePanelSizes.default,
  ]);
  const layoutProfile = previewMode === "code" ? "code" : "default";

  useEffect(() => {
    selectedAppIdRef.current = selectedAppId;
  }, [selectedAppId]);

  // Sync selectedChatIdAtom with the chatId from the URL
  useEffect(() => {
    setSelectedChatId(chatId ?? null);
  }, [chatId, setSelectedChatId]);

  // Handle plan implementation when a plan is accepted
  usePlanImplementation();

  useEffect(() => {
    if (chatId || loading) {
      return;
    }

    if (!selectedAppId) {
      navigate({ to: "/", replace: true });
      return;
    }

    if (chats.length) {
      // Not a real navigation, just a redirect, when the user navigates to /chat
      // without a chatId, we redirect to the first chat
      setSelectedAppId(chats[0].appId);
      navigate({
        to: "/chat",
        search: { id: chats[0].id, appId: chats[0].appId },
        replace: true,
      });
      return;
    }

    navigate({
      to: "/app-details",
      search: { appId: selectedAppId },
      replace: true,
    });
  }, [chatId, chats, loading, navigate, selectedAppId, setSelectedAppId]);

  useEffect(() => {
    if (!chatId) {
      return;
    }

    if (routeAppId) {
      if (routeAppId !== selectedAppIdRef.current) {
        selectedAppIdRef.current = routeAppId;
        setSelectedAppId(routeAppId);
      }
      return;
    }

    // If chatId is already in our loaded chats list, selectedAppId is correct
    // for this chat (useChats filters by selectedAppId), so skip the IPC fetch.
    if (chats.some((c) => c.id === chatId)) {
      return;
    }

    let isCancelled = false;
    ipc.chat
      .getChat(chatId)
      .then((chat) => {
        if (!isCancelled && chat.appId !== selectedAppIdRef.current) {
          selectedAppIdRef.current = chat.appId;
          setSelectedAppId(chat.appId);
        }
      })
      .catch(() => {
        // Let the chat panel surface any load error for the selected chat.
      });
    return () => {
      isCancelled = true;
    };
  }, [chatId, routeAppId, chats, setSelectedAppId]);

  useEffect(() => {
    if (isPreviewOpen) {
      ref.current?.expand();
    } else {
      ref.current?.collapse();
    }
  }, [isPreviewOpen]);
  const ref = useRef<ImperativePanelHandle>(null);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const panelGroupRef = useRef<ImperativePanelGroupHandle>(null);

  // Code mode has its own wider preview layout. Keep both profiles so switching
  // modes does not destroy a layout the user tuned for chat or preview work.
  useEffect(() => {
    if (!panelGroupRef.current || !isPreviewOpen) return;
    if (isChatPanelHidden) {
      panelGroupRef.current.setLayout([1, 99]);
    } else {
      const chatSize = workspacePanelSizes[layoutProfile];
      panelGroupRef.current.setLayout([chatSize, 100 - chatSize]);
    }
  }, [isChatPanelHidden, isPreviewOpen, layoutProfile, workspacePanelSizes]);

  return (
    <PanelGroup
      ref={panelGroupRef}
      direction="horizontal"
      onLayout={(sizes) => {
        latestLayoutRef.current = sizes;
      }}
    >
      <Panel
        id="chat-panel"
        ref={chatPanelRef}
        collapsible
        minSize={1}
        defaultSize={workspacePanelSizes[layoutProfile]}
        className={cn(!isResizing && "transition-all duration-100 ease-in-out")}
      >
        <div className="h-full w-full">
          {!isChatPanelHidden && (
            <ChatPanel
              chatId={chatId}
              isPreviewOpen={isPreviewOpen}
              onTogglePreview={() => {
                setIsPreviewOpen(!isPreviewOpen);
                if (isPreviewOpen) {
                  ref.current?.collapse();
                } else {
                  ref.current?.expand();
                }
              }}
            />
          )}
        </div>
      </Panel>
      <PanelResizeHandle
        onDragging={(isDragging) => {
          setIsResizing(isDragging);
          // When dragging ends, sync the hidden state based on final width
          if (!isDragging) {
            const [chatSize = 0] = latestLayoutRef.current;
            // Small delay to let the panel settle
            requestAnimationFrame(() => {
              const panel = document.getElementById("chat-panel");
              if (panel) {
                const panelWidth = panel.getBoundingClientRect().width;
                const containerWidth =
                  panel.parentElement?.getBoundingClientRect().width || 1;
                const percentage = (panelWidth / containerWidth) * 100;
                // Consider hidden if panel is less than 5% width
                const isHidden = percentage < 5;
                setIsChatPanelHidden(isHidden);
                if (!isHidden && chatSize >= 5) {
                  setWorkspacePanelSizes((current) => ({
                    ...current,
                    [layoutProfile]: chatSize,
                  }));
                }
              }
            });
          }
        }}
        className={cn(
          "relative bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors cursor-col-resize",
          isChatPanelHidden ? "w-2" : "w-1",
        )}
      />

      <Panel
        collapsible
        ref={ref}
        id="preview-panel"
        minSize={20}
        defaultSize={100 - workspacePanelSizes[layoutProfile]}
        className={cn(!isResizing && "transition-all duration-100 ease-in-out")}
      >
        <PreviewPanel />
      </Panel>
    </PanelGroup>
  );
}
