/**
 * OpenClaw CNS Widget
 * 
 * A compact widget for quick CNS access from any studio or tool.
 * Provides chat, model selection, and workflow triggers.
 * 
 * 🦞 EXFOLIATE! EXFOLIATE!
 */

import React, { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Brain,
  Send,
  Loader2,
  Cpu,
  Cloud,
  Workflow,
  ChevronDown,
  Sparkles,
  Zap,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useCNSStatus,
  useCNSChat,
  useOllama,
  useN8nWorkflows,
} from "@/hooks/useOpenClawCNS";

// =============================================================================
// TYPES
// =============================================================================

interface CNSWidgetProps {
  className?: string;
  variant?: "button" | "inline" | "floating";
  showChat?: boolean;
  showWorkflows?: boolean;
  onResponse?: (response: string, isLocal: boolean) => void;
}

interface QuickMessage {
  role: "user" | "assistant";
  content: string;
  isLocal?: boolean;
}

interface OllamaModel {
  name: string;
  size: number;
}

interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
}

interface ChatResult {
  content: string;
  model?: string;
}

// =============================================================================
// QUICK CHAT PANEL
// =============================================================================

function QuickChatPanel({ 
  onResponse 
}: { 
  onResponse?: (response: string, isLocal: boolean) => void 
}) {
  const { chat, isLoading, streamedContent } = useCNSChat();
  const { ollamaAvailable } = useCNSStatus();
  const { models } = useOllama();
  
  const [input, setInput] = useState("");
  const [preferLocal, setPreferLocal] = useState(true);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [messages, setMessages] = useState<QuickMessage[]>([]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);

    try {
      const result = await chat(userMessage, { 
        preferLocal
      }) as ChatResult;
      
      const isLocal = preferLocal && ollamaAvailable;
      setMessages(prev => [...prev, { 
        role: "assistant", 
        content: result.content,
        isLocal
      }]);
      
      onResponse?.(result.content, isLocal);
    } catch {
      toast.error("Failed to get response");
    }
  };

  return (
    <div className="flex flex-col h-[300px]">
      {/* Messages */}
      <ScrollArea className="flex-1 p-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <Bot className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-xs text-muted-foreground">
              Quick chat with CNS
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((msg, i) => (
              <div 
                key={i}
                className={cn(
                  "flex",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div className={cn(
                  "max-w-[85%] p-2 rounded-lg text-xs",
                  msg.role === "user" 
                    ? "bg-primary text-primary-foreground" 
                    : "bg-muted"
                )}>
                  {msg.content}
                  {msg.role === "assistant" && (
                    <div className="flex items-center gap-1 mt-1 opacity-60">
                      {msg.isLocal ? (
                        <Cpu className="h-2 w-2" />
                      ) : (
                        <Cloud className="h-2 w-2" />
                      )}
                      <span className="text-[10px]">
                        {msg.isLocal ? "Local" : "Cloud"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="p-2 rounded-lg bg-muted">
                  {streamedContent ? (
                    <span className="text-xs">{streamedContent}</span>
                  ) : (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Controls */}
      <div className="border-t p-2 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Switch 
              checked={preferLocal} 
              onCheckedChange={setPreferLocal}
              disabled={!ollamaAvailable}
              className="scale-75"
            />
            <span className="text-muted-foreground">
              {preferLocal ? "Local" : "Cloud"}
            </span>
          </div>
          
          {ollamaAvailable && models.length > 0 && (
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="h-6 w-24 text-xs">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                {(models as OllamaModel[]).map((m: OllamaModel) => (
                  <SelectItem key={m.name} value={m.name} className="text-xs">
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex gap-1">
          <Input
            placeholder="Ask CNS..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            disabled={isLoading}
            className="h-8 text-xs"
          />
          <Button 
            size="sm" 
            className="h-8 w-8 p-0"
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// WORKFLOW TRIGGERS PANEL
// =============================================================================

function WorkflowTriggersPanel() {
  const { workflows, triggerWorkflow, isTriggering } = useN8nWorkflows();

  const handleTrigger = async (workflowId: string) => {
    try {
      await triggerWorkflow({ workflowId });
      toast.success("Workflow triggered");
    } catch {
      toast.error("Failed to trigger workflow");
    }
  };

  if (workflows.length === 0) {
    return (
      <div className="p-4 text-center">
        <Workflow className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">No workflows available</p>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1">
      {(workflows as N8nWorkflow[]).filter((w: N8nWorkflow) => w.active).slice(0, 5).map((wf: N8nWorkflow) => (
        <Button
          key={wf.id}
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs h-8"
          onClick={() => handleTrigger(wf.id)}
          disabled={isTriggering}
        >
          <Zap className="h-3 w-3 mr-2" />
          {wf.name}
        </Button>
      ))}
    </div>
  );
}

// =============================================================================
// MAIN WIDGET COMPONENT
// =============================================================================

export function CNSWidget({ 
  className,
  variant = "button",
  showChat = true,
  showWorkflows = true,
  onResponse
}: CNSWidgetProps) {
  const { isInitialized, ollamaAvailable, n8nConnected, initialize } = useCNSStatus();
  const [isOpen, setIsOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<"chat" | "workflows">("chat");

  const handleInitialize = async () => {
    try {
      await initialize({});
      toast.success("CNS initialized");
    } catch {
      toast.error("Failed to initialize");
    }
  };

  // Button trigger
  const trigger = (
    <Button
      variant={variant === "floating" ? "default" : "outline"}
      size={variant === "floating" ? "icon" : "sm"}
      className={cn(
        variant === "floating" && "h-12 w-12 rounded-full shadow-lg",
        className
      )}
    >
      <Brain className={cn(
        "text-primary",
        variant === "floating" ? "h-6 w-6" : "h-4 w-4"
      )} />
      {variant !== "floating" && (
        <>
          <span className="ml-2">CNS</span>
          <ChevronDown className="h-3 w-3 ml-1" />
        </>
      )}
    </Button>
  );

  // Inline variant - just show status
  if (variant === "inline") {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Brain className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">CNS</span>
        <div className="flex gap-1">
          {ollamaAvailable && (
            <Badge variant="secondary" className="text-[10px] h-5">
              <Cpu className="h-2 w-2 mr-1" />
              Local
            </Badge>
          )}
          {n8nConnected && (
            <Badge variant="secondary" className="text-[10px] h-5">
              <Workflow className="h-2 w-2 mr-1" />
              n8n
            </Badge>
          )}
        </div>
      </div>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent 
        className="w-80 p-0" 
        align={variant === "floating" ? "end" : "start"}
      >
        {/* Header */}
        <div className="p-3 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">OpenClaw CNS</span>
              <Badge variant="outline" className="text-[10px]">🦞</Badge>
            </div>
            <div className="flex gap-1">
              {ollamaAvailable && (
                <Badge variant="secondary" className="text-[10px] h-5">
                  <Cpu className="h-2 w-2 mr-1" />
                  Ollama
                </Badge>
              )}
              {n8nConnected && (
                <Badge variant="secondary" className="text-[10px] h-5">
                  <Workflow className="h-2 w-2 mr-1" />
                  n8n
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        {!isInitialized ? (
          <div className="p-6 text-center">
            <Brain className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-4">
              CNS is not initialized
            </p>
            <Button onClick={handleInitialize} size="sm">
              <Sparkles className="h-4 w-4 mr-2" />
              Initialize CNS
            </Button>
          </div>
        ) : (
          <>
            {/* Tabs */}
            {showChat && showWorkflows && (
              <div className="flex border-b">
                <button
                  className={cn(
                    "flex-1 p-2 text-xs font-medium border-b-2 transition-colors",
                    activePanel === "chat" 
                      ? "border-primary text-primary" 
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setActivePanel("chat")}
                >
                  Chat
                </button>
                <button
                  className={cn(
                    "flex-1 p-2 text-xs font-medium border-b-2 transition-colors",
                    activePanel === "workflows" 
                      ? "border-primary text-primary" 
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setActivePanel("workflows")}
                >
                  Workflows
                </button>
              </div>
            )}

            {/* Panels */}
            {showChat && activePanel === "chat" && (
              <QuickChatPanel onResponse={onResponse} />
            )}
            {showWorkflows && activePanel === "workflows" && (
              <WorkflowTriggersPanel />
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

// =============================================================================
// FLOATING WIDGET (for global access)
// =============================================================================

export function CNSFloatingWidget({ className }: { className?: string }) {
  return (
    <div className={cn("fixed bottom-4 right-4 z-50", className)}>
      <CNSWidget variant="floating" />
    </div>
  );
}

export default CNSWidget;
