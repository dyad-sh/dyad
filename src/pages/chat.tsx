import { useState, useRef, useEffect, useMemo } from "react";
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { ChatPanel } from "../components/ChatPanel";
import { PreviewPanel } from "../components/preview_panel/PreviewPanel";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { isPreviewOpenAtom, isChatPanelHiddenAtom } from "@/atoms/viewAtoms";
import { useChats } from "@/hooks/useChats";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { ipc } from "@/ipc/types";
import {
  chatWorkspaceByAppIdAtom,
  getVisibleChatViewIds,
  getVisibleWorkspaceChatIds,
  hideChatFromWorkspaceAtom,
  pruneChatWorkspaceAtom,
} from "@/atoms/chatWorkspaceAtoms";
import { Button } from "@/components/ui/button";
import { PanelsTopLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

const DEFAULT_CHAT_PANEL_SIZE = 50;

export default function ChatPage() {
  const { t } = useTranslation("chat");
  const {
    id: chatId,
    appId: routeAppId,
    workspace: isWorkspaceRoute = false,
  } = useSearch({ from: "/chat" });
  const navigate = useNavigate();
  const [isPreviewOpen, setIsPreviewOpen] = useAtom(isPreviewOpenAtom);
  const [isChatPanelHidden, setIsChatPanelHidden] = useAtom(
    isChatPanelHiddenAtom,
  );
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const store = useStore();
  const [isResizing, setIsResizing] = useState(false);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const { chats, loading } = useChats(selectedAppId);
  const workspaces = useAtomValue(chatWorkspaceByAppIdAtom);
  const hideChatFromWorkspace = useSetAtom(hideChatFromWorkspaceAtom);
  const pruneChatWorkspace = useSetAtom(pruneChatWorkspaceAtom);
  const validChatIds = useMemo(
    () => new Set(chats.map((chat) => chat.id)),
    [chats],
  );
  const workspaceChatIds = useMemo(
    () =>
      getVisibleWorkspaceChatIds(
        selectedAppId === null
          ? []
          : (workspaces[selectedAppId]?.visibleChatIds ?? []),
        validChatIds,
      ),
    [selectedAppId, validChatIds, workspaces],
  );
  const visibleChatIds = useMemo(
    () =>
      getVisibleChatViewIds({
        workspaceChatIds,
        focusedChatId: chatId,
        validChatIds,
        isWorkspaceView: isWorkspaceRoute,
      }),
    [chatId, isWorkspaceRoute, validChatIds, workspaceChatIds],
  );
  const isWorkspaceView = isWorkspaceRoute && workspaceChatIds.length > 0;
  const isMultiChatWorkspace = isWorkspaceView && workspaceChatIds.length > 1;
  const previousSizeRef = useRef<number>(DEFAULT_CHAT_PANEL_SIZE);
  const isInitialMountRef = useRef(true);
  const selectedAppIdRef = useRef(selectedAppId);

  useEffect(() => {
    selectedAppIdRef.current = selectedAppId;
  }, [selectedAppId]);

  // Sync selectedChatIdAtom with the chatId from the URL
  useEffect(() => {
    setSelectedChatId(chatId ?? null);
  }, [chatId, setSelectedChatId]);

  useEffect(() => {
    if (selectedAppId === null || loading) return;
    pruneChatWorkspace({
      appId: selectedAppId,
      validChatIds,
    });
  }, [loading, pruneChatWorkspace, selectedAppId, validChatIds]);

  useEffect(() => {
    if (chatId || loading) {
      return;
    }

    if (!selectedAppId) {
      navigate({ to: "/", replace: true });
      return;
    }

    if (routeAppId && routeAppId !== selectedAppId) {
      return;
    }

    if (isWorkspaceRoute && workspaceChatIds.length > 0) {
      navigate({
        to: "/chat",
        search: {
          id: workspaceChatIds[0],
          appId: selectedAppId,
          workspace: true,
        },
        replace: true,
      });
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
  }, [
    chatId,
    chats,
    isWorkspaceRoute,
    loading,
    navigate,
    routeAppId,
    selectedAppId,
    setSelectedAppId,
    workspaceChatIds,
  ]);

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
    if (
      !isWorkspaceRoute ||
      chatId === undefined ||
      loading ||
      selectedAppId === null ||
      (routeAppId !== undefined && routeAppId !== selectedAppId)
    ) {
      return;
    }

    if (workspaceChatIds.includes(chatId)) {
      return;
    }

    const nextWorkspaceChatId = workspaceChatIds[0];
    if (nextWorkspaceChatId !== undefined) {
      setSelectedChatId(nextWorkspaceChatId);
      navigate({
        to: "/chat",
        search: {
          id: nextWorkspaceChatId,
          appId: selectedAppId,
          workspace: true,
        },
        replace: true,
      });
      return;
    }

    if (validChatIds.has(chatId)) {
      navigate({
        to: "/chat",
        search: { id: chatId, appId: selectedAppId },
        replace: true,
      });
    }
  }, [
    chatId,
    isWorkspaceRoute,
    loading,
    navigate,
    routeAppId,
    selectedAppId,
    setSelectedChatId,
    validChatIds,
    workspaceChatIds,
  ]);

  useEffect(() => {
    if (isPreviewOpen) {
      ref.current?.expand();
    } else {
      ref.current?.collapse();
    }
  }, [isPreviewOpen]);
  const ref = useRef<ImperativePanelHandle>(null);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);

  const focusChat = (nextChatId: number, target: EventTarget | null) => {
    if (
      target instanceof Element &&
      target.closest("[data-workspace-remove]")
    ) {
      return;
    }
    if (nextChatId === chatId || selectedAppId === null) return;
    store.set(selectedChatIdAtom, nextChatId);
    void navigate({
      to: "/chat",
      search: { id: nextChatId, appId: selectedAppId, workspace: true },
      replace: true,
    });
  };

  const removeChatFromWorkspace = (removedChatId: number) => {
    if (selectedAppId === null) return;
    const nextWorkspaceChatId = workspaceChatIds.find(
      (id) => id !== removedChatId,
    );
    hideChatFromWorkspace({ appId: selectedAppId, chatId: removedChatId });

    if (removedChatId === chatId && nextWorkspaceChatId !== undefined) {
      store.set(selectedChatIdAtom, nextWorkspaceChatId);
      void navigate({
        to: "/chat",
        search: {
          id: nextWorkspaceChatId,
          appId: selectedAppId,
          workspace: true,
        },
        replace: true,
      });
    }
  };

  // Keep chat panel size in sync with hidden state (from toolbar button / other views)
  useEffect(() => {
    if (!chatPanelRef.current) return;
    // Skip the initial mount to preserve persisted panel size from autoSaveId
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    if (isChatPanelHidden) {
      // Save current size before collapsing
      const currentSize = chatPanelRef.current.getSize();
      if (currentSize > 5) {
        previousSizeRef.current = currentSize;
      }
      // Visually collapsed but keep a sliver so the handle is usable
      chatPanelRef.current.resize(1);
    } else {
      // Restore to previous size when re-opened via button
      chatPanelRef.current.resize(previousSizeRef.current);
    }
  }, [isChatPanelHidden]);

  return (
    <PanelGroup autoSaveId="persistence" direction="horizontal">
      <Panel
        id="chat-panel"
        ref={chatPanelRef}
        collapsible
        minSize={1}
        className={cn(!isResizing && "transition-all duration-100 ease-in-out")}
      >
        <div className="flex h-full w-full flex-col">
          {!isChatPanelHidden && (
            <>
              {isWorkspaceView && (
                <div className="flex h-9 shrink-0 items-center justify-between border-b bg-muted/40 px-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <PanelsTopLeft className="h-3.5 w-3.5" />
                    <span>
                      {t("workspaceChatCount", {
                        count: workspaceChatIds.length,
                      })}
                    </span>
                  </div>
                  {isMultiChatWorkspace && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        if (selectedAppId === null || chatId === undefined)
                          return;
                        void navigate({
                          to: "/chat",
                          search: { id: chatId, appId: selectedAppId },
                        });
                      }}
                    >
                      {t("openFocusedChat")}
                    </Button>
                  )}
                </div>
              )}
              <div
                className={cn(
                  "min-h-0 flex-1 overflow-hidden",
                  isMultiChatWorkspace &&
                    "scrollbar-on-hover grid auto-rows-[minmax(320px,1fr)] grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-1 overflow-auto bg-border p-1",
                )}
                data-testid="chat-workspace"
              >
                {visibleChatIds.map((workspaceChatId) => {
                  const isFocused = workspaceChatId === chatId;
                  const workspaceChat = chats.find(
                    (chat) => chat.id === workspaceChatId,
                  );
                  const chatLabel =
                    workspaceChat?.title?.trim() || `Chat ${workspaceChatId}`;
                  return (
                    <section
                      key={workspaceChatId}
                      aria-label={
                        isFocused
                          ? t("focusedChatAria", { title: chatLabel })
                          : chatLabel
                      }
                      data-testid={`chat-workspace-pane-${workspaceChatId}`}
                      className={cn(
                        "relative min-h-0 overflow-hidden bg-background",
                        !isMultiChatWorkspace && "h-full",
                        isMultiChatWorkspace && "rounded-md border-2",
                        isFocused ? "border-primary" : "border-transparent",
                      )}
                      onPointerDownCapture={(event) =>
                        focusChat(workspaceChatId, event.target)
                      }
                      onFocusCapture={(event) =>
                        focusChat(workspaceChatId, event.target)
                      }
                    >
                      <ChatPanel
                        chatId={workspaceChatId}
                        isFocused={isFocused}
                        onRemoveFromWorkspace={
                          isMultiChatWorkspace && selectedAppId !== null
                            ? () => removeChatFromWorkspace(workspaceChatId)
                            : undefined
                        }
                        removeFromWorkspaceLabel={t(
                          "removeFromWorkspaceNamed",
                          { title: chatLabel },
                        )}
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
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </Panel>
      <PanelResizeHandle
        onDragging={(isDragging) => {
          setIsResizing(isDragging);
          // When dragging ends, sync the hidden state based on final width
          if (!isDragging) {
            // Small delay to let the panel settle
            requestAnimationFrame(() => {
              const panel = document.getElementById("chat-panel");
              if (panel) {
                const panelWidth = panel.getBoundingClientRect().width;
                const containerWidth =
                  panel.parentElement?.getBoundingClientRect().width || 1;
                const percentage = (panelWidth / containerWidth) * 100;
                // Consider hidden if panel is less than 5% width
                setIsChatPanelHidden(percentage < 5);
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
        className={cn(!isResizing && "transition-all duration-100 ease-in-out")}
      >
        <PreviewPanel />
      </Panel>
    </PanelGroup>
  );
}
