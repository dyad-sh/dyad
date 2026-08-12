import {
  ArrowUp,
  Loader2,
  Paperclip,
  Square,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtom } from "jotai";
import { atom } from "jotai";
import { useTranslation } from "react-i18next";
import { LexicalChatInput } from "@/components/chat/LexicalChatInput";
import { useSettings } from "@/hooks/useSettings";
import { useModelDisplayName } from "@/hooks/useModelDisplayName";
import { useScrollAndNavigateTo } from "@/hooks/useScrollAndNavigateTo";
import { useEnhanceChatAgentPrompt } from "@/hooks/useEnhanceChatAgentPrompt";
import {
  getChatAgentModel,
  getConfiguredChatAgentModel,
} from "@/lib/chat_agent_model";
import { SECTION_IDS } from "@/lib/settingsSearchIndex";
import {
  chatAgentAttachmentsAtom,
  chatAgentDataSourceIdsAtom,
} from "@/atoms/chatAgentAtoms";
import { ChatAgentAttachMenu } from "./ChatAgentAttachMenu";
import { ChatAgentToolMenu } from "./ChatAgentToolMenu";
import { ChatAgentAttachmentsList } from "./ChatAgentAttachmentsList";
import { ChatAgentKnowledgeMenu } from "./ChatAgentKnowledgeMenu";
import { ChatAgentDataSourceMenu } from "./ChatAgentDataSourceMenu";
import { ChatAgentProjectMenu } from "./ChatAgentProjectMenu";
import { VoiceInputButton } from "@/components/chat/VoiceInputButton";
import { showError as showErrorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useFileDropZone } from "@/hooks/useFileDropZone";
import {
  getChatAgentMcpActionKey,
  type ChatAgentMcpAction,
} from "@/lib/chat_agent_mcp_actions";

export const chatAgentInputAtom = atom("");

export function ChatAgentComposer({
  onSubmit,
  disabled,
  isStreaming = false,
  onStop,
  messageHistory = [],
  variant = "docked",
  modelLabelOverride,
  exclusiveToolLabel,
  selectedVectorCollectionIds,
  onVectorCollectionIdsChange,
  autoFocus = true,
}: {
  /**
   * Whether this composer should take focus.
   *
   * Must be false for any composer that is mounted but not visible. The input
   * is a shared atom, so several mounted composers all re-render on every
   * keystroke, and every one with autoFocus then races to take the caret back.
   * That is what makes typing land one character at a time.
   */
  autoFocus?: boolean;
  onSubmit: (
    text: string,
    selectedMcpActions: ChatAgentMcpAction[],
    vectorCollectionIds: string[],
    dataSourceIds: string[],
  ) => void;
  disabled?: boolean;
  /** While true the send button becomes a stop button. */
  isStreaming?: boolean;
  /** Called when the user stops an in-flight response. */
  onStop?: () => void;
  /** Prior user messages (most recent first) for ↑ history navigation. */
  messageHistory?: string[];
  /** Centered empty-state layout vs bottom-docked thread layout. */
  variant?: "docked" | "empty";
  /** Display-only model label for chats routed outside the standard Chat role. */
  modelLabelOverride?: string;
  /** Hide general tool/knowledge pickers and show a fixed tool scope. */
  exclusiveToolLabel?: string;
  /** Controlled knowledge selection, scoped to the active conversation. */
  selectedVectorCollectionIds?: string[];
  onVectorCollectionIdsChange?: (ids: string[]) => void;
}) {
  const { t } = useTranslation(["chat", "settings"]);
  const [inputValue, setInputValue] = useAtom(chatAgentInputAtom);
  const [attachments, setAttachments] = useAtom(chatAgentAttachmentsAtom);
  const [selectedMcpActions, setSelectedMcpActions] = useState<
    ChatAgentMcpAction[]
  >([]);
  const [localVectorCollectionIds, setLocalVectorCollectionIds] = useState<
    string[]
  >([]);
  const [dataSourceIds, setDataSourceIds] = useAtom(chatAgentDataSourceIdsAtom);
  const vectorCollectionIds =
    selectedVectorCollectionIds ?? localVectorCollectionIds;
  const setVectorCollectionIds =
    onVectorCollectionIdsChange ?? setLocalVectorCollectionIds;
  const { settings } = useSettings();
  const { enhancePrompt, isEnhancing } = useEnhanceChatAgentPrompt();
  const chatAgentModel = settings ? getChatAgentModel(settings) : null;
  const modelLabel = useModelDisplayName(chatAgentModel);
  const hasDedicatedModel =
    settings != null && getConfiguredChatAgentModel(settings) != null;
  const scrollToChatAgentSettings = useScrollAndNavigateTo("/settings");

  // Files can arrive by drag or by paste; both land in the same place the
  // attach menu writes to, so everything downstream is already handled.
  const attachFiles = useCallback(
    (files: File[]) => {
      if (disabled || files.length === 0) return;
      setAttachments((prev) => [
        ...prev,
        ...files.map((file) => ({ file, type: "chat-context" as const })),
      ]);
    },
    [disabled, setAttachments],
  );

  const { isDragging, dropHandlers } = useFileDropZone({
    onFiles: attachFiles,
    disabled,
  });

  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      // Only claim the paste when it actually carries files, so pasting text
      // still behaves normally.
      event.preventDefault();
      attachFiles(files);
    },
    [attachFiles],
  );

  const canSend =
    !disabled &&
    !isEnhancing &&
    (inputValue.trim().length > 0 || attachments.length > 0);
  // Only offer stop when there is something to stop and somewhere to send it.
  const canStop = isStreaming && onStop != null;

  // Escape stops generation from anywhere in the chat, not only via the
  // button — but never while a menu or dialog is up, where Escape means close.
  useEffect(() => {
    if (!canStop) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      onStop?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canStop, onStop]);

  // Announce generation to screen readers without moving focus. The region is
  // permanent; only its text changes, which is what triggers the announcement.
  const [announcement, setAnnouncement] = useState("");
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (isStreaming && !wasStreamingRef.current) {
      setAnnouncement(t("chat:chatAgent.generationStarted"));
    } else if (!isStreaming && wasStreamingRef.current) {
      setAnnouncement(t("chat:chatAgent.generationFinished"));
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, t]);

  const handleSubmit = (currentText?: string) => {
    const text = currentText ?? inputValue;
    const hasContent = text.trim().length > 0 || attachments.length > 0;
    if (disabled || isEnhancing || !hasContent) return;
    onSubmit(text, selectedMcpActions, vectorCollectionIds, dataSourceIds);
    setInputValue("");
  };

  /**
   * Speech goes straight to the chat: the transcript is appended to whatever
   * is already typed and submitted, so talking is a complete send action.
   */
  const handleVoiceTranscript = (text: string) => {
    const existing = inputValue.trim();
    handleSubmit(existing ? `${existing} ${text}` : text);
  };

  const handleMcpActionToggle = (action: ChatAgentMcpAction) => {
    if (disabled || isEnhancing) return;
    const key = getChatAgentMcpActionKey(action);
    setSelectedMcpActions((prev) =>
      prev.some((item) => getChatAgentMcpActionKey(item) === key)
        ? prev.filter((item) => getChatAgentMcpActionKey(item) !== key)
        : [...prev, action],
    );
  };

  const selectedMcpActionLabels = useMemo(
    () =>
      selectedMcpActions.map((action) => ({
        key: getChatAgentMcpActionKey(action),
        label: action.kind === "workflow" ? action.name : action.toolName,
      })),
    [selectedMcpActions],
  );

  const handleEnhancePrompt = async () => {
    if (disabled || isEnhancing || !inputValue.trim()) return;
    const enhanced = await enhancePrompt(inputValue);
    if (enhanced) setInputValue(enhanced);
  };

  return (
    <div
      className={cn(
        "chat-agent-composer-wrap",
        variant === "empty" && "chat-agent-composer-wrap--empty",
      )}
    >
      {/* Visually hidden; screen readers hear generation start and finish. */}
      <span aria-live="polite" role="status" className="sr-only">
        {announcement}
      </span>
      <div
        className={cn("chat-agent-composer", isDragging && "is-drop-target")}
        data-testid="chat-agent-composer"
        onPaste={handlePaste}
        {...dropHandlers}
      >
        {isDragging && (
          <div className="chat-agent-drop-overlay" aria-hidden>
            <Paperclip className="size-4" />
            <span>Drop to attach</span>
          </div>
        )}
        <ChatAgentAttachmentsList />
        <div className="chat-agent-composer-input">
          <LexicalChatInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
            placeholder={t("chat:chatAgent.messagePlaceholder")}
            disabled={disabled || isEnhancing}
            excludeCurrentApp={false}
            submitOnEnter
            autoFocus={autoFocus}
            messageHistory={messageHistory}
          />
        </div>
        <div className="chat-agent-composer-toolbar">
          <div className="chat-agent-composer-left">
            <button
              type="button"
              className={cn(
                "chat-agent-composer-icon-btn",
                isEnhancing && "chat-agent-composer-icon-btn--active",
              )}
              aria-label={t("chat:chatAgent.enhancePrompt")}
              title={t("chat:chatAgent.enhancePrompt")}
              disabled={disabled || isEnhancing || !inputValue.trim()}
              onClick={() => void handleEnhancePrompt()}
              data-testid="chat-agent-enhance-prompt"
            >
              {isEnhancing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <WandSparkles className="size-4" />
              )}
            </button>
            <ChatAgentAttachMenu disabled={disabled || isEnhancing} />
            {!exclusiveToolLabel && (
              <>
                <ChatAgentToolMenu
                  disabled={disabled || isEnhancing}
                  selectedActions={selectedMcpActions}
                  onToggleAction={handleMcpActionToggle}
                />
                <ChatAgentKnowledgeMenu
                  disabled={disabled || isEnhancing}
                  selectedCollectionIds={vectorCollectionIds}
                  onChange={setVectorCollectionIds}
                />
                <ChatAgentDataSourceMenu
                  disabled={disabled || isEnhancing}
                  selectedDataSourceIds={dataSourceIds}
                  onChange={setDataSourceIds}
                />
                <ChatAgentProjectMenu disabled={disabled || isEnhancing} />
              </>
            )}
            {exclusiveToolLabel && (
              <span
                className="chat-agent-selected-tool-chip"
                data-testid="chat-agent-exclusive-tool-scope"
              >
                {exclusiveToolLabel}
              </span>
            )}
            {!exclusiveToolLabel && vectorCollectionIds.length > 0 && (
              <span
                className="chat-agent-selected-tool-chip"
                title="Vector knowledge is enabled"
              >
                {vectorCollectionIds.length} knowledge{" "}
                {vectorCollectionIds.length === 1 ? "space" : "spaces"}
              </span>
            )}
            {!exclusiveToolLabel && dataSourceIds.length > 0 && (
              <span
                className="chat-agent-selected-tool-chip"
                title="Connected data sources are enabled"
                data-testid="chat-agent-data-source-chip"
              >
                {dataSourceIds.length} data{" "}
                {dataSourceIds.length === 1 ? "source" : "sources"}
              </span>
            )}
            {!exclusiveToolLabel && selectedMcpActionLabels.length > 0 && (
              <div
                className="chat-agent-selected-tools"
                data-testid="chat-agent-selected-tools"
              >
                {selectedMcpActionLabels.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    className="chat-agent-selected-tool-chip"
                    onClick={() =>
                      setSelectedMcpActions((prev) =>
                        prev.filter(
                          (item) =>
                            getChatAgentMcpActionKey(item) !== action.key,
                        ),
                      )
                    }
                    aria-label={`Remove ${action.label}`}
                  >
                    <span>{action.label}</span>
                    <X className="size-3" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="chat-agent-composer-right">
            <VoiceInputButton
              size={18}
              disabled={disabled || isEnhancing}
              onTranscript={handleVoiceTranscript}
              onError={(message) => showErrorToast(message)}
            />
            {/* One button, two jobs: send, then stop what it started. */}
            {canStop ? (
              <button
                type="button"
                className="chat-agent-send-btn chat-agent-send-btn--stop"
                aria-label={t("chat:chatAgent.stopGenerating")}
                title={t("chat:chatAgent.stopGenerating")}
                onClick={onStop}
                data-testid="chat-agent-stop"
              >
                <Square className="size-4 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                className="chat-agent-send-btn"
                aria-label={t("chat:chatAgent.sendMessage")}
                disabled={!canSend}
                onClick={() => handleSubmit()}
                data-testid="chat-agent-send"
              >
                <ArrowUp className="size-5" />
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="chat-agent-composer-footnote font-jarvis-ui">
        <span className="chat-agent-composer-shortcuts">
          <kbd>Enter</kbd> send · <kbd>↑</kbd> previous · <kbd>Shift</kbd>
          <kbd>Enter</kbd> newline
        </span>
        {modelLabelOverride ? (
          <span className="chat-agent-composer-footnote-model">
            {modelLabelOverride}
          </span>
        ) : (
          <button
            type="button"
            className="chat-agent-composer-footnote-model hover:underline"
            onClick={() =>
              void scrollToChatAgentSettings(
                SECTION_IDS.chatAgent,
                SECTION_IDS.chatAgent,
              )
            }
          >
            {hasDedicatedModel
              ? t("settings:chatAgent.composerDedicatedModel", {
                  model:
                    modelLabel ?? t("settings:chatAgent.composerUnknownModel"),
                })
              : t("settings:chatAgent.composerFallbackModel", {
                  model:
                    modelLabel ?? t("settings:chatAgent.composerUnknownModel"),
                })}
          </button>
        )}
      </p>
    </div>
  );
}
