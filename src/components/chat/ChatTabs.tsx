import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { Loader2, MoreHorizontal, PanelsTopLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatSummary } from "@/lib/schemas";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useChats } from "@/hooks/useChats";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useSelectChat } from "@/hooks/useSelectChat";
import { useIsMac } from "@/hooks/useChatModeToggle";
import {
  recentViewedChatIdsAtom,
  selectedChatIdAtom,
  setRecentViewedChatIdsAtom,
  pushRecentViewedChatIdAtom,
  closedChatIdsAtom,
  pruneClosedChatIdsAtom,
  sessionOpenedChatIdsAtom,
  closeMultipleTabsAtom,
  hydrateChatTabSessionAtom,
  persistChatTabSessionAtom,
  groupTabsByAppAtom,
  type ClosedTabRecord,
  chatInputValuesByIdAtom,
  ensureRecentViewedChatIdAtom,
  removeTransferredChatTabAtom,
  attachmentsAtom,
} from "@/atoms/chatAtoms";
import {
  editorCursorAtom,
  isChatPanelHiddenAtom,
  isPreviewOpenAtom,
  selectedFileAtom,
  stagedDiffFileAtom,
} from "@/atoms/viewAtoms";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { resetCommitDialogAtom } from "@/atoms/commitAtoms";
import { selectedComponentsPreviewAtom } from "@/atoms/previewAtoms";
import { terminalOpenByChatIdAtom } from "@/atoms/terminalAtoms";
import {
  assertActiveStoredChatTabInstance,
  adoptStoredChatTab,
  chatTabSessionStorageKey,
  clearSourceChatTabRemoval,
  getActiveStoredChatTab,
  getActiveStoredChatTabs,
  getActiveWindowSessionId,
  hasSourceChatTabRemoval,
  markSourceChatTabRemoval,
  removeActiveStoredChatTab,
} from "@/window_infrastructure/chat_tab_session_storage";
import type { TabInstanceId } from "@/window_infrastructure/types";
import { ipc } from "@/ipc/types";
import { usePreviewIframeManager } from "@/preview_iframe/PreviewIframeProvider";
import { showError } from "@/lib/toast";
import { useSettings } from "@/hooks/useSettings";
import { useReopenClosedTab } from "@/hooks/useReopenClosedTab";
import { useStreamFinished } from "@/chat_stream/ChatStreamProvider";
import { cn } from "@/lib/utils";
import { AppAvatar } from "@/components/AppAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useChatStreamState } from "@/hooks/useChatStream";
import { isStreamActive } from "@/chat_stream/transition";
import {
  chatNavigationEvents,
  earlyChatTabRemovalEvents,
} from "@/app_wiring/early_renderer_events";
import type { ChatTabPresentationState } from "@/window_infrastructure/types";
import {
  chatWorkspaceByAppIdAtom,
  hideChatFromWorkspaceAtom,
  showChatInWorkspaceAtom,
  type ChatWorkspaceByAppId,
} from "@/atoms/chatWorkspaceAtoms";

const MIN_VISIBLE_TAB_WIDTH_PX = 160;
const TAB_GAP_PX = 4;
const OVERFLOW_TRIGGER_WIDTH_PX = 36;
const DEFAULT_UNMEASURED_VISIBLE_TABS = 3;
const MAX_OVERFLOW_MENU_ITEMS = 8;
const CHAT_TAB_TRANSFER_MIME = "application/x-dyad-chat-tab-transfer";
const SCROLL_RESTORE_MAX_FRAMES = 120;
const SCROLL_RESTORE_STABILIZATION_FRAMES = 4;

function getMessagesScrollViewport(chatId?: number): HTMLElement | null {
  const root =
    chatId === undefined
      ? document
      : document.querySelector<HTMLElement>(`[data-chat-id="${chatId}"]`);
  if (!root) return null;
  const wrapper = root.querySelector<HTMLElement>(
    '[data-testid="messages-list"]',
  );
  return (
    wrapper?.querySelector<HTMLElement>("[data-virtuoso-scroller]") ?? wrapper
  );
}

export function restoreLocalStorageSnapshot(
  key: string,
  value: string | null,
): void {
  if (value === null) {
    window.localStorage.removeItem(key);
  } else {
    window.localStorage.setItem(key, value);
  }
  if (window.localStorage.getItem(key) !== value) {
    throw new Error("Failed to durably restore chat tab session storage");
  }
}

export function restoreMessagesScrollTop(
  scrollTop: number,
  shouldContinue: () => boolean,
  chatId?: number,
): void {
  let remainingFrames = SCROLL_RESTORE_MAX_FRAMES;
  let stableFrames = 0;
  const apply = () => {
    if (!shouldContinue()) return;
    const viewport = getMessagesScrollViewport(chatId);
    if (viewport) {
      viewport.scrollTop = scrollTop;
      if (
        scrollTop === 0 ||
        viewport.scrollHeight >= scrollTop + viewport.clientHeight
      ) {
        stableFrames += 1;
        if (stableFrames >= SCROLL_RESTORE_STABILIZATION_FRAMES) return;
      } else {
        stableFrames = 0;
      }
    }
    remainingFrames -= 1;
    if (remainingFrames > 0) requestAnimationFrame(apply);
  };
  requestAnimationFrame(apply);
}

export function shouldRestorePriorNavigationAfterAdoption(
  currentSelectedChatId: number | null,
  adoptedChatId: number,
  currentPathname: string,
  currentHref: string,
  previousHref: string,
): boolean {
  return (
    currentSelectedChatId === adoptedChatId &&
    (currentPathname === "/chat" || currentHref === previousHref)
  );
}

export function restoreOrderedIdAfterRollback(
  current: number[],
  previous: number[],
  id: number,
): number[] {
  const withoutId = current.filter((candidate) => candidate !== id);
  const previousIndex = previous.indexOf(id);
  if (previousIndex === -1) return withoutId;

  const following = previous
    .slice(previousIndex + 1)
    .find((candidate) => withoutId.includes(candidate));
  if (following !== undefined) {
    const insertionIndex = withoutId.indexOf(following);
    return [
      ...withoutId.slice(0, insertionIndex),
      id,
      ...withoutId.slice(insertionIndex),
    ];
  }
  const preceding = previous
    .slice(0, previousIndex)
    .reverse()
    .find((candidate) => withoutId.includes(candidate));
  if (preceding !== undefined) {
    const insertionIndex = withoutId.indexOf(preceding) + 1;
    return [
      ...withoutId.slice(0, insertionIndex),
      id,
      ...withoutId.slice(insertionIndex),
    ];
  }
  return [id, ...withoutId];
}

/**
 * Returns an ordered list of chat IDs to display as tabs.
 *
 * @param recentViewedChatIds - IDs in the order they were recently viewed
 * @param chats - All available chats
 * @param closedChatIds - IDs of explicitly closed tabs
 * @param sessionOpenedChatIds - IDs of chats opened in the current session.
 *   If empty, no tabs will be shown (session-scoped behavior). This is intentional:
 *   tabs only appear for chats explicitly opened during the current app session.
 */
export function getOrderedRecentChatIds(
  recentViewedChatIds: number[],
  chats: ChatSummary[],
  closedChatIds: Set<number> = new Set(),
  sessionOpenedChatIds: Set<number> = new Set(),
): number[] {
  if (chats.length === 0) return [];

  const chatIds = new Set(chats.map((chat) => chat.id));
  const ordered: number[] = [];
  const seen = new Set<number>();

  // Helper to check if a chat ID should be shown as a tab
  const canShow = (id: number) =>
    !seen.has(id) && !closedChatIds.has(id) && sessionOpenedChatIds.has(id);

  for (const chatId of recentViewedChatIds) {
    if (chatIds.has(chatId) && canShow(chatId)) {
      ordered.push(chatId);
      seen.add(chatId);
    }
  }

  // Add remaining chats that were opened in this session but not in recentViewedChatIds
  for (const chat of chats) {
    if (canShow(chat.id)) {
      ordered.push(chat.id);
      seen.add(chat.id);
    }
  }

  return ordered;
}

export function addFinishedChatNotification(
  notifiedChatIds: Set<number>,
  finishedChatId: number,
  selectedChatId: number | null,
): Set<number> {
  if (
    finishedChatId === selectedChatId ||
    notifiedChatIds.has(finishedChatId)
  ) {
    return notifiedChatIds;
  }
  const next = new Set(notifiedChatIds);
  next.add(finishedChatId);
  return next;
}

export function getVisibleTabCapacity(
  containerWidth: number,
  totalTabs: number,
  minTabWidth = MIN_VISIBLE_TAB_WIDTH_PX,
): number {
  if (containerWidth <= 0 || totalTabs <= 0) return 0;

  const withoutOverflow = Math.max(
    1,
    Math.floor((containerWidth + TAB_GAP_PX) / (minTabWidth + TAB_GAP_PX)),
  );

  if (totalTabs <= withoutOverflow) {
    return withoutOverflow;
  }

  const withOverflow = Math.max(
    1,
    Math.floor(
      (containerWidth - OVERFLOW_TRIGGER_WIDTH_PX + TAB_GAP_PX) /
        (minTabWidth + TAB_GAP_PX),
    ),
  );

  return Math.min(withOverflow, totalTabs);
}

export function getVisibleWorkspaceTabCount(
  totalVisibleTabCount: number,
  workspaceTabCount: number,
  chatTabCount: number,
): number {
  return Math.min(
    workspaceTabCount,
    Math.max(totalVisibleTabCount - (chatTabCount > 0 ? 1 : 0), 0),
    1,
  );
}

export function applySelectionToOrderedChatIds(
  orderedChatIds: number[],
  selectedChatId: number,
  visibleTabCount: number,
): number[] {
  const selectedIndex = orderedChatIds.indexOf(selectedChatId);
  if (selectedIndex === -1 || visibleTabCount <= 0) {
    // Unknown chat ID — don't modify the order. The caller should
    // ensure selectedChatId is valid before invoking this function.
    return orderedChatIds;
  }

  if (selectedIndex < visibleTabCount) {
    return orderedChatIds;
  }

  const nextIds = [...orderedChatIds];
  nextIds.splice(selectedIndex, 1);
  nextIds.splice(Math.max(visibleTabCount - 1, 0), 0, selectedChatId);
  return nextIds;
}

export function reorderVisibleChatIds(
  orderedChatIds: number[],
  visibleTabCount: number,
  sourceChatId: number,
  targetChatId: number,
): number[] {
  const visibleIds = orderedChatIds.slice(0, visibleTabCount);
  const sourceIndex = visibleIds.indexOf(sourceChatId);
  const targetIndex = visibleIds.indexOf(targetChatId);

  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return orderedChatIds;
  }

  const nextVisible = [...visibleIds];
  const [movedId] = nextVisible.splice(sourceIndex, 1);
  nextVisible.splice(targetIndex, 0, movedId);

  return [...nextVisible, ...orderedChatIds.slice(visibleTabCount)];
}

export function shouldPrepareCrossWindowTransfer(
  enableMultiWindow: boolean,
  hasAttachments = false,
): boolean {
  return enableMultiWindow && !hasAttachments;
}

export function shouldSkipChatSelection(
  selectedChatId: number | null,
  nextChatId: number,
  pathname: string,
  isWorkspaceRoute = false,
  nextIsWorkspaceRoute = false,
): boolean {
  return (
    selectedChatId === nextChatId &&
    pathname === "/chat" &&
    isWorkspaceRoute === nextIsWorkspaceRoute
  );
}

export function shouldCapturePresentationBeforeNavigation(
  presentedChatId: number | null,
  fromPathname: string | undefined,
  fromChatId: number | null,
  toPathname: string,
  toChatId: number | null,
): boolean {
  return (
    presentedChatId !== null &&
    fromPathname === "/chat" &&
    fromChatId === presentedChatId &&
    (toPathname !== "/chat" || toChatId !== presentedChatId)
  );
}

export function isIntraWorkspaceNavigation(
  fromPathname: string | undefined,
  fromSearch: { appId?: unknown; workspace?: unknown },
  toPathname: string,
  toSearch: { appId?: unknown; workspace?: unknown },
): boolean {
  return (
    fromPathname === "/chat" &&
    toPathname === "/chat" &&
    fromSearch.workspace === true &&
    toSearch.workspace === true &&
    typeof fromSearch.appId === "number" &&
    fromSearch.appId === toSearch.appId
  );
}

export function isIntraWorkspaceFocusChange({
  isWorkspaceRoute,
  workspaceAppId,
  previousChatId,
  selectedChatId,
  workspaces,
  chatsById,
}: {
  isWorkspaceRoute: boolean;
  workspaceAppId: number | undefined;
  previousChatId: number | null;
  selectedChatId: number | null;
  workspaces: ChatWorkspaceByAppId;
  chatsById: Map<number, ChatSummary>;
}): boolean {
  if (
    !isWorkspaceRoute ||
    workspaceAppId === undefined ||
    previousChatId === null ||
    selectedChatId === null ||
    previousChatId === selectedChatId
  ) {
    return false;
  }

  const workspaceChatIds = workspaces[workspaceAppId]?.visibleChatIds ?? [];
  return (
    workspaceChatIds.includes(previousChatId) &&
    workspaceChatIds.includes(selectedChatId) &&
    chatsById.get(previousChatId)?.appId === workspaceAppId &&
    chatsById.get(selectedChatId)?.appId === workspaceAppId
  );
}

export interface PreNavigationPresentationCapture {
  fromChatId: number;
  toChatId: number | null;
}

export function matchesPreNavigationPresentationCapture(
  capture: PreNavigationPresentationCapture | null,
  previousChatId: number | null,
  selectedChatId: number | null,
): boolean {
  return (
    capture?.fromChatId === previousChatId &&
    capture.toChatId === selectedChatId
  );
}

export function consumePreNavigationPresentationCapture(
  captureRef: { current: PreNavigationPresentationCapture | null },
  previousChatId: number | null,
  selectedChatId: number | null,
): boolean {
  const capture = captureRef.current;
  captureRef.current = null;
  return (
    previousChatId !== selectedChatId &&
    matchesPreNavigationPresentationCapture(
      capture,
      previousChatId,
      selectedChatId,
    )
  );
}

export function shouldRemoveTransferredChatFromRenderer(
  currentTabInstanceId: string | null,
  transferredTabInstanceId: string,
): boolean {
  return (
    currentTabInstanceId === null ||
    currentTabInstanceId === transferredTabInstanceId
  );
}

export function partitionChatsByVisibleCount(
  orderedChats: ChatSummary[],
  visibleTabCount: number,
  selectedChatId?: number | null,
): { visibleTabs: ChatSummary[]; overflowTabs: ChatSummary[] } {
  const selectedIndex = orderedChats.findIndex(
    (chat) => chat.id === selectedChatId,
  );
  if (visibleTabCount > 0 && selectedIndex >= visibleTabCount) {
    const selectedChat = orderedChats[selectedIndex];
    const visibleTabs = orderedChats.slice(0, visibleTabCount);
    const displacedTab = visibleTabs[visibleTabCount - 1];
    visibleTabs[visibleTabCount - 1] = selectedChat;
    return {
      visibleTabs,
      overflowTabs: [
        displacedTab,
        ...orderedChats
          .slice(visibleTabCount)
          .filter((chat) => chat.id !== selectedChatId),
      ],
    };
  }
  return {
    visibleTabs: orderedChats.slice(0, visibleTabCount),
    overflowTabs: orderedChats.slice(visibleTabCount),
  };
}

/**
 * Reorders chat IDs so that tabs for the same app are grouped together.
 * Within each app group the original relative order is preserved.
 * App groups are ordered by the position of their first chat in the input.
 */
export function groupChatIdsByApp(
  orderedChatIds: number[],
  chatsById: Map<number, ChatSummary>,
): number[] {
  // Build groups keyed by appId, preserving encounter order via a Map.
  const groups = new Map<number, number[]>();
  for (const chatId of orderedChatIds) {
    const chat = chatsById.get(chatId);
    const appId = chat?.appId ?? -1;
    let group = groups.get(appId);
    if (!group) {
      group = [];
      groups.set(appId, group);
    }
    group.push(chatId);
  }
  // Flatten groups (Map preserves insertion order → first-seen app comes first).
  return Array.from(groups.values()).flat();
}

export function getFallbackChatIdAfterClose(
  tabs: ChatSummary[],
  closedChatId: number,
): number | null {
  const closedIndex = tabs.findIndex((tab) => tab.id === closedChatId);
  if (closedIndex === -1) return null;

  const remainingTabs = tabs.filter((tab) => tab.id !== closedChatId);
  if (remainingTabs.length === 0) return null;

  const fallbackIndex = Math.min(closedIndex, remainingTabs.length - 1);
  return remainingTabs[fallbackIndex]?.id ?? null;
}

interface ChatTabsProps {
  selectedChatId: number | null;
}

export interface ChatWorkspaceTab {
  appId: number;
  chatIds: number[];
}

export function getChatWorkspaceTabs(
  workspaces: ChatWorkspaceByAppId,
  chats: ChatSummary[],
): ChatWorkspaceTab[] {
  const chatAppById = new Map(chats.map((chat) => [chat.id, chat.appId]));

  return Object.entries(workspaces)
    .map(([rawAppId, workspace]) => {
      const appId = Number(rawAppId);
      const chatIds = Array.from(new Set(workspace.visibleChatIds)).filter(
        (chatId) => chatAppById.get(chatId) === appId,
      );
      return { appId, chatIds };
    })
    .filter((workspace) => workspace.chatIds.length > 0)
    .sort((left, right) => left.appId - right.appId);
}

function ChatTabActivity({
  chatId,
  notified,
}: {
  chatId: number;
  notified: boolean;
}) {
  const { t } = useTranslation("chat");
  const streamState = useChatStreamState(chatId) ?? { type: "idle" };
  if (isStreamActive(streamState)) {
    return (
      <span
        className="flex items-center text-purple-600"
        aria-label={t("chatInProgress")}
        title={t("chatInProgress")}
      >
        <Loader2 size={12} className="animate-spin" />
      </span>
    );
  }
  if (!notified) return null;
  return (
    <span
      className="flex items-center"
      aria-label={t("newActivity")}
      title={t("newActivity")}
    >
      <span className="h-2 w-2 rounded-full bg-blue-500" />
    </span>
  );
}

export function ChatTabs({ selectedChatId }: ChatTabsProps) {
  const { t } = useTranslation("chat");
  const { chats, loading } = useChats(null);
  const { apps } = useLoadApps();
  const { settings } = useSettings();
  const enableMultiWindow = !!settings?.enableMultiWindow;
  const store = useStore();
  const previewIframeManager = usePreviewIframeManager();
  const recentViewedChatIds = useAtomValue(recentViewedChatIdsAtom);
  const closedChatIds = useAtomValue(closedChatIdsAtom);
  const sessionOpenedChatIds = useAtomValue(sessionOpenedChatIdsAtom);
  const groupTabsByApp = useAtomValue(groupTabsByAppAtom);
  const setGroupTabsByApp = useSetAtom(groupTabsByAppAtom);
  const setRecentViewedChatIds = useSetAtom(setRecentViewedChatIdsAtom);
  const pushRecentViewedChatId = useSetAtom(pushRecentViewedChatIdAtom);
  const pruneClosedChatIds = useSetAtom(pruneClosedChatIdsAtom);
  const closeMultipleTabs = useSetAtom(closeMultipleTabsAtom);
  const hydrateChatTabSession = useSetAtom(hydrateChatTabSessionAtom);
  const persistChatTabSession = useSetAtom(persistChatTabSessionAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const workspaces = useAtomValue(chatWorkspaceByAppIdAtom);
  const showChatInWorkspace = useSetAtom(showChatInWorkspaceAtom);
  const hideChatFromWorkspace = useSetAtom(hideChatFromWorkspaceAtom);
  const { reopenClosedTab, hasClosedTabs, lastClosedTab } =
    useReopenClosedTab();
  const { selectChat } = useSelectChat();
  const navigate = useNavigate();
  const router = useRouter();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const routeSearch = useRouterState({
    select: (state) => state.location.search,
  }) as { appId?: number; workspace?: boolean };
  const isWorkspaceRoute =
    pathname === "/chat" && routeSearch.workspace === true;
  const workspaceRouteAppId = isWorkspaceRoute ? routeSearch.appId : undefined;
  const locationHref = useRouterState({
    select: (state) => state.location.href,
  });
  const isMac = useIsMac();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [draggingChatId, setDraggingChatId] = useState<number | null>(null);
  const [notifiedChatIds, setNotifiedChatIds] = useState<Set<number>>(
    new Set(),
  );
  const hasHydratedTabSessionRef = useRef(false);
  const [hasHydratedTabSession, setHasHydratedTabSession] = useState(false);
  const scrollRestoreGenerationRef = useRef(0);
  const presentationByChatIdRef = useRef(
    new Map<number, ChatTabPresentationState>(),
  );
  const presentedChatIdRef = useRef(selectedChatId);
  const preNavigationPresentationCaptureRef =
    useRef<PreNavigationPresentationCapture | null>(null);
  useEffect(
    () => () => {
      scrollRestoreGenerationRef.current += 1;
    },
    [],
  );
  const chatsById = useMemo(
    () => new Map(chats.map((chat) => [chat.id, chat])),
    [chats],
  );
  const workspaceTabs = useMemo(() => {
    const tabs = getChatWorkspaceTabs(workspaces, chats);
    if (workspaceRouteAppId === undefined) return tabs;
    return [
      ...tabs.filter((tab) => tab.appId === workspaceRouteAppId),
      ...tabs.filter((tab) => tab.appId !== workspaceRouteAppId),
    ];
  }, [chats, workspaces, workspaceRouteAppId]);
  const publishChatTabOwnership = useCallback(async () => {
    await ipc.windowInfrastructure.setChatTabOwnership(
      getActiveStoredChatTabs(),
    );
  }, []);

  const neutralPresentation = useCallback(
    (chatId: number): ChatTabPresentationState => ({
      draftInput: store.get(chatInputValuesByIdAtom).get(chatId) ?? "",
      scrollTop: 0,
      selectedFile: null,
      editorCursor: null,
      stagedDiffFile: null,
      previewHistory: [],
      previewHistoryPosition: 0,
      previewRouteSource: "none",
      previewMode: "preview",
      isPreviewOpen: true,
      isChatPanelHidden: false,
      terminalOpen: store.get(terminalOpenByChatIdAtom).get(chatId) ?? false,
      selectedComponents: [],
    }),
    [store],
  );

  const capturePresentation = useCallback(
    (chatId: number, appId: number) => {
      const messages = getMessagesScrollViewport(chatId);
      if (
        pathname !== "/chat" ||
        presentedChatIdRef.current !== chatId ||
        !messages
      ) {
        return (
          presentationByChatIdRef.current.get(chatId) ??
          neutralPresentation(chatId)
        );
      }
      const iframe = previewIframeManager.getSnapshot(appId);
      return {
        draftInput: store.get(chatInputValuesByIdAtom).get(chatId) ?? "",
        scrollTop: messages.scrollTop,
        selectedFile: store.get(selectedFileAtom),
        editorCursor: store.get(editorCursorAtom),
        stagedDiffFile: store.get(stagedDiffFileAtom),
        previewHistory: [...iframe.history],
        previewHistoryPosition: iframe.position,
        previewRouteSource: iframe.currentUrlSource,
        previewMode: store.get(previewModeAtom),
        isPreviewOpen: store.get(isPreviewOpenAtom),
        isChatPanelHidden: store.get(isChatPanelHiddenAtom),
        terminalOpen: store.get(terminalOpenByChatIdAtom).get(chatId) ?? false,
        selectedComponents: store.get(selectedComponentsPreviewAtom),
      };
    },
    [neutralPresentation, pathname, previewIframeManager, store],
  );

  const restorePresentation = useCallback(
    (
      presentation: ChatTabPresentationState,
      appId: number,
      options: { restoreComponents?: boolean; chatId?: number } = {},
    ) => {
      store.set(selectedFileAtom, presentation.selectedFile);
      store.set(editorCursorAtom, presentation.editorCursor);
      // The tab's own staged diff replaces whatever was displayed, so a commit
      // dialog - or a pending return to one - belongs to the tab we just left.
      store.set(resetCommitDialogAtom);
      store.set(stagedDiffFileAtom, presentation.stagedDiffFile);
      store.set(previewModeAtom, presentation.previewMode);
      store.set(isPreviewOpenAtom, presentation.isPreviewOpen);
      store.set(isChatPanelHiddenAtom, presentation.isChatPanelHidden);
      const presentationChatId = options.chatId;
      if (presentationChatId !== undefined) {
        store.set(terminalOpenByChatIdAtom, (previous) => {
          const next = new Map(previous);
          next.set(presentationChatId, presentation.terminalOpen);
          return next;
        });
      }
      previewIframeManager.send(appId, {
        type: "RESTORE_PRESENTATION",
        history: presentation.previewHistory,
        position: presentation.previewHistoryPosition,
        source: presentation.previewRouteSource,
        preserveHistoryOnNextReplacement:
          !previewIframeManager.hasTarget(appId),
      });
      const scrollRestoreGeneration = ++scrollRestoreGenerationRef.current;
      restoreMessagesScrollTop(
        presentation.scrollTop,
        () =>
          scrollRestoreGeneration === scrollRestoreGenerationRef.current &&
          (options.chatId === undefined ||
            store.get(selectedChatIdAtom) === options.chatId),
        presentationChatId,
      );
      if (options.restoreComponents !== false) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (
              scrollRestoreGeneration !== scrollRestoreGenerationRef.current ||
              (options.chatId !== undefined &&
                store.get(selectedChatIdAtom) !== options.chatId)
            ) {
              return;
            }
            store.set(
              selectedComponentsPreviewAtom,
              presentation.selectedComponents,
            );
            previewIframeManager.send(appId, {
              type: "SELECTION_RESTORE_QUEUED",
            });
          });
        });
      }
    },
    [previewIframeManager, store],
  );

  useEffect(
    () =>
      router.subscribe("onBeforeNavigate", (navigation) => {
        const presentedChatId = presentedChatIdRef.current;
        if (presentedChatId === null) return;
        const fromSearch = navigation.fromLocation?.search as
          | { id?: unknown; appId?: unknown; workspace?: unknown }
          | undefined;
        const toSearch = navigation.toLocation.search as {
          id?: unknown;
          appId?: unknown;
          workspace?: unknown;
        };
        if (
          isIntraWorkspaceNavigation(
            navigation.fromLocation?.pathname,
            fromSearch ?? {},
            navigation.toLocation.pathname,
            toSearch,
          )
        ) {
          return;
        }
        const fromChatId =
          typeof fromSearch?.id === "number" ? fromSearch.id : null;
        const toChatId = typeof toSearch.id === "number" ? toSearch.id : null;
        if (
          !shouldCapturePresentationBeforeNavigation(
            presentedChatId,
            navigation.fromLocation?.pathname,
            fromChatId,
            navigation.toLocation.pathname,
            toChatId,
          )
        ) {
          return;
        }
        const presentedChat = chatsById.get(presentedChatId);
        if (!presentedChat) return;
        presentationByChatIdRef.current.set(
          presentedChatId,
          capturePresentation(presentedChatId, presentedChat.appId),
        );
        preNavigationPresentationCaptureRef.current = {
          fromChatId: presentedChatId,
          toChatId,
        };
      }),
    [capturePresentation, chatsById, router],
  );

  useLayoutEffect(() => {
    const previousChatId = presentedChatIdRef.current;
    const capturedBeforeNavigation = consumePreNavigationPresentationCapture(
      preNavigationPresentationCaptureRef,
      previousChatId,
      selectedChatId,
    );
    if (previousChatId === selectedChatId) return;

    if (
      isIntraWorkspaceFocusChange({
        isWorkspaceRoute,
        workspaceAppId: workspaceRouteAppId,
        previousChatId,
        selectedChatId,
        workspaces,
        chatsById,
      })
    ) {
      // Workspace panes remain mounted and own their scroll/input state. A
      // focus change only routes shared actions; it must not replay the
      // single-chat file/preview/panel presentation transition.
      scrollRestoreGenerationRef.current += 1;
      presentedChatIdRef.current = selectedChatId;
      return;
    }

    if (previousChatId !== null && !capturedBeforeNavigation) {
      const previousChat = chatsById.get(previousChatId);
      if (previousChat) {
        presentationByChatIdRef.current.set(
          previousChat.id,
          capturePresentation(previousChat.id, previousChat.appId),
        );
      }
    }

    if (selectedChatId === null) {
      scrollRestoreGenerationRef.current += 1;
    } else {
      const selectedChat = chatsById.get(selectedChatId);
      if (selectedChat) {
        const presentation =
          presentationByChatIdRef.current.get(selectedChat.id) ??
          neutralPresentation(selectedChat.id);
        restorePresentation(presentation, selectedChat.appId, {
          chatId: selectedChat.id,
        });
      }
    }
    presentedChatIdRef.current = selectedChatId;
  }, [
    capturePresentation,
    chatsById,
    isWorkspaceRoute,
    neutralPresentation,
    restorePresentation,
    selectedChatId,
    workspaces,
    workspaceRouteAppId,
  ]);

  const adoptCrossWindowTab = useCallback(
    async (transferId: string) => {
      const previousRecent = [...store.get(recentViewedChatIdsAtom)];
      const previousClosed = new Set(store.get(closedChatIdsAtom));
      const previousSession = new Set(store.get(sessionOpenedChatIdsAtom));
      const previousDrafts = new Map(store.get(chatInputValuesByIdAtom));
      const previousTerminals = new Map(store.get(terminalOpenByChatIdAtom));
      const previousSelectedChatId = store.get(selectedChatIdAtom);
      const previousSelectedAppId = store.get(selectedAppIdAtom);
      const previousLocationHref = locationHref;
      const previousWasChatRoute = pathname === "/chat";
      const previousSelectedFile = store.get(selectedFileAtom);
      const previousEditorCursor = store.get(editorCursorAtom);
      const previousStagedDiffFile = store.get(stagedDiffFileAtom);
      const previousPreviewMode = store.get(previewModeAtom);
      const previousIsPreviewOpen = store.get(isPreviewOpenAtom);
      const previousIsChatPanelHidden = store.get(isChatPanelHiddenAtom);
      const previousSelectedComponents = store.get(
        selectedComponentsPreviewAtom,
      );
      const previousIframe =
        previousSelectedAppId === null
          ? null
          : previewIframeManager.getSnapshot(previousSelectedAppId);
      const previousSelectedChat = chatsById.get(previousSelectedChatId ?? -1);
      const previousPresentation = previousSelectedChat
        ? capturePresentation(
            previousSelectedChat.id,
            previousSelectedChat.appId,
          )
        : null;
      let adoptedLocally = false;
      let adoptedChatId: number | null = null;
      let adoptedTabInstanceId: TabInstanceId | null = null;
      try {
        const payload = await ipc.windowInfrastructure.adoptChatTabTransfer({
          transferId,
        });
        if (getActiveStoredChatTab(payload.chatId)) {
          await ipc.windowInfrastructure.rejectChatTabTransfer({ transferId });
          throw new Error(
            "This window already has an independent tab for that chat",
          );
        }
        adoptStoredChatTab({
          tabInstanceId: payload.tabInstanceId,
          chatId: payload.chatId,
        });
        adoptedLocally = true;
        adoptedChatId = payload.chatId;
        adoptedTabInstanceId = payload.tabInstanceId;
        store.set(ensureRecentViewedChatIdAtom, payload.chatId);
        store.set(chatInputValuesByIdAtom, (previous) => {
          const next = new Map(previous);
          next.set(payload.chatId, payload.presentation.draftInput);
          return next;
        });
        store.set(terminalOpenByChatIdAtom, (previous) => {
          const next = new Map(previous);
          next.set(payload.chatId, payload.presentation.terminalOpen);
          return next;
        });
        presentationByChatIdRef.current.set(
          payload.chatId,
          payload.presentation,
        );
        selectChat({
          chatId: payload.chatId,
          appId: payload.appId,
          preserveTabOrder: true,
        });
        restorePresentation(payload.presentation, payload.appId, {
          chatId: payload.chatId,
        });
        presentedChatIdRef.current = payload.chatId;
        store.set(persistChatTabSessionAtom);
        assertActiveStoredChatTabInstance(payload.tabInstanceId, "present");
        await publishChatTabOwnership();
        await ipc.windowInfrastructure.acknowledgeChatTabTransfer({
          transferId,
        });
        clearSourceChatTabRemoval(transferId);
      } catch (error) {
        if (
          adoptedLocally &&
          adoptedTabInstanceId !== null &&
          hasSourceChatTabRemoval(transferId, adoptedTabInstanceId)
        ) {
          clearSourceChatTabRemoval(transferId);
          return;
        }
        if (adoptedLocally) {
          if (adoptedChatId === null || adoptedTabInstanceId === null) {
            await ipc.windowInfrastructure
              .rejectChatTabTransfer({ transferId })
              .catch(() => undefined);
            showError(new Error("The adopted chat tab identity is missing"));
            return;
          }
          const settlement = await ipc.windowInfrastructure
            .rejectChatTabTransfer({ transferId })
            .catch(() => ({ aborted: false }));
          if (!settlement.aborted) {
            if (hasSourceChatTabRemoval(transferId, adoptedTabInstanceId)) {
              clearSourceChatTabRemoval(transferId);
            } else {
              showError(
                new Error(
                  "The tab transfer could not be safely rolled back; the adopted tab was retained",
                ),
              );
            }
            return;
          }
          const rolledBackChatId = adoptedChatId;
          presentationByChatIdRef.current.delete(rolledBackChatId);
          try {
            removeActiveStoredChatTab(adoptedTabInstanceId);
          } catch (rollbackError) {
            showError(rollbackError);
            return;
          }
          store.set(recentViewedChatIdsAtom, (current) =>
            restoreOrderedIdAfterRollback(
              current,
              previousRecent,
              rolledBackChatId,
            ),
          );
          store.set(closedChatIdsAtom, (current) => {
            const next = new Set(current);
            if (previousClosed.has(rolledBackChatId))
              next.add(rolledBackChatId);
            else next.delete(rolledBackChatId);
            return next;
          });
          store.set(sessionOpenedChatIdsAtom, (current) => {
            const next = new Set(current);
            if (previousSession.has(rolledBackChatId))
              next.add(rolledBackChatId);
            else next.delete(rolledBackChatId);
            return next;
          });
          store.set(chatInputValuesByIdAtom, (current) => {
            const next = new Map(current);
            if (previousDrafts.has(rolledBackChatId)) {
              next.set(rolledBackChatId, previousDrafts.get(rolledBackChatId)!);
            } else {
              next.delete(rolledBackChatId);
            }
            return next;
          });
          store.set(terminalOpenByChatIdAtom, (current) => {
            const next = new Map(current);
            if (previousTerminals.has(rolledBackChatId)) {
              next.set(
                rolledBackChatId,
                previousTerminals.get(rolledBackChatId)!,
              );
            } else {
              next.delete(rolledBackChatId);
            }
            return next;
          });
          const currentHref = router.state.location.href;
          const shouldRestorePriorNavigation =
            shouldRestorePriorNavigationAfterAdoption(
              store.get(selectedChatIdAtom),
              rolledBackChatId,
              router.state.location.pathname,
              currentHref,
              previousLocationHref,
            );
          if (
            shouldRestorePriorNavigation &&
            previousWasChatRoute &&
            previousSelectedChat &&
            previousPresentation
          ) {
            selectChat({
              chatId: previousSelectedChat.id,
              appId: previousSelectedChat.appId,
              preserveTabOrder: true,
            });
            restorePresentation(
              previousPresentation,
              previousSelectedChat.appId,
              { chatId: previousSelectedChat.id },
            );
            presentedChatIdRef.current = previousSelectedChat.id;
          } else if (shouldRestorePriorNavigation) {
            scrollRestoreGenerationRef.current += 1;
            store.set(selectedChatIdAtom, null);
            presentedChatIdRef.current = null;
            store.set(selectedAppIdAtom, previousSelectedAppId);
            store.set(selectedFileAtom, previousSelectedFile);
            store.set(editorCursorAtom, previousEditorCursor);
            // This branch restores the presentation by hand rather than through
            // restorePresentation, so it has to drop the commit dialog itself:
            // the staged diff below replaces what was displayed, and no chat is
            // selected afterwards, so a dialog left open would belong to
            // nothing.
            store.set(resetCommitDialogAtom);
            store.set(stagedDiffFileAtom, previousStagedDiffFile);
            store.set(previewModeAtom, previousPreviewMode);
            store.set(isPreviewOpenAtom, previousIsPreviewOpen);
            store.set(isChatPanelHiddenAtom, previousIsChatPanelHidden);
            store.set(
              selectedComponentsPreviewAtom,
              previousSelectedComponents,
            );
            if (previousSelectedAppId !== null && previousIframe) {
              previewIframeManager.send(previousSelectedAppId, {
                type: "RESTORE_PRESENTATION",
                history: previousIframe.history,
                position: previousIframe.position,
                // This restores live state, which still carries its
                // provenance — the "app" default is only for presentations
                // saved before provenance was tracked. Dropping it here would
                // downgrade a route the user picked and send a recording
                // started afterwards to the app root instead.
                source: previousIframe.currentUrlSource,
              });
            }
            void navigate({ to: previousLocationHref });
          }
          await publishChatTabOwnership().catch(() => undefined);
        }
        if (!adoptedLocally) {
          await ipc.windowInfrastructure
            .rejectChatTabTransfer({ transferId })
            .catch(() => undefined);
        }
        showError(error);
      }
    },
    [
      capturePresentation,
      chatsById,
      locationHref,
      navigate,
      pathname,
      previewIframeManager,
      publishChatTabOwnership,
      restorePresentation,
      router,
      selectChat,
      store,
    ],
  );

  // Prune stale IDs from closedChatIds when the chat list changes
  const chatIdSet = useMemo(() => new Set(chats.map((c) => c.id)), [chats]);
  useEffect(() => {
    if (loading || hasHydratedTabSessionRef.current) {
      return;
    }

    hasHydratedTabSessionRef.current = true;
    const restoredSession = hydrateChatTabSession(chatIdSet);
    setHasHydratedTabSession(true);
    if (
      selectedChatId === null &&
      pathname === "/" &&
      restoredSession.selectedChatId !== null
    ) {
      const restoredChat = chatsById.get(restoredSession.selectedChatId);
      if (restoredChat) {
        selectChat({
          chatId: restoredChat.id,
          appId: restoredChat.appId,
          preserveTabOrder: true,
        });
      }
    }
  }, [
    chatIdSet,
    chatsById,
    hydrateChatTabSession,
    loading,
    pathname,
    selectedChatId,
    selectChat,
  ]);

  useEffect(() => {
    if (!hasHydratedTabSession) {
      return;
    }

    pruneClosedChatIds(chatIdSet);
  }, [chatIdSet, hasHydratedTabSession, pruneClosedChatIds]);

  useEffect(() => {
    if (!hasHydratedTabSession) {
      return;
    }

    persistChatTabSession();
    void publishChatTabOwnership().catch((error) =>
      console.error("Failed to publish chat tab ownership", error),
    );
  }, [
    closedChatIds,
    hasHydratedTabSession,
    persistChatTabSession,
    publishChatTabOwnership,
    recentViewedChatIds,
    selectedChatId,
    sessionOpenedChatIds,
  ]);

  const appById = useMemo(
    () => new Map(apps.map((app) => [app.id, app])),
    [apps],
  );

  const orderedChatIds = useMemo(() => {
    const base = getOrderedRecentChatIds(
      recentViewedChatIds,
      chats,
      closedChatIds,
      sessionOpenedChatIds,
    );
    // When grouping is enabled, re-bucket by app on every render so newly
    // opened chats automatically join their app's existing group.
    return groupTabsByApp ? groupChatIdsByApp(base, chatsById) : base;
  }, [
    recentViewedChatIds,
    chats,
    closedChatIds,
    sessionOpenedChatIds,
    groupTabsByApp,
    chatsById,
  ]);

  const orderedChats = useMemo(
    () =>
      orderedChatIds
        .map((chatId) => chatsById.get(chatId))
        .filter((chat): chat is ChatSummary => chat !== undefined),
    [orderedChatIds, chatsById],
  );

  useEffect(() => {
    if (!hasHydratedTabSession) return;
    return earlyChatTabRemovalEvents.subscribe(
      ({ transferId, tabInstanceId, chatId }) => {
        void (async () => {
          try {
            // Missing storage is not a removal receipt: cross-window startup
            // deduplication can remove the durable entry while this renderer
            // still owns the live tab. Always reconcile the in-memory state.
            const currentStoredTab = getActiveStoredChatTab(chatId);
            if (
              !shouldRemoveTransferredChatFromRenderer(
                currentStoredTab?.tabInstanceId ?? null,
                tabInstanceId,
              )
            ) {
              markSourceChatTabRemoval(transferId, tabInstanceId);
              await ipc.windowInfrastructure.confirmSourceChatTabRemoval({
                transferId,
                tabInstanceId,
                chatId,
              });
              return;
            }
            const storageKey = chatTabSessionStorageKey(
              getActiveWindowSessionId(),
            );
            const previousStorage = window.localStorage.getItem(storageKey);
            const previousRecent = [...store.get(recentViewedChatIdsAtom)];
            const previousClosed = new Set(store.get(closedChatIdsAtom));
            const previousSession = new Set(
              store.get(sessionOpenedChatIdsAtom),
            );
            const previousDrafts = new Map(store.get(chatInputValuesByIdAtom));
            const previousTerminals = new Map(
              store.get(terminalOpenByChatIdAtom),
            );
            const previousSelectedChatId = store.get(selectedChatIdAtom);
            const movedChat = chatsById.get(chatId);
            const wasInWorkspace = movedChat
              ? (store
                  .get(chatWorkspaceByAppIdAtom)
                  [movedChat.appId]?.visibleChatIds.includes(chatId) ?? false)
              : false;
            const movedPresentation = movedChat
              ? capturePresentation(chatId, movedChat.appId)
              : null;
            try {
              const remaining = orderedChatIds.filter((id) => id !== chatId);
              store.set(removeTransferredChatTabAtom, chatId);
              if (movedChat) {
                hideChatFromWorkspace({
                  appId: movedChat.appId,
                  chatId,
                });
              }
              if (store.get(selectedChatIdAtom) === chatId) {
                const fallback = remaining[0];
                const fallbackChat = fallback
                  ? chatsById.get(fallback)
                  : undefined;
                if (fallbackChat) {
                  selectChat({
                    chatId: fallbackChat.id,
                    appId: fallbackChat.appId,
                    preserveTabOrder: true,
                  });
                  const fallbackPresentation =
                    presentationByChatIdRef.current.get(fallbackChat.id) ??
                    neutralPresentation(fallbackChat.id);
                  restorePresentation(
                    fallbackPresentation,
                    fallbackChat.appId,
                    { chatId: fallbackChat.id },
                  );
                  presentedChatIdRef.current = fallbackChat.id;
                } else {
                  scrollRestoreGenerationRef.current += 1;
                  store.set(selectedChatIdAtom, null);
                  presentedChatIdRef.current = null;
                  void navigate({ to: "/" });
                }
              }
              store.set(persistChatTabSessionAtom);
              assertActiveStoredChatTabInstance(tabInstanceId, "absent");
              markSourceChatTabRemoval(transferId, tabInstanceId);
              await ipc.windowInfrastructure.confirmSourceChatTabRemoval({
                transferId,
                tabInstanceId,
                chatId,
              });
              presentationByChatIdRef.current.delete(chatId);
            } catch (error) {
              restoreLocalStorageSnapshot(storageKey, previousStorage);
              clearSourceChatTabRemoval(transferId);
              store.set(recentViewedChatIdsAtom, previousRecent);
              store.set(closedChatIdsAtom, previousClosed);
              store.set(sessionOpenedChatIdsAtom, previousSession);
              store.set(chatInputValuesByIdAtom, previousDrafts);
              store.set(terminalOpenByChatIdAtom, previousTerminals);
              if (wasInWorkspace && movedChat) {
                showChatInWorkspace({
                  appId: movedChat.appId,
                  chatId,
                });
              }
              if (
                previousSelectedChatId === chatId &&
                movedChat &&
                movedPresentation
              ) {
                selectChat({
                  chatId,
                  appId: movedChat.appId,
                  preserveTabOrder: true,
                });
                restorePresentation(movedPresentation, movedChat.appId, {
                  chatId,
                });
                presentedChatIdRef.current = chatId;
              }
              showError(error);
            }
          } catch (error) {
            showError(error);
          }
        })();
      },
    );
  }, [
    capturePresentation,
    chatsById,
    hasHydratedTabSession,
    hideChatFromWorkspace,
    navigate,
    neutralPresentation,
    orderedChatIds,
    restorePresentation,
    selectChat,
    showChatInWorkspace,
    store,
  ]);

  const visibleTabCapacity = useMemo(
    () =>
      getVisibleTabCapacity(
        containerWidth,
        orderedChats.length + workspaceTabs.length,
      ),
    [containerWidth, orderedChats.length, workspaceTabs.length],
  );

  const totalVisibleTabCount =
    visibleTabCapacity > 0
      ? visibleTabCapacity
      : Math.min(
          orderedChats.length + workspaceTabs.length,
          DEFAULT_UNMEASURED_VISIBLE_TABS,
        );
  // Keep workspace access visible without allowing workspace tabs to crowd all
  // regular chats out of the strip. The active workspace is sorted first.
  const visibleWorkspaceTabCount = getVisibleWorkspaceTabCount(
    totalVisibleTabCount,
    workspaceTabs.length,
    orderedChats.length,
  );
  const visibleWorkspaceTabs = workspaceTabs.slice(0, visibleWorkspaceTabCount);
  const overflowWorkspaceTabs = workspaceTabs.slice(visibleWorkspaceTabCount);
  const visibleTabCount = Math.max(
    totalVisibleTabCount - visibleWorkspaceTabCount,
    0,
  );

  const { visibleTabs, overflowTabs } = useMemo(
    () =>
      partitionChatsByVisibleCount(
        orderedChats,
        visibleTabCount,
        selectedChatId,
      ),
    [orderedChats, selectedChatId, visibleTabCount],
  );
  const overflowWorkspaceTabsForMenu = overflowWorkspaceTabs.slice(
    0,
    MAX_OVERFLOW_MENU_ITEMS,
  );
  const overflowTabsForMenu = useMemo(
    () =>
      overflowTabs.slice(
        0,
        Math.max(
          MAX_OVERFLOW_MENU_ITEMS - overflowWorkspaceTabsForMenu.length,
          0,
        ),
      ),
    [overflowTabs, overflowWorkspaceTabsForMenu.length],
  );
  const overflowTabCount = overflowWorkspaceTabs.length + overflowTabs.length;

  // Re-run when orderedChats becomes non-empty so the ResizeObserver attaches
  // after the container div renders (it returns null when there are no chats).
  const hasChats = orderedChats.length > 0 || workspaceTabs.length > 0;
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateWidth = () => {
      const measuredWidth =
        node.getBoundingClientRect().width ||
        node.clientWidth ||
        node.parentElement?.getBoundingClientRect().width ||
        node.parentElement?.clientWidth ||
        0;
      setContainerWidth(measuredWidth);
    };

    // Measure once on next frame to avoid early 0-width reads during mount/layout.
    const frameId = window.requestAnimationFrame(updateWidth);
    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(node);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [hasChats]);

  useStreamFinished(({ chatId }) => {
    setNotifiedChatIds((current) =>
      addFinishedChatNotification(current, chatId, selectedChatId),
    );
  });

  // Clear notification for the currently viewed tab.
  useEffect(() => {
    if (selectedChatId === null) return;
    setNotifiedChatIds((current) => {
      if (!current.has(selectedChatId)) return current;
      const next = new Set(current);
      next.delete(selectedChatId);
      return next;
    });
  }, [selectedChatId]);

  const clearNotification = useCallback((chatId: number) => {
    setNotifiedChatIds((prev) => {
      if (!prev.has(chatId)) return prev;
      const next = new Set(prev);
      next.delete(chatId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (
      selectedChatId === null ||
      !chatsById.has(selectedChatId) ||
      containerWidth <= 0
    ) {
      return;
    }

    // If the selected chat was previously closed, re-open it as a tab.
    // This prevents an infinite loop where applySelectionToOrderedChatIds
    // would try to insert an ID that getOrderedRecentChatIds filters out.
    if (closedChatIds.has(selectedChatId)) {
      pushRecentViewedChatId(selectedChatId);
      return;
    }

    const nextIds = applySelectionToOrderedChatIds(
      orderedChatIds,
      selectedChatId,
      visibleTabCount,
    );

    if (!isSameIdOrder(orderedChatIds, nextIds)) {
      setRecentViewedChatIds(nextIds);
    }
  }, [
    chatsById,
    closedChatIds,
    containerWidth,
    orderedChatIds,
    pushRecentViewedChatId,
    selectedChatId,
    setRecentViewedChatIds,
    visibleTabCount,
  ]);

  const selectChatWithPresentation = useCallback(
    (chatId: number, appId: number, options: { workspace?: boolean } = {}) => {
      clearNotification(chatId);
      if (
        shouldSkipChatSelection(
          selectedChatId,
          chatId,
          pathname,
          isWorkspaceRoute,
          options.workspace === true,
        )
      ) {
        return;
      }

      if (selectedChatId !== null) {
        const selectedChat = chatsById.get(selectedChatId);
        if (selectedChat && pathname === "/chat") {
          presentationByChatIdRef.current.set(
            selectedChat.id,
            capturePresentation(selectedChat.id, selectedChat.appId),
          );
        } else {
          preNavigationPresentationCaptureRef.current = {
            fromChatId: selectedChatId,
            toChatId: chatId,
          };
        }
      }
      store.set(ensureRecentViewedChatIdAtom, chatId);
      selectChat({
        chatId,
        appId,
        preserveTabOrder: true,
        workspace: options.workspace,
      });
      const presentation =
        presentationByChatIdRef.current.get(chatId) ??
        neutralPresentation(chatId);
      restorePresentation(presentation, appId, { chatId });
      presentedChatIdRef.current = chatId;
      store.set(persistChatTabSessionAtom);
    },
    [
      capturePresentation,
      chatsById,
      clearNotification,
      isWorkspaceRoute,
      neutralPresentation,
      pathname,
      restorePresentation,
      selectChat,
      selectedChatId,
      store,
    ],
  );

  const handleTabClick = (chat: ChatSummary, fromOverflow = false) => {
    if (fromOverflow) {
      const nextIds = applySelectionToOrderedChatIds(
        orderedChatIds,
        chat.id,
        visibleTabCount,
      );
      if (!isSameIdOrder(orderedChatIds, nextIds)) {
        setRecentViewedChatIds(nextIds);
      }
    }

    selectChatWithPresentation(chat.id, chat.appId);
  };

  const handleWorkspaceTabClick = (workspace: ChatWorkspaceTab) => {
    const nextChatId =
      selectedChatId !== null && workspace.chatIds.includes(selectedChatId)
        ? selectedChatId
        : workspace.chatIds[0];
    if (nextChatId === undefined) return;
    selectChatWithPresentation(nextChatId, workspace.appId, {
      workspace: true,
    });
  };

  useEffect(() => {
    if (!hasHydratedTabSession) return;
    return chatNavigationEvents.subscribe(({ chatId, appId }) => {
      selectChatWithPresentation(chatId, appId);
    });
  }, [hasHydratedTabSession, selectChatWithPresentation]);

  const handleCloseTab = (chatId: number) => {
    const fallbackChatId = getFallbackChatIdAfterClose(orderedChats, chatId);
    closeTabsAndClearNotifications([chatId], fallbackChatId ?? undefined);

    if (fallbackChatId === null && selectedChatId === chatId) {
      scrollRestoreGenerationRef.current += 1;
      setSelectedChatId(null);
      presentedChatIdRef.current = null;
      navigate({ to: "/" });
    }
  };

  // Helper to close multiple tabs and optionally switch to a fallback
  const closeTabsAndClearNotifications = useCallback(
    (idsToClose: number[], fallbackChatId?: number) => {
      if (idsToClose.length === 0) return;

      for (const id of idsToClose) {
        clearNotification(id);
      }

      const records: ClosedTabRecord[] = idsToClose
        .map((id) => {
          const chat = chatsById.get(id);
          return chat
            ? { chatId: chat.id, appId: chat.appId, title: chat.title }
            : null;
        })
        .filter((record): record is ClosedTabRecord => record !== null);

      for (const record of records) {
        hideChatFromWorkspace({
          appId: record.appId,
          chatId: record.chatId,
        });
      }

      closeMultipleTabs(records);

      // Switch to fallback when a fallback is provided and either there is
      // no selected chat (null) or the currently selected chat is being closed.
      if (
        fallbackChatId !== undefined &&
        (selectedChatId === null || idsToClose.includes(selectedChatId ?? -1))
      ) {
        const fallbackTab = chatsById.get(fallbackChatId);
        if (fallbackTab) {
          selectChat({
            chatId: fallbackTab.id,
            appId: fallbackTab.appId,
            preserveTabOrder: true,
          });
          const fallbackPresentation =
            presentationByChatIdRef.current.get(fallbackTab.id) ??
            neutralPresentation(fallbackTab.id);
          restorePresentation(fallbackPresentation, fallbackTab.appId, {
            chatId: fallbackTab.id,
          });
          presentedChatIdRef.current = fallbackTab.id;
        }
      }
      for (const id of idsToClose) {
        presentationByChatIdRef.current.delete(id);
      }
    },
    [
      clearNotification,
      closeMultipleTabs,
      hideChatFromWorkspace,
      selectedChatId,
      chatsById,
      neutralPresentation,
      restorePresentation,
      selectChat,
    ],
  );

  const handleCloseOtherTabs = (keepChatId: number) => {
    const idsToClose = orderedChatIds.filter((id) => id !== keepChatId);
    // Always switch to the kept tab if we're not already on it
    const fallback = selectedChatId !== keepChatId ? keepChatId : undefined;
    closeTabsAndClearNotifications(idsToClose, fallback);
  };

  const handleCloseTabsToRight = (chatId: number) => {
    const chatIndex = orderedChatIds.indexOf(chatId);
    if (chatIndex === -1) return;

    const idsToClose = orderedChatIds.slice(chatIndex + 1);
    // Only switch to this chat if the selected one is being closed
    const fallback =
      selectedChatId !== null && idsToClose.includes(selectedChatId)
        ? chatId
        : undefined;
    closeTabsAndClearNotifications(idsToClose, fallback);
  };

  const handleToggleGroupByApp = () => {
    setGroupTabsByApp((prev) => !prev);
  };

  // Check whether tabs span more than one app (used to enable/disable grouping)
  const hasMultipleApps = useMemo(() => {
    const appIds = new Set<number>();
    for (const chatId of orderedChatIds) {
      const chat = chatsById.get(chatId);
      if (chat) appIds.add(chat.appId);
      if (appIds.size > 1) return true;
    }
    return false;
  }, [orderedChatIds, chatsById]);

  return (
    <TooltipProvider delay={500}>
      <div
        ref={containerRef}
        data-testid="chat-tab-drop-zone"
        className="flex min-h-8 min-w-0 items-end gap-1 px-2"
        onDragOver={(event) => {
          if (
            enableMultiWindow &&
            hasHydratedTabSession &&
            event.dataTransfer.types.includes(CHAT_TAB_TRANSFER_MIME)
          ) {
            event.preventDefault();
          }
        }}
        onDrop={(event) => {
          const raw = event.dataTransfer.getData(CHAT_TAB_TRANSFER_MIME);
          if (!enableMultiWindow || !hasHydratedTabSession || !raw) return;
          event.preventDefault();
          try {
            const transfer = JSON.parse(raw) as {
              transferId: string;
              sourceWindowSessionId: string;
            };
            if (transfer.sourceWindowSessionId !== getActiveWindowSessionId()) {
              void adoptCrossWindowTab(transfer.transferId);
            }
          } catch {
            // Ignore foreign or malformed drag payloads.
          }
        }}
      >
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          {visibleWorkspaceTabs.map((workspace) => {
            const app = appById.get(workspace.appId);
            const appName = app?.name ?? `App ${workspace.appId}`;
            const isActive =
              isWorkspaceRoute && workspaceRouteAppId === workspace.appId;
            const workspaceAriaLabel = t("workspaceTabAria", {
              appName,
              count: workspace.chatIds.length,
            });

            return (
              <Tooltip key={`workspace-${workspace.appId}`}>
                <TooltipTrigger
                  render={
                    <div
                      data-testid={`chat-workspace-tab-${workspace.appId}`}
                      className={cn(
                        "no-app-region-drag relative flex h-8 min-w-[160px] max-w-52 items-center gap-1 px-2 py-0.5",
                        isActive
                          ? "z-10 rounded-t-md rounded-b-none border border-b-0 border-primary/30 bg-primary/10 text-primary"
                          : "rounded-md border border-primary/15 bg-primary/5 text-primary/80 hover:bg-primary/10 hover:text-primary",
                      )}
                    />
                  }
                >
                  <AppAvatar
                    appId={workspace.appId}
                    name={appName}
                    className="h-4 w-4 rounded-sm text-[8px]"
                  />
                  <PanelsTopLeft
                    size={12}
                    className="shrink-0"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      handleWorkspaceTabClick(workspace);
                    }}
                    onClick={(event) => {
                      if (event.detail !== 0) return;
                      handleWorkspaceTabClick(workspace);
                    }}
                    className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-current={isActive ? "page" : undefined}
                    aria-label={workspaceAriaLabel}
                  >
                    <div className="flex min-w-0 flex-col justify-center text-xs">
                      <span
                        className={cn(
                          "truncate leading-3",
                          isActive
                            ? "font-semibold text-primary"
                            : "font-medium text-primary/80",
                        )}
                      >
                        {t("workspaceTabName")}
                      </span>
                      <span
                        className={cn(
                          "truncate text-[11px] leading-3.5",
                          isActive ? "text-primary/90" : "text-primary/80",
                        )}
                      >
                        {t("workspaceTabDetails", {
                          appName,
                          count: workspace.chatIds.length,
                        })}
                      </span>
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" sideOffset={6}>
                  {workspaceAriaLabel}
                </TooltipContent>
              </Tooltip>
            );
          })}
          {visibleTabs.map((chat) => {
            const isActive = !isWorkspaceRoute && selectedChatId === chat.id;
            const title = chat.title?.trim() || t("newChat");
            const app = appById.get(chat.appId);
            const appName = app?.name ?? `App ${chat.appId}`;
            const titleExcerpt = getChatTitleExcerpt(title);
            const isDragging = draggingChatId === chat.id;

            const tabIndex = orderedChatIds.indexOf(chat.id);
            const hasTabsToRight =
              tabIndex !== -1 && tabIndex < orderedChatIds.length - 1;
            const hasOtherTabs = orderedChatIds.length > 1;
            const isInWorkspace =
              workspaces[chat.appId]?.visibleChatIds.includes(chat.id) ?? false;

            return (
              <ContextMenu key={chat.id}>
                <ContextMenuTrigger>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <div
                          draggable
                          data-testid={`chat-tab-${chat.id}`}
                          onAuxClick={(event) => {
                            // Middle-click (button 1) to close tab
                            if (event.button === 1) {
                              event.preventDefault();
                              handleCloseTab(chat.id);
                            }
                          }}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData(
                              "text/plain",
                              String(chat.id),
                            );
                            setDraggingChatId(chat.id);
                            const hasAttachments =
                              isActive && store.get(attachmentsAtom).length > 0;
                            if (hasAttachments) {
                              showError(t("moveTabAttachmentsBlocked"));
                            }
                            if (
                              !shouldPrepareCrossWindowTransfer(
                                enableMultiWindow,
                                hasAttachments,
                              )
                            ) {
                              return;
                            }
                            let storedTabs;
                            let storedTab;
                            try {
                              storedTabs = getActiveStoredChatTabs();
                              storedTab = storedTabs.find(
                                (tab) => tab.chatId === chat.id,
                              );
                            } catch (error) {
                              event.preventDefault();
                              setDraggingChatId(null);
                              showError(error);
                              return;
                            }
                            if (!storedTab) {
                              event.preventDefault();
                              setDraggingChatId(null);
                              return;
                            }
                            const transferId = crypto.randomUUID();
                            const presentation = isActive
                              ? capturePresentation(chat.id, chat.appId)
                              : (presentationByChatIdRef.current.get(chat.id) ??
                                neutralPresentation(chat.id));
                            presentationByChatIdRef.current.set(
                              chat.id,
                              presentation,
                            );
                            event.dataTransfer.setData(
                              CHAT_TAB_TRANSFER_MIME,
                              JSON.stringify({
                                transferId,
                                sourceWindowSessionId:
                                  getActiveWindowSessionId(),
                              }),
                            );
                            void ipc.windowInfrastructure
                              .beginChatTabTransfer({
                                transferId,
                                tabs: storedTabs,
                                payload: {
                                  tabInstanceId: storedTab.tabInstanceId,
                                  chatId: chat.id,
                                  appId: chat.appId,
                                  presentation,
                                },
                              })
                              .catch(showError);
                          }}
                          onDragEnd={() => setDraggingChatId(null)}
                          onDragOver={(event) => {
                            if (
                              draggingChatId === null ||
                              draggingChatId === chat.id
                            ) {
                              return;
                            }
                            event.preventDefault();
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (
                              draggingChatId === null ||
                              draggingChatId === chat.id
                            ) {
                              return;
                            }

                            const nextIds = reorderVisibleChatIds(
                              orderedChatIds,
                              visibleTabs.length,
                              draggingChatId,
                              chat.id,
                            );
                            if (!isSameIdOrder(orderedChatIds, nextIds)) {
                              // Persist the manual order and drop out of grouped
                              // mode — a hand-arranged order wins over auto-grouping.
                              setRecentViewedChatIds(nextIds);
                              setGroupTabsByApp(false);
                            }
                            setDraggingChatId(null);
                          }}
                          className={cn(
                            "no-app-region-drag group relative flex h-8 min-w-[160px] max-w-52 items-center gap-1 px-2 py-0.5",
                            isActive
                              ? "z-10 rounded-t-md rounded-b-none border border-b-0 border-border bg-background text-foreground"
                              : "rounded-md bg-transparent text-muted-foreground hover:bg-muted/70",
                            isDragging && "opacity-60",
                          )}
                        />
                      }
                    >
                      <AppAvatar
                        appId={chat.appId}
                        name={appName}
                        className="h-4 w-4 rounded-sm text-[8px]"
                      />
                      <ChatTabActivity
                        chatId={chat.id}
                        notified={notifiedChatIds.has(chat.id)}
                      />
                      <button
                        type="button"
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          handleTabClick(chat);
                        }}
                        onClick={(event) => {
                          if (event.detail !== 0) return;
                          handleTabClick(chat);
                        }}
                        className="min-w-0 flex-1 text-left rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        aria-current={isActive ? "page" : undefined}
                      >
                        <div className="flex min-w-0 flex-col justify-center text-xs">
                          <span
                            className={cn(
                              "truncate leading-3",
                              isActive
                                ? "font-semibold text-foreground"
                                : "font-medium text-foreground/60",
                            )}
                          >
                            {appName}
                          </span>
                          <span
                            className={cn(
                              "truncate text-[11px] leading-3.5",
                              isActive
                                ? "text-muted-foreground"
                                : "text-muted-foreground/70",
                            )}
                          >
                            {title}
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleCloseTab(chat.id);
                        }}
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                          isActive
                            ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                            : "opacity-0 group-hover:opacity-100 hover:bg-background/60 focus-visible:opacity-100",
                        )}
                        aria-label={t("closeChatTab", { title })}
                      >
                        <X size={12} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      align="start"
                      sideOffset={6}
                      className="max-w-80 !rounded-lg !border !border-border !bg-popover !px-3.5 !py-2.5 !text-popover-foreground !shadow-lg [&>:last-child]:!hidden"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[11px] leading-4 font-semibold">
                          {appName}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-4 break-words opacity-70">
                          {titleExcerpt}
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onClick={() => {
                      if (isInWorkspace) {
                        const nextWorkspaceChatId = workspaces[
                          chat.appId
                        ]?.visibleChatIds.find((id) => id !== chat.id);
                        hideChatFromWorkspace({
                          appId: chat.appId,
                          chatId: chat.id,
                        });
                        if (
                          isWorkspaceRoute &&
                          workspaceRouteAppId === chat.appId &&
                          selectedChatId === chat.id
                        ) {
                          if (nextWorkspaceChatId !== undefined) {
                            selectChatWithPresentation(
                              nextWorkspaceChatId,
                              chat.appId,
                              { workspace: true },
                            );
                          } else {
                            selectChatWithPresentation(chat.id, chat.appId);
                          }
                        }
                      } else {
                        showChatInWorkspace({
                          appId: chat.appId,
                          chatId: chat.id,
                        });
                      }
                    }}
                  >
                    {isInWorkspace
                      ? t("removeFromWorkspace")
                      : t("addToWorkspace")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  {enableMultiWindow && (
                    <>
                      <ContextMenuItem
                        onClick={() => {
                          void ipc.windowInfrastructure
                            .openEntityInNewWindow({
                              kind: "chat",
                              id: chat.id,
                            })
                            .catch(showError);
                        }}
                      >
                        {t("openChatInNewWindow")}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                    </>
                  )}
                  <ContextMenuItem onClick={() => handleCloseTab(chat.id)}>
                    {t("closeTab")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() => handleCloseOtherTabs(chat.id)}
                    disabled={!hasOtherTabs}
                  >
                    {t("closeOtherTabs")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => handleCloseTabsToRight(chat.id)}
                    disabled={!hasTabsToRight}
                  >
                    {t("closeTabsToRight")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuCheckboxItem
                    checked={groupTabsByApp}
                    onCheckedChange={handleToggleGroupByApp}
                    disabled={!hasMultipleApps && !groupTabsByApp}
                  >
                    {t("groupTabsByApp")}
                  </ContextMenuCheckboxItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={reopenClosedTab}
                    disabled={!hasClosedTabs}
                    title={t("reopenClosedTabTooltip")}
                  >
                    {hasClosedTabs && lastClosedTab?.title
                      ? t("reopenClosedTabWithTitle", {
                          title: lastClosedTab.title,
                        })
                      : t("reopenClosedTab")}
                    <ContextMenuShortcut title={t("reopenClosedTabTooltip")}>
                      {isMac ? "⇧⌘T" : "Ctrl+⇧+T"}
                    </ContextMenuShortcut>
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>

        {overflowTabCount > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="no-app-region-drag flex h-7 w-8 items-center justify-center rounded-md border border-transparent bg-muted/50 text-muted-foreground hover:bg-muted"
              aria-label={t("openOverflowTabs", {
                count: overflowTabCount,
              })}
            >
              <MoreHorizontal size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {overflowWorkspaceTabsForMenu.map((workspace) => {
                const appName =
                  appById.get(workspace.appId)?.name ??
                  `App ${workspace.appId}`;
                return (
                  <DropdownMenuItem
                    key={`workspace-${workspace.appId}`}
                    onClick={() => handleWorkspaceTabClick(workspace)}
                    className="flex items-center gap-2"
                  >
                    <AppAvatar
                      appId={workspace.appId}
                      name={appName}
                      className="h-5 w-5 rounded text-[9px]"
                    />
                    <PanelsTopLeft
                      size={14}
                      className="shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs leading-3.5 font-bold text-primary">
                        {t("workspaceTabName")}
                      </div>
                      <div className="truncate text-xs leading-4">
                        {t("workspaceTabDetails", {
                          appName,
                          count: workspace.chatIds.length,
                        })}
                      </div>
                    </div>
                  </DropdownMenuItem>
                );
              })}
              {overflowTabsForMenu.map((chat) => {
                const title = chat.title?.trim() || t("newChat");
                const appName =
                  appById.get(chat.appId)?.name ?? `App ${chat.appId}`;
                return (
                  <DropdownMenuItem
                    key={chat.id}
                    onClick={() => handleTabClick(chat, true)}
                    onAuxClick={(event) => {
                      if (event.button === 1) {
                        event.preventDefault();
                        handleCloseTab(chat.id);
                      }
                    }}
                    className="flex items-center gap-2"
                  >
                    <AppAvatar
                      appId={chat.appId}
                      name={appName}
                      className="h-5 w-5 rounded text-[9px]"
                    />
                    <ChatTabActivity
                      chatId={chat.id}
                      notified={notifiedChatIds.has(chat.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs leading-3.5 font-bold">
                        {appName}
                      </div>
                      <div className="truncate text-xs leading-4">{title}</div>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleCloseTab(chat.id);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-label={t("closeChatTab", { title })}
                    >
                      <X size={12} />
                    </button>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </TooltipProvider>
  );
}

function isSameIdOrder(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function getChatTitleExcerpt(title: string, maxLength = 140): string {
  if (title.length <= maxLength) return title;
  return `${title.slice(0, maxLength - 3)}...`;
}
