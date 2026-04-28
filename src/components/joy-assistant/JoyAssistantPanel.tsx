/**
 * JoyAssistantPanel — Floating right-side AI assistant panel.
 *
 * Features:
 * - Streaming chat with the AI
 * - Mode toggle (auto / do-it-for-me / guide-me)
 * - Action cards with Execute/Skip buttons
 * - Contextual suggestion chips
 * - Minimize / clear controls
 * - Ctrl+Shift+A keyboard shortcut
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Cpu,
  Cloud,
  Eraser,
  Loader2,
  MessageSquarePlus,
  MessagesSquare,
  Pencil,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
  Wand2,
  Eye,
  Zap,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { VoiceInputButton } from "@/components/chat/VoiceInputButton";
import { useAutoTTS } from "@/hooks/useAutoTTS";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useJoyAssistant,
  useAssistantPanel,
  useAssistantMode,
  useAssistantSuggestions,
  useAssistantSessions,
  useDeleteAssistantSession,
  useRenameAssistantSession,
  useActiveAssistantSession,
  useAssistantSelectedModel,
} from "@/hooks/useJoyAssistant";
import { useLocalModels } from "@/hooks/useLocalModels";
import { useLocalLMSModels } from "@/hooks/useLMStudioModels";
import { useLanguageModelsByProviders } from "@/hooks/useLanguageModelsByProviders";
import { useAssistantContext } from "./AssistantContextProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  executeAction as execDom,
  guideAction as guideDom,
  clearGuides,
  type ActionContext,
} from "@/lib/joy_assistant_actions";
import type { AssistantAction, AssistantMode } from "@/types/joy_assistant_types";

// ── Mode labels ────────────────────────────────────────────────────────────

const MODE_CONFIG: Record<AssistantMode, { label: string; icon: typeof Zap; desc: string }> = {
  auto: { label: "Auto", icon: Zap, desc: "AI decides when to act or guide" },
  "do-it-for-me": { label: "Do It", icon: Wand2, desc: "AI performs actions for you" },
  "guide-me": { label: "Guide", icon: Eye, desc: "AI highlights and explains" },
};

// ── Panel Component ────────────────────────────────────────────────────────

export function JoyAssistantPanel() {
  const { open, setOpen, toggle } = useAssistantPanel();
  const { mode, setMode } = useAssistantMode();
  const { pageContext } = useAssistantContext();
  const navigate = useNavigate();
  const actionCtx: ActionContext = { navigate: (opts) => navigate({ to: opts.to }) };

  // Active session — falls back to a freshly-generated UUID for first-run.
  const [activeSessionId, setActiveSessionId] = useActiveAssistantSession();
  const sessionId =
    activeSessionId ?? ((): string => {
      const id = crypto.randomUUID();
      // Defer the atom write to next tick to avoid setState-during-render warnings.
      Promise.resolve().then(() => setActiveSessionId(id));
      return id;
    })();

  const sessionsQuery = useAssistantSessions();
  const deleteSession = useDeleteAssistantSession();
  const renameSession = useRenameAssistantSession();

  const {
    messages,
    streaming,
    pendingActions,
    sendMessage,
    regenerate,
    cancel,
    clearHistory,
    executeAction,
    dismissActions,
  } = useJoyAssistant(sessionId);

  const { autoTTSEnabled, toggleAutoTTS } = useAutoTTS({ messages, streaming });

  const { data: suggestions } = useAssistantSuggestions(pageContext);

  const [input, setInput] = useState("");
  const [minimized, setMinimized] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Keyboard shortcut: Ctrl+Shift+A ────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "A") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);

  // ── Auto-scroll on new messages ────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // ── Focus input when panel opens ───────────────────────────────────────
  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, minimized]);

  // ── Clean up highlights on close ───────────────────────────────────────
  useEffect(() => {
    if (!open) clearGuides();
  }, [open]);

  // ── Send handler ───────────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    if (!input.trim() || streaming) return;
    sendMessage(input.trim(), pageContext);
    setInput("");
  }, [input, streaming, sendMessage, pageContext]);

  // ── Execute / guide action ─────────────────────────────────────────────
  const handleAction = useCallback(
    async (action: AssistantAction) => {
      try {
        await executeAction(action);
        const effectiveMode = mode === "auto" ? "do-it-for-me" : mode;
        if (effectiveMode === "do-it-for-me") {
          execDom(action, actionCtx);
        } else {
          guideDom(action, actionCtx);
        }
      } catch {
        // Action execution failed silently
      }
    },
    [mode, executeAction, actionCtx],
  );

  // ── Suggestion click ───────────────────────────────────────────────────
  const handleSuggestion = useCallback(
    (text: string) => {
      sendMessage(text, pageContext);
    },
    [sendMessage, pageContext],
  );

  // ── Mode cycle ─────────────────────────────────────────────────────────
  const cycleMode = useCallback(() => {
    const modes: AssistantMode[] = ["auto", "do-it-for-me", "guide-me"];
    const next = modes[(modes.indexOf(mode) + 1) % modes.length];
    setMode(next);
  }, [mode, setMode]);

  // ── Session management ────────────────────────────────────────────────
  const newConversation = useCallback(() => {
    setActiveSessionId(crypto.randomUUID());
  }, [setActiveSessionId]);

  const switchToSession = useCallback(
    (id: string) => {
      if (id !== sessionId) setActiveSessionId(id);
    },
    [sessionId, setActiveSessionId],
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      deleteSession.mutate(id, {
        onSuccess: () => {
          if (id === sessionId) setActiveSessionId(crypto.randomUUID());
        },
      });
    },
    [deleteSession, sessionId, setActiveSessionId],
  );

  const handleRenameSession = useCallback(
    (id: string, currentTitle: string) => {
      const next = window.prompt("Rename conversation", currentTitle);
      if (next !== null && next.trim()) {
        renameSession.mutate({ sessionId: id, title: next.trim() });
      }
    },
    [renameSession],
  );

  const handleRegenerate = useCallback(() => {
    if (streaming) return;
    regenerate(pageContext);
  }, [streaming, regenerate, pageContext]);

  // ── Floating trigger button (shown when panel is closed) ───────────────
  if (!open) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setOpen(true)}
              className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 transition-transform"
              aria-label="Open Joy Assistant"
            >
              <Sparkles className="h-5 w-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p>Joy Assistant (Ctrl+Shift+A)</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const ModeIcon = MODE_CONFIG[mode].icon;

  return (
    <div
      className={cn(
        "fixed right-0 top-0 z-40 flex h-full flex-col border-l bg-background shadow-xl transition-all duration-200",
        minimized ? "w-12" : "w-[380px]",
      )}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {!minimized && (
          <>
            <Bot className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold flex-1">Joy Assistant</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={cycleMode}
                  >
                    <ModeIcon className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{MODE_CONFIG[mode].desc}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Badge variant="secondary" className="text-[10px] px-1.5">
              {MODE_CONFIG[mode].label}
            </Badge>
            <AssistantModelPicker />
          </>
        )}
        <div className="flex items-center gap-0.5 ml-auto">
          {!minimized && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={newConversation}
                title="New conversation"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Conversations"
                  >
                    <MessagesSquare className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>Conversations</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(sessionsQuery.data ?? []).length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                      No saved conversations yet
                    </div>
                  ) : (
                    (sessionsQuery.data ?? []).slice(0, 30).map((s) => (
                      <DropdownMenuItem
                        key={s.id}
                        onSelect={(e) => {
                          e.preventDefault();
                          switchToSession(s.id);
                        }}
                        className={cn(
                          "flex items-center gap-2 group",
                          s.id === sessionId && "bg-accent",
                        )}
                      >
                        <MessagesSquare className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">
                            {s.title}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {s.messageCount} msg ·{" "}
                            {new Date(s.lastActiveAt).toLocaleDateString()}
                          </div>
                        </div>
                        <button
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-muted rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRenameSession(s.id, s.title);
                          }}
                          title="Rename"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-destructive/10 rounded text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSession(s.id);
                          }}
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-7 w-7", autoTTSEnabled && "text-primary")}
                onClick={toggleAutoTTS}
                title={autoTTSEnabled ? "Disable auto-speak" : "Enable auto-speak"}
              >
                {autoTTSEnabled ? (
                  <Volume2 className="h-3.5 w-3.5" />
                ) : (
                  <VolumeX className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleRegenerate}
                disabled={streaming || messages.length === 0}
                title="Regenerate last response"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={clearHistory}
                title="Clear this conversation"
              >
                <Eraser className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setMinimized(!minimized)}
            title={minimized ? "Expand" : "Minimize"}
          >
            {minimized ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setOpen(false)}
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {minimized ? (
        // Minimized strip
        <button
          onClick={() => setMinimized(false)}
          className="flex flex-1 items-center justify-center"
        >
          <Sparkles className="h-4 w-4 text-primary" />
        </button>
      ) : (
        <>
          {/* ── Messages ────────────────────────────────────────────── */}
          <ScrollArea className="flex-1 px-3 py-2" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-4 py-12 text-muted-foreground">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div className="text-center max-w-[280px] space-y-1">
                  <p className="text-sm font-medium text-foreground">Hey! I&apos;m Joy</p>
                  <p className="text-xs">
                    Your AI assistant for everything in JoyCreate. I can navigate, create, explain, run commands, and more. Try me!
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "mb-3 max-w-[95%] rounded-lg px-3 py-2 text-sm",
                  msg.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-muted",
                )}
              >
                {/* Message text */}
                {msg.content ? (
                  msg.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_pre]:text-xs [&_code]:text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  )
                ) : (
                  streaming && msg.role === "assistant" ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span className="text-xs text-muted-foreground">Thinking...</span>
                    </div>
                  ) : null
                )}

                {/* Action cards */}
                {msg.actions && msg.actions.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {msg.actions.map((action, i) => (
                      <ActionCard
                        key={i}
                        action={action}
                        onExecute={() => handleAction(action)}
                        onSkip={dismissActions}
                      />
                    ))}
                  </div>
                )}

                {/* Routing badge */}
                {msg.routingInfo && (
                  <div className="mt-1 flex items-center gap-1">
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0"
                    >
                      {msg.routingInfo.providerId} / {msg.routingInfo.modelId}
                    </Badge>
                  </div>
                )}
              </div>
            ))}
          </ScrollArea>

          {/* ── Pending actions bar ─────────────────────────────────── */}
          {pendingActions.length > 0 && (
            <div className="border-t px-3 py-2">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <Play className="h-3 w-3" />
                <span>{pendingActions.length} action(s) ready</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-5 text-[10px]"
                  onClick={dismissActions}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          {/* ── Suggestions ─────────────────────────────────────────── */}
          {suggestions && suggestions.length > 0 && messages.length === 0 && (
            <div className="border-t px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-1.5">
                Suggestions
              </p>
              <div className="flex flex-wrap gap-1">
                {suggestions.slice(0, 6).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleSuggestion(s.text)}
                    className="rounded-full border bg-background px-2.5 py-1 text-[11px] hover:bg-accent transition-colors"
                  >
                    {s.text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Input ───────────────────────────────────────────────── */}
          <div className="border-t px-3 py-2">
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask anything... (Enter to send, Shift+Enter for new line)"
                className="flex-1 min-h-[36px] max-h-[120px] text-sm resize-none"
                rows={1}
                disabled={streaming}
              />
              <VoiceInputButton
                size="sm"
                showSettings={false}
                disabled={streaming}
                onTranscription={(text) => setInput((prev) => prev ? `${prev} ${text}` : text)}
              />
              {streaming ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={cancel}
                >
                  <Square className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={!input.trim()}
                  onClick={handleSend}
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── ActionCard sub-component ───────────────────────────────────────────────

function ActionCard({
  action,
  onExecute,
  onSkip,
}: {
  action: AssistantAction;
  onExecute: () => void;
  onSkip: () => void;
}) {
  const label = actionLabel(action);
  return (
    <div className="flex items-center gap-2 rounded border bg-background/50 px-2 py-1.5 text-xs">
      <Play className="h-3 w-3 shrink-0 text-primary" />
      <span className="flex-1 truncate">{label}</span>
      <Button
        variant="default"
        size="sm"
        className="h-5 px-2 text-[10px]"
        onClick={onExecute}
      >
        Run
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 px-1.5 text-[10px]"
        onClick={onSkip}
      >
        Skip
      </Button>
    </div>
  );
}

function actionLabel(action: AssistantAction): string {
  switch (action.type) {
    case "navigate":
      return `Navigate to ${action.route}`;
    case "fill":
      return `Fill "${action.fieldId}" with "${action.value.slice(0, 30)}"`;
    case "click":
      return `Click ${action.targetId}`;
    case "highlight":
      return `Highlight ${action.targetId}`;
    case "tooltip":
      return `Show tip on ${action.targetId}`;
    case "create-document":
      return `Create document: ${action.name}`;
    case "search":
      return `Search: ${action.query}`;
    case "open-dialog":
      return `Open ${action.dialogId}`;
    case "run-command":
      return `Run: ${action.command.slice(0, 50)}`;
    case "read-file":
      return `Read file: ${action.filePath}`;
    case "write-file":
      return `Write file: ${action.filePath}`;
    case "list-directory":
      return `List directory: ${action.directory}`;
    case "open-app":
      return `Open app: ${action.appName}`;
    case "open-url":
      return `Open URL: ${action.url}`;
    case "system-info":
      return `System info: ${action.infoType}`;
    default:
      return "Unknown action";
  }
}

// ── Model picker ───────────────────────────────────────────────────────────

function AssistantModelPicker() {
  const { model, setModel } = useAssistantSelectedModel();
  const [open, setOpen] = useState(false);
  const { models: ollamaModels, loadModels: loadOllama } = useLocalModels();
  const { models: lmsModels, loadModels: loadLMS } = useLocalLMSModels();
  const { data: cloudByProvider } = useLanguageModelsByProviders();

  useEffect(() => {
    if (open) {
      loadOllama();
      loadLMS();
    }
  }, [open, loadOllama, loadLMS]);

  const label = !model
    ? "Auto"
    : model.provider === "ollama" || model.provider === "lmstudio"
      ? model.name.split(":")[0]
      : model.name;

  const Icon =
    !model || model.provider === "auto"
      ? Sparkles
      : model.provider === "ollama" || model.provider === "lmstudio"
        ? Cpu
        : Cloud;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-1.5 text-[10px] gap-1 max-w-[110px]"
          title={`Model: ${label}`}
        >
          <Icon className="h-3 w-3 shrink-0" />
          <span className="truncate">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-h-96 overflow-y-auto">
        <DropdownMenuLabel>Auto</DropdownMenuLabel>
        <DropdownMenuItem
          className={!model ? "bg-accent" : ""}
          onSelect={() => {
            setModel(null);
            setOpen(false);
          }}
        >
          <Sparkles className="h-3.5 w-3.5 mr-2" />
          <div className="flex-1">
            <div className="text-xs font-medium">Auto (local-first)</div>
            <div className="text-[10px] text-muted-foreground">
              Use a local model if available, else cloud default
            </div>
          </div>
        </DropdownMenuItem>

        {ollamaModels.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Local — Ollama</DropdownMenuLabel>
            {ollamaModels.map((m) => {
              const isSelected =
                model?.provider === "ollama" && model?.name === m.modelName;
              return (
                <DropdownMenuItem
                  key={`ollama-${m.modelName}`}
                  className={isSelected ? "bg-accent" : ""}
                  onSelect={() => {
                    setModel({ provider: "ollama", name: m.modelName });
                    setOpen(false);
                  }}
                >
                  <Cpu className="h-3.5 w-3.5 mr-2 text-green-500" />
                  <span className="text-xs truncate">
                    {m.displayName || m.modelName}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </>
        )}

        {lmsModels.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Local — LM Studio</DropdownMenuLabel>
            {lmsModels.map((m) => {
              const isSelected =
                model?.provider === "lmstudio" && model?.name === m.modelName;
              return (
                <DropdownMenuItem
                  key={`lms-${m.modelName}`}
                  className={isSelected ? "bg-accent" : ""}
                  onSelect={() => {
                    setModel({ provider: "lmstudio", name: m.modelName });
                    setOpen(false);
                  }}
                >
                  <Cpu className="h-3.5 w-3.5 mr-2 text-green-500" />
                  <span className="text-xs truncate">
                    {m.displayName || m.modelName}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </>
        )}

        {cloudByProvider &&
          Object.entries(cloudByProvider)
            .filter(([pid, models]) => pid !== "auto" && models.length > 0)
            .map(([providerId, models]) => (
              <div key={`provider-${providerId}`}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="capitalize">
                  Cloud — {providerId}
                </DropdownMenuLabel>
                {models.slice(0, 12).map((m) => {
                  const isSelected =
                    model?.provider === providerId && model?.name === m.apiName;
                  return (
                    <DropdownMenuItem
                      key={`${providerId}-${m.apiName}`}
                      className={isSelected ? "bg-accent" : ""}
                      onSelect={() => {
                        setModel({ provider: providerId, name: m.apiName });
                        setOpen(false);
                      }}
                    >
                      <Cloud className="h-3.5 w-3.5 mr-2 text-blue-500" />
                      <span className="text-xs truncate">{m.displayName}</span>
                    </DropdownMenuItem>
                  );
                })}
              </div>
            ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}