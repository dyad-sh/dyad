/**
 * Agent Test Page
 * Interactive testing interface for AI agents
 */

import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  Send,
  Settings,
  Trash2,
  RotateCcw,
  Copy,
  Download,
  User,
  Loader2,
  Wrench,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

import { agentBuilderClient } from "@/ipc/agent_builder_client";
import { showError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

import type { AgentTestMessage, AgentToolCall } from "@/types/agent_builder";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  toolCalls?: AgentToolCall[];
  isStreaming?: boolean;
}

export default function AgentTestPage() {
  const navigate = useNavigate();
  const { agentId } = useParams({ from: "/agents/$agentId/test" });
  const queryClient = useQueryClient();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch agent data
  const { data: agent, isLoading: agentLoading } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => agentBuilderClient.getAgent(Number(agentId)),
    enabled: !!agentId,
  });

  // Fetch agent tools
  const { data: tools = [] } = useQuery({
    queryKey: ["agent-tools", agentId],
    queryFn: () => agentBuilderClient.getAgentTools(Number(agentId)),
    enabled: !!agentId,
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    // Add streaming placeholder
    const assistantMessageId = `assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isStreaming: true,
      },
    ]);

    try {
      // Simulate streaming response (replace with actual agent execution)
      const response = await simulateAgentResponse(userMessage.content, agent);

      // Update message with response
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content: response.content,
                toolCalls: response.toolCalls,
                isStreaming: false,
              }
            : msg
        )
      );
    } catch (error) {
      showError("Failed to get response from agent");
      // Remove streaming placeholder on error
      setMessages((prev) => prev.filter((msg) => msg.id !== assistantMessageId));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearChat = () => {
    setMessages([]);
  };

  const handleCopyChat = () => {
    const chatText = messages
      .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
      .join("\n\n");
    navigator.clipboard.writeText(chatText);
    showSuccess("Chat copied to clipboard");
  };

  const handleExportChat = () => {
    const chatData = {
      agentId: agent?.id,
      agentName: agent?.name,
      messages: messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp.toISOString(),
        toolCalls: msg.toolCalls,
      })),
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(chatData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agent-test-${agent?.name || "unknown"}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (agentLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <h2 className="text-lg font-medium mb-2">Agent not found</h2>
        <Button variant="outline" onClick={() => navigate({ to: "/agents" })}>
          Back to Agents
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                navigate({ to: "/agents/$agentId", params: { agentId: String(agent.id) } })
              }
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                <Bot className="h-5 w-5" />
                Test: {agent.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                Interactive testing environment
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleCopyChat}>
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportChat}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={handleClearChat}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Clear
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate({ to: "/agents/$agentId", params: { agentId: String(agent.id) } })
              }
            >
              <Settings className="h-4 w-4 mr-2" />
              Configure
            </Button>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Messages */}
        <div className="flex-1 flex flex-col">
          <ScrollArea className="flex-1 p-4">
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <Bot className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">Start Testing</h3>
                  <p className="text-muted-foreground max-w-md">
                    Send a message to test your agent's behavior and capabilities.
                    Tool calls and responses will be displayed here.
                  </p>
                </div>
              ) : (
                messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input Area */}
          <div className="border-t p-4">
            <div className="max-w-3xl mx-auto">
              <div className="relative">
                <Textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message to test your agent..."
                  className="pr-12 min-h-[60px] resize-none"
                  disabled={isLoading}
                />
                <Button
                  size="icon"
                  className="absolute right-2 bottom-2"
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Press Enter to send, Shift+Enter for new line
              </p>
            </div>
          </div>
        </div>

        {/* Sidebar - Tools & Info */}
        <div className="w-72 border-l bg-muted/30 p-4 overflow-auto">
          <div className="space-y-4">
            <div>
              <h3 className="font-medium mb-2">Agent Info</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <Badge variant="secondary">{agent.type}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Model</span>
                  <span>{agent.modelId || "Default"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Temperature</span>
                  <span>{agent.temperature ?? 0.7}</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-medium mb-2">Available Tools ({tools.length})</h3>
              {tools.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tools configured</p>
              ) : (
                <div className="space-y-1">
                  {tools.map((tool) => (
                    <div
                      key={tool.id}
                      className="flex items-center gap-2 text-sm p-2 rounded bg-background"
                    >
                      <Wrench className="h-3 w-3" />
                      <span className="truncate">{tool.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="font-medium mb-2">Session Stats</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Messages</span>
                  <span>{messages.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tool Calls</span>
                  <span>
                    {messages.reduce(
                      (acc, msg) => acc + (msg.toolCalls?.length || 0),
                      0
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <Avatar className="h-8 w-8">
          <AvatarFallback>
            <Bot className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}

      <div className={cn("max-w-[80%] space-y-2", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-lg px-4 py-2",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          )}
        >
          {message.isStreaming ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Thinking...</span>
            </div>
          ) : (
            <div className="whitespace-pre-wrap">{message.content}</div>
          )}
        </div>

        {/* Tool Calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <Collapsible open={toolsExpanded} onOpenChange={setToolsExpanded}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-auto py-1 px-2">
                {toolsExpanded ? (
                  <ChevronDown className="h-3 w-3 mr-1" />
                ) : (
                  <ChevronRight className="h-3 w-3 mr-1" />
                )}
                {message.toolCalls.length} tool call
                {message.toolCalls.length > 1 ? "s" : ""}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 mt-2">
              {message.toolCalls.map((toolCall) => (
                <Card key={toolCall.id} className="text-sm">
                  <CardHeader className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <Wrench className="h-3 w-3" />
                      <span className="font-medium">{toolCall.name}</span>
                      {toolCall.status === "completed" ? (
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                      ) : toolCall.status === "failed" ? (
                        <XCircle className="h-3 w-3 text-red-500" />
                      ) : (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="py-2 px-3">
                    <div className="space-y-1">
                      <div>
                        <span className="text-muted-foreground">Input:</span>
                        <pre className="text-xs bg-muted p-1 rounded mt-1 overflow-x-auto">
                          {JSON.stringify(toolCall.input, null, 2)}
                        </pre>
                      </div>
                      {toolCall.output !== undefined && toolCall.output !== null && (
                        <div>
                          <span className="text-muted-foreground">Output:</span>
                          <pre className="text-xs bg-muted p-1 rounded mt-1 overflow-x-auto">
                            {JSON.stringify(toolCall.output, null, 2)}
                          </pre>
                        </div>
                      )}
                      {toolCall.error && (
                        <div className="text-red-500">Error: {toolCall.error}</div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        <div className="text-xs text-muted-foreground">
          {message.timestamp.toLocaleTimeString()}
        </div>
      </div>

      {isUser && (
        <Avatar className="h-8 w-8">
          <AvatarFallback>
            <User className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

// Simulated agent response (replace with actual agent execution)
async function simulateAgentResponse(
  userMessage: string,
  agent: any
): Promise<{ content: string; toolCalls?: AgentToolCall[] }> {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 2000));

  // Simple mock response based on agent type
  const responses: Record<string, string> = {
    chatbot: `I understand you're asking about: "${userMessage}"\n\nAs a ${agent?.name || "chatbot"}, I'm here to help! This is a test response. In a real deployment, I would use my configured model and tools to provide a more relevant response.`,
    task: `Analyzing your request: "${userMessage}"\n\nI'll break this down into steps and execute them. This is a simulated response for testing purposes.`,
    rag: `Searching knowledge base for: "${userMessage}"\n\nBased on the available documents, here's what I found... (simulated response)`,
    workflow: `Starting workflow for: "${userMessage}"\n\nExecuting workflow steps... (simulated response)`,
    "multi-agent": `Coordinating agents for: "${userMessage}"\n\nDelegating to specialized agents... (simulated response)`,
  };

  // Simulate tool call for demonstration
  const toolCalls: AgentToolCall[] = [];
  if (userMessage.toLowerCase().includes("weather")) {
    toolCalls.push({
      id: `tool-${Date.now()}`,
      name: "get_weather",
      input: { location: "San Francisco" },
      output: { temperature: 68, condition: "Sunny" },
      status: "completed",
    });
  }

  return {
    content: responses[agent?.type || "chatbot"] || responses.chatbot,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}
