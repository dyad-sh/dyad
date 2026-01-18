import { useState, useRef, useEffect } from "react";
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
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { isPreviewOpenAtom, isChatPanelHiddenAtom } from "@/atoms/viewAtoms";
import { useChats } from "@/hooks/useChats";
import { selectedAppIdAtom } from "@/atoms/appAtoms";

export default function ChatPage() {
  const { id: chatId } = useSearch({ from: "/chat" });
  const navigate = useNavigate();
  const [isPreviewOpen, setIsPreviewOpen] = useAtom(isPreviewOpenAtom);
  const [isChatPanelHidden, setIsChatPanelHidden] = useAtom(
    isChatPanelHiddenAtom,
  );
  const [isResizing, setIsResizing] = useState(false);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const { chats, loading } = useChats(selectedAppId);

  useEffect(() => {
    if (!chatId && chats.length && !loading) {
      // Not a real navigation, just a redirect, when the user navigates to /chat
      // without a chatId, we redirect to the first chat
      setSelectedAppId(chats[0].appId);
      navigate({ to: "/chat", search: { id: chats[0].id }, replace: true });
    }
  }, [chatId, chats, loading, navigate]);

  useEffect(() => {
    if (isPreviewOpen) {
      ref.current?.expand();
    } else {
      ref.current?.collapse();
    }
  }, [isPreviewOpen]);
  const ref = useRef<ImperativePanelHandle>(null);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);

  useEffect(() => {
    if (isChatPanelHidden) {
      chatPanelRef.current?.collapse();
    } else {
      chatPanelRef.current?.expand();
    }
  }, [isChatPanelHidden]);

  return (
    <PanelGroup autoSaveId="persistence" direction="horizontal">
      <Panel
        id="chat-panel"
        ref={chatPanelRef}
        collapsible
        minSize={30}
        onCollapse={() => setIsChatPanelHidden(true)}
        onExpand={() => setIsChatPanelHidden(false)}
        className={cn(!isResizing && "transition-all duration-100 ease-in-out")}
      >
        <div className="h-full w-full">
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
        </div>
      </Panel>
      <PanelResizeHandle
        onDragging={(e) => setIsResizing(e)}
        className="w-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors cursor-col-resize"
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
