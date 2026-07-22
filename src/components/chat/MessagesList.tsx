import React from "react";
import type { Message, Version } from "@/ipc/types";
import {
  forwardRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Virtuoso } from "react-virtuoso";
import ChatMessage from "./ChatMessage";
import { OpenRouterSetupBanner, SetupBanner } from "../SetupBanner";

import { useStreamChat } from "@/hooks/useStreamChat";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { userInputRequestsAtom } from "@/user_input/projection";
import { useAtomValue } from "jotai";
import { CheckCircle2, Loader2, RefreshCw, Undo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVersions } from "@/hooks/useVersions";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { showError, showWarning } from "@/lib/toast";
import { ipc } from "@/ipc/types";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useSettings } from "@/hooks/useSettings";
import { ModifiedFilesCard } from "./ModifiedFilesCard";
import { isCancelledResponseContent } from "@/shared/chatCancellation";
import { useVersionPreview } from "@/hooks/useVersionPreview";
import {
  isVersionActionBlockedState,
  type PreviewEvent,
} from "@/version_preview/state";
import { ExtraCommitsRevertDialog } from "./ExtraCommitsRevertDialog";
import { getExtraRevertedCommits } from "./revertImpact";

interface MessagesListProps {
  messages: Message[];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onAtBottomChange?: (atBottom: boolean) => void;
}

// Memoize ChatMessage at module level to prevent recreation on every render
const MemoizedChatMessage = React.memo(ChatMessage);

// Context type for Virtuoso
interface FooterContext {
  messages: Message[];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  isStreaming: boolean;
  isUndoLoading: boolean;
  isRetryLoading: boolean;
  isAnyVersionMutationPending: boolean;
  setIsUndoLoading: (loading: boolean) => void;
  setIsRetryLoading: (loading: boolean) => void;
  refreshVersions: ReturnType<typeof useVersions>["refreshVersions"];
  restoreTargetBranch: string | null;
  sendPreviewMutation: (event: PreviewEvent) => Promise<void>;
  streamMessage: ReturnType<typeof useStreamChat>["streamMessage"];
  selectedChatId: number | null;
  appId: number | null;
  renderSetupBanner: () => React.ReactNode;
}

type RevertConfirmation = {
  appId: number;
  chatId: number;
  messageId: number | undefined;
  targetVersionId: string;
  expectedHeadOid: string;
  extraCommits: Version[];
};

type RetryDetails = { prompt: string; chatId: number; redo: boolean };

type PendingRevert =
  | (RevertConfirmation & {
      kind: "undo";
      currentChatMessageId?: { chatId: number; messageId: number };
    })
  | (RevertConfirmation & { kind: "retry"; retry: RetryDetails });

// Footer component for Virtuoso - receives context via props
function FooterComponent({ context }: { context?: FooterContext }) {
  const userInputRequests = useAtomValue(userInputRequestsAtom);
  const [pendingRevert, setPendingRevert] = useState<PendingRevert | null>(
    null,
  );
  const actionInFlightRef = useRef(false);
  const contextAppId = context?.appId ?? null;
  const contextChatId = context?.selectedChatId ?? null;
  const contextMessageId = context?.messages.at(-1)?.id;
  const contextIdentityRef = useRef({
    appId: contextAppId,
    chatId: contextChatId,
    messageId: contextMessageId,
  });
  contextIdentityRef.current = {
    appId: contextAppId,
    chatId: contextChatId,
    messageId: contextMessageId,
  };

  useEffect(() => {
    setPendingRevert((pending) => {
      if (
        !pending ||
        (pending.appId === contextAppId &&
          pending.chatId === contextChatId &&
          pending.messageId === contextMessageId)
      ) {
        return pending;
      }
      return null;
    });
  }, [contextAppId, contextChatId, contextMessageId]);

  if (!context) return null;

  const {
    messages,
    messagesEndRef,
    isStreaming,
    isUndoLoading,
    isRetryLoading,
    isAnyVersionMutationPending,
    setIsUndoLoading,
    setIsRetryLoading,
    refreshVersions,
    restoreTargetBranch,
    sendPreviewMutation,
    streamMessage,
    selectedChatId,
    appId,
    renderSetupBanner,
  } = context;

  let questionnaireSettledAt: number | undefined;
  if (selectedChatId != null) {
    for (const request of userInputRequests.values()) {
      if (
        request.status === "settled" &&
        request.questionnaireSubmitted &&
        request.descriptor?.kind === "questionnaire" &&
        request.descriptor.chatId === selectedChatId &&
        (questionnaireSettledAt === undefined ||
          request.settledAt > questionnaireSettledAt)
      ) {
        questionnaireSettledAt = request.settledAt;
      }
    }
  }

  const lastMessage = messages.length
    ? messages[messages.length - 1]
    : undefined;
  const isLastMessageAssistant = lastMessage?.role === "assistant";
  const isCurrentContext = (
    expectedAppId: number,
    expectedChatId: number,
    expectedMessageId: number | undefined,
  ) => {
    const current = contextIdentityRef.current;
    return (
      current.appId === expectedAppId &&
      current.chatId === expectedChatId &&
      current.messageId === expectedMessageId
    );
  };

  const beginAction = (
    kind: "undo" | "retry",
    { allowPending = false }: { allowPending?: boolean } = {},
  ) => {
    if (
      actionInFlightRef.current ||
      (!allowPending && pendingRevert !== null) ||
      isAnyVersionMutationPending
    ) {
      return false;
    }
    actionInFlightRef.current = true;
    if (kind === "undo") setIsUndoLoading(true);
    else setIsRetryLoading(true);
    return true;
  };

  const endAction = (kind: "undo" | "retry") => {
    actionInFlightRef.current = false;
    if (kind === "undo") setIsUndoLoading(false);
    else setIsRetryLoading(false);
  };

  const executeUndo = async ({
    appId: actionAppId,
    targetVersionId,
    expectedHeadOid,
    currentChatMessageId,
  }: {
    appId: number;
    targetVersionId: string;
    expectedHeadOid?: string;
    currentChatMessageId?: { chatId: number; messageId: number };
  }) => {
    console.debug("Reverting to previous version", targetVersionId);
    await sendPreviewMutation({
      type: "RESTORE",
      appId: actionAppId,
      versionId: targetVersionId,
      expectedHeadOid,
      currentChatMessageId,
    });
  };

  const executeRetry = async ({
    appId: actionAppId,
    targetVersionId,
    expectedHeadOid,
    retry,
  }: {
    appId: number;
    targetVersionId?: string;
    expectedHeadOid?: string;
    retry: RetryDetails;
  }) => {
    if (targetVersionId) {
      await sendPreviewMutation({
        type: "RESTORE",
        appId: actionAppId,
        versionId: targetVersionId,
        expectedHeadOid,
      });
    }

    console.debug("Streaming message with redo", retry.redo);
    streamMessage({
      prompt: retry.prompt,
      chatId: retry.chatId,
      redo: retry.redo,
    });
  };

  // Reverts the whole last generation: targets the version just before the last
  // assistant message's commit (falling back to its source commit) and drops the
  // messages produced by that turn. Shared by the modified-files card and the
  // standalone Undo button below.
  const handleUndo = async () => {
    if (!selectedChatId || !appId) {
      console.error("No chat selected or app ID not available");
      return;
    }
    if (!beginAction("undo")) return;

    try {
      const freshVersions = restoreTargetBranch
        ? await ipc.version.listVersions({ appId, ref: restoreTargetBranch })
        : ((await refreshVersions()).data ?? []);
      const currentMessage = messages[messages.length - 1];
      if (!isCurrentContext(appId, selectedChatId, currentMessage?.id)) return;
      // The user message that triggered this assistant response
      const userMessage = messages[messages.length - 2];
      const currentCommitIndex = currentMessage?.commitHash
        ? freshVersions.findIndex(
            (version) => version.oid === currentMessage.commitHash,
          )
        : -1;
      const previousVersionId =
        currentCommitIndex >= 0
          ? freshVersions[currentCommitIndex + 1]?.oid
          : undefined;
      const revertTargetVersionId =
        previousVersionId ?? currentMessage?.sourceCommitHash;

      if (revertTargetVersionId) {
        const currentChatMessageId = userMessage
          ? { chatId: selectedChatId, messageId: userMessage.id }
          : undefined;
        const extraCommits = getExtraRevertedCommits({
          versions: freshVersions,
          targetOid: revertTargetVersionId,
          ownCommitHashes: currentMessage?.commitHash
            ? [currentMessage.commitHash]
            : [],
        });
        const expectedHeadOid = freshVersions[0]?.oid;

        if (extraCommits?.length && expectedHeadOid) {
          setPendingRevert({
            kind: "undo",
            appId,
            chatId: selectedChatId,
            messageId: currentMessage?.id,
            targetVersionId: revertTargetVersionId,
            expectedHeadOid,
            extraCommits,
            currentChatMessageId,
          });
          return;
        }

        await executeUndo({
          appId,
          targetVersionId: revertTargetVersionId,
          expectedHeadOid,
          currentChatMessageId,
        });
      } else {
        showWarning(
          "No source commit hash found for message. Need to manually undo code changes",
        );
      }
    } catch (error) {
      console.error("Error during undo operation:", error);
      showError("Failed to undo changes");
    } finally {
      endAction("undo");
    }
  };

  // Re-runs the last user prompt. If the last assistant turn is still the tip of
  // history it is first reverted (so the retry replaces it rather than stacking);
  // otherwise the prompt is redone. Shared by the modified-files card and the
  // standalone Retry button below.
  const handleRetry = async () => {
    if (!selectedChatId || !appId) {
      console.error("No chat selected or app ID not available");
      return;
    }
    if (!beginAction("retry")) return;

    try {
      const freshVersions = restoreTargetBranch
        ? await ipc.version.listVersions({ appId, ref: restoreTargetBranch })
        : ((await refreshVersions()).data ?? []);
      const lastUserMessage = [...messages]
        .reverse()
        .find((message) => message.role === "user");
      if (!lastUserMessage) {
        console.error("No user message found");
        return;
      }

      // The last message is usually an assistant, but it might not be.
      // The refreshed log may still be empty if the query failed; in that case
      // fall through to a plain redo rather than throwing.
      const lastVersion = freshVersions[0];
      const lastMessage = messages[messages.length - 1];
      let shouldRedo = true;
      let revertTargetVersionId: string | undefined;
      if (
        lastMessage?.role === "assistant" &&
        lastVersion?.oid === lastMessage.commitHash
      ) {
        const previousAssistantMessage = messages[messages.length - 3];
        if (
          previousAssistantMessage?.role === "assistant" &&
          previousAssistantMessage?.commitHash
        ) {
          console.debug("Reverting to previous assistant version");
          revertTargetVersionId = previousAssistantMessage.commitHash;
          shouldRedo = false;
        } else {
          const chat = await ipc.chat.getChat(selectedChatId);
          if (chat.initialCommitHash) {
            console.debug(
              "Reverting to initial commit hash",
              chat.initialCommitHash,
            );
            revertTargetVersionId = chat.initialCommitHash;
          } else {
            showWarning(
              "No initial commit hash found for chat. Need to manually undo code changes",
            );
          }
        }
      }

      if (!isCurrentContext(appId, selectedChatId, lastMessage?.id)) return;

      const retry = {
        prompt: lastUserMessage.content,
        chatId: selectedChatId,
        redo: shouldRedo,
      };

      if (revertTargetVersionId) {
        const extraCommits = getExtraRevertedCommits({
          versions: freshVersions,
          targetOid: revertTargetVersionId,
          ownCommitHashes: lastMessage?.commitHash
            ? [lastMessage.commitHash]
            : [],
        });
        const expectedHeadOid = freshVersions[0]?.oid;
        if (extraCommits?.length && expectedHeadOid) {
          setPendingRevert({
            kind: "retry",
            appId,
            chatId: selectedChatId,
            messageId: lastMessage?.id,
            targetVersionId: revertTargetVersionId,
            expectedHeadOid,
            extraCommits,
            retry,
          });
          return;
        }
      }

      await executeRetry({
        appId,
        targetVersionId: revertTargetVersionId,
        expectedHeadOid: freshVersions[0]?.oid,
        retry,
      });
    } catch (error) {
      console.error("Error during retry operation:", error);
      showError("Failed to retry message");
    } finally {
      endAction("retry");
    }
  };

  // When the last assistant turn produced a commit, show the modified-files card
  // (which owns its own Undo/Retry buttons). Otherwise fall back to the standalone
  // buttons so text-only replies keep those affordances.
  const showModifiedFilesCard =
    isLastMessageAssistant && !!lastMessage?.commitHash && appId != null;
  const currentPendingRevert =
    pendingRevert &&
    isCurrentContext(
      pendingRevert.appId,
      pendingRevert.chatId,
      pendingRevert.messageId,
    )
      ? pendingRevert
      : null;

  return (
    <>
      {!isStreaming && showModifiedFilesCard && (
        <ModifiedFilesCard
          appId={appId!}
          commitHash={lastMessage!.commitHash!}
          onUndo={handleUndo}
          isUndoLoading={isUndoLoading}
          onRetry={handleRetry}
          isRetryLoading={isRetryLoading}
          isAnyVersionMutationPending={isAnyVersionMutationPending}
        />
      )}
      {!isStreaming && !showModifiedFilesCard && (
        <div className="flex max-w-3xl mx-auto gap-2">
          {isLastMessageAssistant && (
            <Button
              variant="outline"
              size="sm"
              disabled={
                isUndoLoading || isRetryLoading || isAnyVersionMutationPending
              }
              onClick={handleUndo}
            >
              {isUndoLoading ? (
                <Loader2 size={16} className="mr-1 animate-spin" />
              ) : (
                <Undo size={16} />
              )}
              Undo
            </Button>
          )}
          {!!messages.length && (
            <Button
              variant="outline"
              size="sm"
              disabled={
                isRetryLoading || isUndoLoading || isAnyVersionMutationPending
              }
              onClick={handleRetry}
            >
              {isRetryLoading ? (
                <Loader2 size={16} className="mr-1 animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              Retry
            </Button>
          )}
        </div>
      )}

      {currentPendingRevert && (
        <ExtraCommitsRevertDialog
          open
          kind={currentPendingRevert.kind}
          extraCommits={currentPendingRevert.extraCommits}
          onOpenChange={(open) => {
            if (!open) setPendingRevert(null);
          }}
          onConfirm={() => {
            const action = currentPendingRevert;
            setPendingRevert(null);
            if (
              action.appId !== appId ||
              action.chatId !== selectedChatId ||
              action.messageId !== lastMessage?.id ||
              !beginAction(action.kind, { allowPending: true })
            ) {
              return;
            }
            const operation =
              action.kind === "undo"
                ? executeUndo(action)
                : executeRetry(action);
            void operation
              .catch((error) => {
                console.error(`Error during ${action.kind} operation:`, error);
                showError(
                  action.kind === "undo"
                    ? "Failed to undo changes"
                    : "Failed to retry message",
                );
              })
              .finally(() => endAction(action.kind));
          }}
        />
      )}

      {questionnaireSettledAt !== undefined && (
        <div
          key={questionnaireSettledAt}
          className="questionnaire-submitted-confirmation flex justify-start px-4"
        >
          <div className="max-w-3xl w-full mx-auto">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground py-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Answers submitted
            </div>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
      {renderSetupBanner()}
    </>
  );
}

export const MessagesList = forwardRef<HTMLDivElement, MessagesListProps>(
  function MessagesList({ messages, messagesEndRef, onAtBottomChange }, ref) {
    const appId = useAtomValue(selectedAppIdAtom);
    const { refreshVersions } = useVersions(appId);
    const { state: previewState, sendAndWaitForMutation: sendPreviewMutation } =
      useVersionPreview(appId);
    const isAnyVersionMutationPending =
      isVersionActionBlockedState(previewState);
    const restoreTargetBranch =
      previewState.type === "previewing" &&
      previewState.session.checkedOutVersionId !== null
        ? previewState.session.originBranch
        : null;
    const { streamMessage, isStreaming } = useStreamChat();
    const { isAnyProviderSetup, isProviderSetup } = useLanguageModelProviders();
    const { settings } = useSettings();
    const [isUndoLoading, setIsUndoLoading] = useState(false);
    const [isRetryLoading, setIsRetryLoading] = useState(false);
    const selectedChatId = useAtomValue(selectedChatIdAtom);

    // Virtualization only renders visible DOM elements, which creates issues for E2E tests:
    // 1. Off-screen logs don't exist in the DOM and can't be queried by test selectors
    // 2. Tests would need complex scrolling logic to bring elements into view before interaction
    // 3. Race conditions and timing issues occur when waiting for virtualized elements to render after scrolling
    const isTestMode = settings?.isTestMode;

    // Wrap state setters in useCallback to stabilize references
    const handleSetIsUndoLoading = useCallback((loading: boolean) => {
      setIsUndoLoading(loading);
    }, []);

    const handleSetIsRetryLoading = useCallback((loading: boolean) => {
      setIsRetryLoading(loading);
    }, []);

    // Stabilize renderSetupBanner with proper dependencies
    const renderSetupBanner = useCallback(() => {
      const selectedModel = settings?.selectedModel;
      if (
        selectedModel?.name === "free" &&
        selectedModel?.provider === "auto" &&
        !isProviderSetup("openrouter")
      ) {
        return <OpenRouterSetupBanner className="w-full" />;
      }
      if (!isAnyProviderSetup()) {
        return <SetupBanner />;
      }
      return null;
    }, [
      settings?.selectedModel?.name,
      settings?.selectedModel?.provider,
      isProviderSetup,
      isAnyProviderSetup,
    ]);

    // Precompute which indices are cancelled prompts so the callback
    // can depend on this set instead of the full messages array reference.
    const cancelledPromptIndices = useMemo(() => {
      const indices = new Set<number>();
      for (let i = 0; i < messages.length - 1; i++) {
        if (
          messages[i].role === "user" &&
          isCancelledResponseContent(messages[i + 1].content)
        ) {
          indices.add(i);
        }
      }
      return indices;
    }, [messages]);

    // Memoized item renderer for virtualized list
    const itemContent = useCallback(
      (index: number, message: Message) => {
        const isLastMessage = index === messages.length - 1;
        const messageKey = message.id;

        return (
          <div className="px-4" key={messageKey}>
            <MemoizedChatMessage
              message={message}
              isLastMessage={isLastMessage}
              isCancelledPrompt={cancelledPromptIndices.has(index)}
            />
          </div>
        );
      },
      [messages.length, cancelledPromptIndices],
    );

    // Create context object for Footer component with stable references
    const footerContext = useMemo<FooterContext>(
      () => ({
        messages,
        messagesEndRef,
        isStreaming,
        isUndoLoading,
        isRetryLoading,
        isAnyVersionMutationPending,
        setIsUndoLoading: handleSetIsUndoLoading,
        setIsRetryLoading: handleSetIsRetryLoading,
        refreshVersions,
        restoreTargetBranch,
        sendPreviewMutation,
        streamMessage,
        selectedChatId,
        appId,
        renderSetupBanner,
      }),
      [
        messages,
        messagesEndRef,
        isStreaming,
        isUndoLoading,
        isRetryLoading,
        isAnyVersionMutationPending,
        handleSetIsUndoLoading,
        handleSetIsRetryLoading,
        refreshVersions,
        restoreTargetBranch,
        sendPreviewMutation,
        streamMessage,
        selectedChatId,
        appId,
        renderSetupBanner,
      ],
    );

    // Render empty state or setup banner
    if (messages.length === 0) {
      const setupBanner = renderSetupBanner();
      if (setupBanner) {
        return (
          <div
            className="absolute inset-0 overflow-y-auto p-4 pb-0 pr-0"
            ref={ref}
            data-testid="messages-list"
          >
            {setupBanner}
          </div>
        );
      }
      return (
        <div
          className="absolute inset-0 overflow-y-auto p-4 pb-0 pr-0"
          ref={ref}
          data-testid="messages-list"
        >
          <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto">
            <div className="flex flex-1 items-center justify-center text-gray-500">
              No messages yet
            </div>
          </div>
        </div>
      );
    }

    // In test mode, render all messages without virtualization
    // so E2E tests can query all messages in the DOM
    if (isTestMode) {
      return (
        <div
          className="absolute inset-0 p-4 pb-0 pr-0 overflow-y-auto"
          ref={ref}
          data-testid="messages-list"
        >
          {messages.map((message, index) => {
            const isLastMessage = index === messages.length - 1;
            return (
              <div className="px-4" key={message.id}>
                <ChatMessage
                  message={message}
                  isLastMessage={isLastMessage}
                  isCancelledPrompt={cancelledPromptIndices.has(index)}
                />
              </div>
            );
          })}
          <FooterComponent context={footerContext} />
        </div>
      );
    }

    return (
      <div
        className="absolute inset-0 overflow-y-auto p-4 pb-0 mb-2 pr-0"
        ref={ref}
        data-testid="messages-list"
      >
        <Virtuoso
          data={messages}
          increaseViewportBy={{ top: 1000, bottom: 500 }}
          initialTopMostItemIndex={messages.length - 1}
          itemContent={itemContent}
          components={{ Footer: FooterComponent }}
          context={footerContext}
          atBottomThreshold={80}
          atBottomStateChange={onAtBottomChange}
          followOutput={(isAtBottom) => (isAtBottom ? "auto" : false)}
        />
      </div>
    );
  },
);
