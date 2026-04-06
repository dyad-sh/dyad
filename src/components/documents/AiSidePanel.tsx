import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Wand2,
  SpellCheck,
  FileText,
  PenLine,
  Paintbrush,
  BookOpen,
  MessageSquare,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import { libreOfficeClient } from "@/ipc/libreoffice_client";
import { useLocalModels } from "@/hooks/useLocalModels";
import { useLocalLMSModels } from "@/hooks/useLMStudioModels";
import { useLanguageModelsByProviders } from "@/hooks/useLanguageModelsByProviders";
import { useSettings } from "@/hooks/useSettings";
import { toast } from "sonner";

type AiCommand = "improve" | "grammar" | "summarize" | "continue" | "tone" | "explain" | "custom";

const COMMANDS: { id: AiCommand; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "improve", label: "Improve writing", icon: Wand2 },
  { id: "grammar", label: "Fix grammar", icon: SpellCheck },
  { id: "summarize", label: "Summarize", icon: FileText },
  { id: "continue", label: "Continue writing", icon: PenLine },
  { id: "tone", label: "Change tone", icon: Paintbrush },
  { id: "explain", label: "Explain", icon: BookOpen },
  { id: "custom", label: "Custom prompt", icon: MessageSquare },
];

const TONES = ["professional", "casual", "formal", "friendly", "concise", "persuasive", "creative"];

interface AiSidePanelProps {
  docId: number;
  /** Plain text of entire document (for context) */
  docText: string;
  /** Currently selected/highlighted text — runs AI on this */
  selectedText?: string;
  onInsert?: (text: string) => void;
  onReplace?: (text: string) => void;
  className?: string;
}

export function AiSidePanel({ docId, docText, selectedText, onInsert, onReplace, className }: AiSidePanelProps) {
  const { settings } = useSettings();
  const { models: localModels } = useLocalModels();
  const { models: lmStudioModels } = useLocalLMSModels();
  const { data: cloudModelsByProvider = {} } = useLanguageModelsByProviders();

  const [command, setCommand] = useState<AiCommand>("improve");
  const [toneValue, setToneValue] = useState("professional");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("__settings__");
  const [isStreaming, setIsStreaming] = useState(false);
  const [result, setResult] = useState("");
  const [copied, setCopied] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const resultRef = useRef("");

  // Build model options list
  const modelOptions = [
    { value: "__settings__", label: "Use settings model", group: "Default" },
    ...localModels.map((m) => ({ value: `ollama::${m.modelName}`, label: m.displayName, group: "Local (Ollama)" })),
    ...lmStudioModels.map((m) => ({ value: `lmstudio::${m.modelName}`, label: m.displayName, group: "Local (LM Studio)" })),
    ...Object.entries(cloudModelsByProvider).flatMap(([provider, models]) =>
      models.map((m) => ({ value: `${provider}::${m.apiName}`, label: m.displayName, group: provider }))
    ),
  ];

  // Group options for the select
  const groupedOptions = modelOptions.reduce<Record<string, typeof modelOptions>>(
    (acc, opt) => {
      if (!acc[opt.group]) acc[opt.group] = [];
      acc[opt.group].push(opt);
      return acc;
    },
    {}
  );

  const run = useCallback(() => {
    const input = selectedText?.trim() || docText.trim();
    if (!input) {
      toast.error("No text to process — select some text or open a document with content.");
      return;
    }
    if (command === "custom" && !customPrompt.trim()) {
      toast.error("Enter a custom prompt first.");
      return;
    }

    cleanupRef.current?.();
    setIsStreaming(true);
    setResult("");
    resultRef.current = "";

    const requestId = crypto.randomUUID();
    const parts = selectedModel !== "__settings__" ? selectedModel.split("::") : [];
    const provider = parts[0];
    const model = parts.slice(1).join("::");

    // Resolve provider/model from settings if using default
    const settingsModel = (settings as Record<string, unknown>).documentAiModel ??
      (settings as Record<string, unknown>).selectedModel as { provider?: string; name?: string } | undefined;

    const cleanup = libreOfficeClient.aiAssist(
      requestId,
      {
        docId,
        command,
        selection: input,
        context: selectedText ? docText.slice(0, 500) : undefined,
        toneValue: command === "tone" ? toneValue : undefined,
        customPrompt: command === "custom" ? customPrompt : undefined,
        ...(provider && model ? { provider, model } : {}),
        ...(!provider && settingsModel
          ? { provider: (settingsModel as Record<string, string>).provider, model: (settingsModel as Record<string, string>).name }
          : {}),
      },
      (chunk) => {
        resultRef.current += chunk;
        setResult(resultRef.current);
      },
      ({ error }) => {
        setIsStreaming(false);
        if (error) toast.error(`AI assist failed: ${error}`);
      }
    );
    cleanupRef.current = cleanup;
  }, [command, customPrompt, docId, docText, selectedText, selectedModel, toneValue, settings]);

  useEffect(() => () => cleanupRef.current?.(), []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(result).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [result]);

  const currentCommand = COMMANDS.find((c) => c.id === command)!;
  const CommandIcon = currentCommand.icon;

  return (
    <div className={cn("flex flex-col h-full border-l bg-background/95 backdrop-blur", className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center gap-2 shrink-0">
        <Wand2 className="size-4 text-primary" />
        <span className="text-sm font-semibold">AI Assist</span>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 flex flex-col gap-4">
          {/* Command picker */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Command</span>
            <div className="grid grid-cols-2 gap-1.5">
              {COMMANDS.map((cmd) => {
                const Icon = cmd.icon;
                return (
                  <button
                    key={cmd.id}
                    onClick={() => setCommand(cmd.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border transition-colors text-left",
                      command === cmd.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "hover:bg-muted/60 border-border text-foreground"
                    )}
                  >
                    <Icon className="size-3 shrink-0" />
                    {cmd.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tone picker (only when command === tone) */}
          {command === "tone" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tone</span>
              <Select value={toneValue} onValueChange={setToneValue}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Custom prompt (only when command === custom) */}
          {command === "custom" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prompt</span>
              <Textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Describe what you want the AI to do…"
                className="text-sm min-h-[80px] resize-none"
              />
            </div>
          )}

          {/* Input preview */}
          {(selectedText?.trim() || docText.trim()) && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {selectedText?.trim() ? "Selected text" : "Full document"}
              </span>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground line-clamp-4 whitespace-pre-line">
                {(selectedText?.trim() || docText.trim()).slice(0, 300)}
                {(selectedText?.trim() || docText.trim()).length > 300 ? "…" : ""}
              </div>
            </div>
          )}

          {/* Model selector */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Model</span>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(groupedOptions).map(([group, opts]) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {opts.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Run button */}
          <Button onClick={run} disabled={isStreaming} className="gap-1.5 w-full">
            {isStreaming ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CommandIcon className="size-4" />
            )}
            {isStreaming ? "Working…" : currentCommand.label}
          </Button>

          {/* Result */}
          {result && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Result</span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy} title="Copy">
                    {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
                  </Button>
                </div>
              </div>

              <div className="rounded-md border bg-muted/10 px-3 py-2 text-sm text-foreground whitespace-pre-line leading-relaxed">
                {result}
                {isStreaming && <span className="inline-block w-1 h-3.5 bg-primary animate-pulse ml-0.5 align-text-bottom" />}
              </div>

              {!isStreaming && (
                <div className="flex gap-2">
                  {onReplace && selectedText?.trim() && (
                    <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => onReplace(result)}>
                      Replace selection
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => onInsert?.(result)}>
                    Insert into doc
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
