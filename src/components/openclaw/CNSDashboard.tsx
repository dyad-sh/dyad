/**
 * OpenClaw CNS Dashboard
 * 
 * The central control panel for JoyCreate's AI nervous system.
 * Provides unified control over Ollama, n8n, and OpenClaw channels.
 * 
 * 🦞 EXFOLIATE! EXFOLIATE!
 */

import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { OpenClawClient } from "@/ipc/openclaw_client";
import { VoiceInputButton } from "@/components/chat/VoiceInputButton";
import { VoiceAssistantClient, type SystemCapabilities, type ElevenLabsVoice } from "@/ipc/voice_assistant_client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Brain,
  Server,
  Workflow,
  MessageSquare,
  Zap,
  RefreshCw,
  Play,
  Square,
  Settings,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Activity,
  Cpu,
  Cloud,
  Send,
  Bot,
  Loader2,
  Cable,
  Radio,
  ChevronRight,
  Gauge,
  BarChart3,
  Timer,
  Mic,
  Volume2,
  AudioWaveform,
  Download,
  Key,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useCNSStatus,
  useCNSConfig,
  useCNSChat,
  useOllama,
  useOllamaInference,
  useOllamaPerformance,
  useN8nConnections,
  useN8nWorkflows,
  useOpenClawCNS,
} from "@/hooks/useOpenClawCNS";

// =============================================================================
// TYPES
// =============================================================================

interface OllamaModel {
  name: string;
  size: number;
  digest?: string;
  modifiedAt?: string;
}

interface N8nConnection {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  status?: "connected" | "disconnected" | "error";
}

interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  tags?: string[];
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  isLocal?: boolean;
}

interface InferenceResult {
  content: string;
  model?: string;
  tokens?: number;
}

interface TestConnectionResult {
  success: boolean;
  message?: string;
}

// =============================================================================
// TYPES
// =============================================================================

interface CNSDashboardProps {
  className?: string;
  compact?: boolean;
}

// =============================================================================
// STATUS INDICATOR
// =============================================================================

function StatusIndicator({ 
  status, 
  label 
}: { 
  status: "connected" | "disconnected" | "loading" | "error"; 
  label: string 
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        "w-2 h-2 rounded-full",
        status === "connected" && "bg-green-500",
        status === "disconnected" && "bg-gray-400",
        status === "loading" && "bg-yellow-500 animate-pulse",
        status === "error" && "bg-red-500"
      )} />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

// =============================================================================
// OLLAMA PANEL
// =============================================================================

function OllamaPanel() {
  const { 
    status, 
    isAvailable, 
    models, 
    checkHealth, 
    refreshModels,
    isRefreshing 
  } = useOllama();
  const { performance } = useOllamaPerformance();
  const { inference, isInferencing, streamedContent, result } = useOllamaInference();
  
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [testPrompt, setTestPrompt] = useState("");

  useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      setSelectedModel(models[0].name);
    }
  }, [models, selectedModel]);

  const handleTest = () => {
    if (!selectedModel || !testPrompt.trim()) return;
    
    inference({
      model: selectedModel,
      messages: [{ role: "user", content: testPrompt }],
      maxTokens: 256,
    });
  };

  const inferenceResult = result as InferenceResult | undefined;

  return (
    <div className="space-y-4">
      {/* Status Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "p-2 rounded-lg",
            isAvailable ? "bg-green-500/10" : "bg-gray-500/10"
          )}>
            <Cpu className={cn(
              "h-5 w-5",
              isAvailable ? "text-green-500" : "text-gray-500"
            )} />
          </div>
          <div>
            <h3 className="font-semibold">Ollama</h3>
            <p className="text-sm text-muted-foreground">
              {isAvailable ? `${models.length} models available` : "Not running"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => checkHealth()}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Check
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshModels()}
            disabled={isRefreshing || !isAvailable}
          >
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Refresh Models"
            )}
          </Button>
        </div>
      </div>

      {/* Models Grid */}
      {isAvailable && models.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {(models as OllamaModel[]).slice(0, 6).map((model) => {
            const perf = performance[model.name];
            return (
              <div 
                key={model.name}
                className={cn(
                  "p-3 rounded-lg border cursor-pointer transition-colors",
                  selectedModel === model.name 
                    ? "border-primary bg-primary/5" 
                    : "hover:bg-muted"
                )}
                onClick={() => setSelectedModel(model.name)}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm truncate">
                    {model.name}
                  </span>
                  {selectedModel === model.name && (
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{(model.size / 1e9).toFixed(1)}GB</span>
                  {perf && (
                    <>
                      <span>•</span>
                      <span>{perf.avgTokensPerSecond.toFixed(1)} t/s</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Test */}
      {isAvailable && (
        <div className="space-y-2">
          <Label>Quick Test</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Enter a test prompt..."
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleTest()}
            />
            <Button 
              onClick={handleTest}
              disabled={isInferencing || !selectedModel || !testPrompt.trim()}
            >
              {isInferencing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          {(streamedContent || inferenceResult) && (
            <div className="p-3 rounded-lg bg-muted text-sm">
              {streamedContent || inferenceResult?.content}
            </div>
          )}
        </div>
      )}

      {/* Not Available Message */}
      {!isAvailable && (
        <div className="p-4 rounded-lg border border-dashed text-center">
          <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Ollama is not running. Start it with <code className="bg-muted px-1 rounded">ollama serve</code>
          </p>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// N8N PANEL
// =============================================================================

function N8nPanel() {
  const { 
    connections, 
    addConnection, 
    removeConnection, 
    testConnection,
    isAdding,
    isTesting 
  } = useN8nConnections();
  
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newConnection, setNewConnection] = useState({
    id: "",
    name: "",
    baseUrl: "http://localhost:5678",
    apiKey: "",
  });

  const handleAdd = async () => {
    if (!newConnection.name || !newConnection.baseUrl) {
      toast.error("Name and URL are required");
      return;
    }

    const id = newConnection.id || `conn-${Date.now()}`;
    addConnection({ ...newConnection, id });
    setShowAddDialog(false);
    setNewConnection({ id: "", name: "", baseUrl: "http://localhost:5678", apiKey: "" });
    toast.success("Connection added");
  };

  const handleTest = async (connectionId: string) => {
    try {
      const result = await testConnection(connectionId) as TestConnectionResult;
      if (result.success) {
        toast.success("Connection successful");
      } else {
        toast.error("Connection failed");
      }
    } catch {
      toast.error("Connection test failed");
    }
  };

  const handleRemove = (connectionId: string) => {
    removeConnection(connectionId);
    toast.success("Connection removed");
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "p-2 rounded-lg",
            (connections as N8nConnection[]).some((c: N8nConnection) => c.status === "connected") 
              ? "bg-purple-500/10" 
              : "bg-gray-500/10"
          )}>
            <Workflow className={cn(
              "h-5 w-5",
              (connections as N8nConnection[]).some((c: N8nConnection) => c.status === "connected") 
                ? "text-purple-500" 
                : "text-gray-500"
            )} />
          </div>
          <div>
            <h3 className="font-semibold">n8n</h3>
            <p className="text-sm text-muted-foreground">
              {connections.length} connection{connections.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add n8n Connection</DialogTitle>
              <DialogDescription>
                Connect to an n8n instance for workflow automation.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder="My n8n Server"
                  value={newConnection.name}
                  onChange={(e) => setNewConnection(prev => ({ 
                    ...prev, 
                    name: e.target.value 
                  }))}
                />
              </div>
              <div className="space-y-2">
                <Label>URL</Label>
                <Input
                  placeholder="http://localhost:5678"
                  value={newConnection.baseUrl}
                  onChange={(e) => setNewConnection(prev => ({ 
                    ...prev, 
                    baseUrl: e.target.value 
                  }))}
                />
              </div>
              <div className="space-y-2">
                <Label>API Key (optional)</Label>
                <Input
                  type="password"
                  placeholder="n8n API key"
                  value={newConnection.apiKey}
                  onChange={(e) => setNewConnection(prev => ({ 
                    ...prev, 
                    apiKey: e.target.value 
                  }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleAdd} disabled={isAdding}>
                {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Connections List */}
      {connections.length > 0 ? (
        <div className="space-y-2">
          {(connections as N8nConnection[]).map((conn: N8nConnection) => (
            <div 
              key={conn.id}
              className="flex items-center justify-between p-3 rounded-lg border"
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  conn.status === "connected" && "bg-green-500",
                  conn.status === "disconnected" && "bg-gray-400",
                  conn.status === "error" && "bg-red-500"
                )} />
                <div>
                  <p className="font-medium text-sm">{conn.name}</p>
                  <p className="text-xs text-muted-foreground">{conn.baseUrl}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => handleTest(conn.id)}
                  disabled={isTesting}
                >
                  {isTesting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Activity className="h-4 w-4" />
                  )}
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => handleRemove(conn.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 rounded-lg border border-dashed text-center">
          <Workflow className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No n8n connections. Add one to enable workflow automation.
          </p>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// N8N WORKFLOWS PANEL
// =============================================================================

function N8nWorkflowsPanel({ connectionId }: { connectionId?: string }) {
  const { 
    workflows, 
    isLoading, 
    triggerWorkflow, 
    isTriggering,
    lastExecution 
  } = useN8nWorkflows(connectionId);

  const handleTrigger = async (workflowId: string) => {
    try {
      await triggerWorkflow({ workflowId });
      toast.success("Workflow triggered");
    } catch {
      toast.error("Failed to trigger workflow");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {workflows.length > 0 ? (
        (workflows as N8nWorkflow[]).map((wf: N8nWorkflow) => (
          <div 
            key={wf.id}
            className="flex items-center justify-between p-3 rounded-lg border"
          >
            <div className="flex items-center gap-3">
              <Badge variant={wf.active ? "default" : "secondary"}>
                {wf.active ? "Active" : "Inactive"}
              </Badge>
              <div>
                <p className="font-medium text-sm">{wf.name}</p>
                {wf.tags && wf.tags.length > 0 && (
                  <div className="flex gap-1 mt-1">
                    {wf.tags.slice(0, 3).map((tag: string) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleTrigger(wf.id)}
              disabled={isTriggering || !wf.active}
            >
              {isTriggering ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Play className="h-4 w-4 mr-1" />
                  Run
                </>
              )}
            </Button>
          </div>
        ))
      ) : (
        <div className="p-4 rounded-lg border border-dashed text-center">
          <p className="text-sm text-muted-foreground">
            No workflows found. Create workflows in n8n.
          </p>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// CHAT PANEL
// =============================================================================

function ChatPanel() {
  const { chat, isLoading: cnsLoading, streamedContent, lastResponse, error } = useCNSChat();
  const { isInitialized, ollamaAvailable } = useCNSStatus();

  const [input, setInput] = useState("");
  const [preferLocal, setPreferLocal] = useState(true);
  const [fallbackBusy, setFallbackBusy] = useState(false);
  const isLoading = cnsLoading || fallbackBusy;
  const [messages, setMessages] = useState<Array<{
    role: "user" | "assistant";
    content: string;
    isLocal?: boolean;
    via?: "cns" | "openclaw";
  }>>([]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);

    // Prefer CNS (in-process Ollama). If CNS isn't initialized or throws,
    // fall back to the OpenClaw gateway, which handles Anthropic / OpenAI /
    // Ollama directly and works even when the daemon portal iframe is down.
    const fallbackToOpenClaw = async () => {
      setFallbackBusy(true);
      try {
        const result = await OpenClawClient.chat({
          messages: [{ role: "user", content: userMessage }],
          stream: false,
          preferLocal,
        } as any);
        setMessages(prev => [...prev, {
          role: "assistant",
          content: result.message?.content ?? "(no content)",
          isLocal: !!result.localProcessed,
          via: "openclaw",
        }]);
      } catch (fallbackErr) {
        toast.error(
          `Chat failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
        );
      } finally {
        setFallbackBusy(false);
      }
    };

    if (!isInitialized) {
      await fallbackToOpenClaw();
      return;
    }

    try {
      const result = await chat(userMessage, { preferLocal }) as InferenceResult;
      setMessages(prev => [...prev, {
        role: "assistant",
        content: result.content,
        isLocal: preferLocal && ollamaAvailable,
        via: "cns",
      }]);
    } catch (err) {
      // CNS failed (e.g. daemon-backed pieces unavailable) — fall back to OpenClaw
      await fallbackToOpenClaw();
    }
  };

  return (
    <div className="flex flex-col h-[400px]">
      {/* Messages */}
      <ScrollArea className="flex-1 p-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Brain className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              Chat with OpenClaw CNS
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {ollamaAvailable 
                ? "Using Ollama for local AI" 
                : "Using cloud AI"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, i) => (
              <div 
                key={i}
                className={cn(
                  "flex gap-2",
                  msg.role === "user" && "flex-row-reverse"
                )}
              >
                <div className={cn(
                  "max-w-[80%] p-3 rounded-lg",
                  msg.role === "user" 
                    ? "bg-primary text-primary-foreground" 
                    : "bg-muted"
                )}>
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  {msg.role === "assistant" && (
                    <div className="flex items-center gap-1 mt-1">
                      {msg.isLocal ? (
                        <Cpu className="h-3 w-3 text-green-500" />
                      ) : (
                        <Cloud className="h-3 w-3 text-blue-500" />
                      )}
                      <span className="text-xs opacity-60">
                        {msg.isLocal ? "Local" : "Cloud"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && streamedContent && (
              <div className="flex gap-2">
                <div className="max-w-[80%] p-3 rounded-lg bg-muted">
                  <p className="text-sm whitespace-pre-wrap">{streamedContent}</p>
                  <Loader2 className="h-3 w-3 animate-spin mt-1" />
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="border-t p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch 
              checked={preferLocal} 
              onCheckedChange={setPreferLocal}
              disabled={!ollamaAvailable}
            />
            <Label className="text-xs">
              {preferLocal ? "Local (Ollama)" : "Cloud"}
            </Label>
          </div>
          {!ollamaAvailable && (
            <Badge variant="outline" className="text-xs">
              <Cloud className="h-3 w-3 mr-1" />
              Cloud only
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            disabled={isLoading}
          />
          <VoiceInputButton
            size="sm"
            showSettings={false}
            disabled={isLoading}
            onTranscription={(text) => setInput((prev) => prev ? `${prev} ${text}` : text)}
          />
          <Button onClick={handleSend} disabled={isLoading || !input.trim()}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// VOICE PANEL
// =============================================================================

function VoicePanel() {
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [elevenlabsKey, setElevenlabsKey] = useState("");
  const [elevenlabsVoices, setElevenlabsVoices] = useState<ElevenLabsVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [testText, setTestText] = useState("Hello! I am your voice assistant.");
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    VoiceAssistantClient.initialize()
      .then(() => VoiceAssistantClient.getCapabilities())
      .then((caps) => setCapabilities(caps))
      .catch((err) => console.error("Voice detection failed:", err))
      .finally(() => setLoading(false));
  }, []);

  const loadVoices = async () => {
    if (!elevenlabsKey.trim()) return;
    setLoadingVoices(true);
    try {
      await VoiceAssistantClient.setElevenLabsApiKey(elevenlabsKey.trim());
      const voices = await VoiceAssistantClient.getElevenLabsVoices();
      setElevenlabsVoices(voices);
      toast.success(`Loaded ${voices.length} ElevenLabs voices`);
    } catch (err) {
      toast.error(`Failed to load voices: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingVoices(false);
    }
  };

  const handleTestTTS = async (engine: string) => {
    setSpeaking(true);
    try {
      await VoiceAssistantClient.speak({ text: testText });
      toast.success("TTS playback complete");
    } catch (err) {
      toast.error(`TTS failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSpeaking(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Detecting voice capabilities...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* System Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AudioWaveform className="h-4 w-4" />
            Local Voice Capabilities
          </CardTitle>
          <CardDescription>Piper TTS and Whisper STT running on your machine — no internet required</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-2">
              {capabilities?.hasWhisper ? (
                <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Whisper (Local STT)</Badge>
              ) : (
                <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Whisper</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {capabilities?.hasPiper ? (
                <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Piper (Local TTS)</Badge>
              ) : (
                <Badge variant="secondary" className="gap-1"><AlertCircle className="h-3 w-3" /> Piper</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {capabilities?.hasFFmpeg ? (
                <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> FFmpeg</Badge>
              ) : (
                <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> FFmpeg</Badge>
              )}
            </div>
          </div>

          {/* Installed Whisper Models */}
          {capabilities && capabilities.installedWhisperModels.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground">Local Whisper Models (offline speech-to-text)</Label>
              <div className="flex gap-1 mt-1 flex-wrap">
                {capabilities.installedWhisperModels.map((m) => (
                  <Badge key={m} variant="outline" className="text-xs">{m}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Installed Piper Models */}
          {capabilities && capabilities.installedPiperModels.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground">Local Piper Voices (offline text-to-speech)</Label>
              <div className="flex gap-1 mt-1 flex-wrap">
                {capabilities.installedPiperModels.map((m) => (
                  <Badge key={m} variant="outline" className="text-xs">{m}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ElevenLabs Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-4 w-4" />
            ElevenLabs (Cloud TTS)
          </CardTitle>
          <CardDescription>High-quality cloud voices via ElevenLabs API</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="Enter ElevenLabs API key..."
              value={elevenlabsKey}
              onChange={(e) => setElevenlabsKey(e.target.value)}
            />
            <Button onClick={loadVoices} disabled={!elevenlabsKey.trim() || loadingVoices}>
              {loadingVoices ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load Voices"}
            </Button>
          </div>

          {elevenlabsVoices.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                Available Voices ({elevenlabsVoices.length})
              </Label>
              <ScrollArea className="h-[200px] border rounded-md p-2">
                <div className="space-y-1">
                  {elevenlabsVoices.map((voice) => (
                    <div
                      key={voice.voice_id}
                      className="flex items-center justify-between p-2 rounded hover:bg-muted/50 text-sm"
                    >
                      <div>
                        <span className="font-medium">{voice.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{voice.category}</span>
                      </div>
                      {voice.preview_url && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const audio = new Audio(voice.preview_url);
                            audio.play().catch(() => {});
                          }}
                        >
                          <Volume2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test TTS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Volume2 className="h-4 w-4" />
            Test Local Voice
          </CardTitle>
          <CardDescription>Try your local Piper TTS and Whisper microphone input</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            placeholder="Type text to speak locally..."
            rows={2}
          />
          <div className="flex gap-2">
            <Button
              onClick={() => handleTestTTS("current")}
              disabled={speaking || !testText.trim()}
            >
              {speaking ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Speaking...</>
              ) : (
                <><Volume2 className="h-4 w-4 mr-2" /> Speak (Local TTS)</>
              )}
            </Button>
            <VoiceInputButton
              size="default"
              showSettings={true}
              onTranscription={(text) => toast.info(`🎤 Local Whisper: ${text}`)}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// STATS PANEL
// =============================================================================

function StatsPanel() {
  const { stats } = useCNSStatus();

  if (!stats) return null;

  const localPercentage = stats.totalRequests > 0
    ? (stats.localRequests / stats.totalRequests) * 100
    : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Total</span>
          </div>
          <p className="text-2xl font-bold mt-1">{stats.totalRequests}</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-green-500" />
            <span className="text-sm text-muted-foreground">Local</span>
          </div>
          <p className="text-2xl font-bold mt-1">{stats.localRequests}</p>
          <Progress value={localPercentage} className="h-1 mt-2" />
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-blue-500" />
            <span className="text-sm text-muted-foreground">Cloud</span>
          </div>
          <p className="text-2xl font-bold mt-1">{stats.cloudRequests}</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-purple-500" />
            <span className="text-sm text-muted-foreground">Workflows</span>
          </div>
          <p className="text-2xl font-bold mt-1">{stats.workflowsTriggered}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// MAIN DASHBOARD COMPONENT
// =============================================================================

export function CNSDashboard({ className, compact = false }: CNSDashboardProps) {
  const { 
    isInitialized, 
    initialize, 
    shutdown,
    isInitializing,
    ollamaAvailable,
    n8nConnected,
    stats
  } = useCNSStatus();
  
  const { connections } = useN8nConnections();
  const [activeTab, setActiveTab] = useState("overview");

  const handleInitialize = async () => {
    try {
      await initialize({});
      toast.success("CNS initialized");
    } catch {
      toast.error("Failed to initialize CNS");
    }
  };

  const handleShutdown = async () => {
    try {
      await shutdown();
      toast.success("CNS shut down");
    } catch {
      toast.error("Failed to shut down CNS");
    }
  };

  if (compact) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">OpenClaw CNS</CardTitle>
            </div>
            <Badge variant={isInitialized ? "default" : "secondary"}>
              {isInitialized ? "Active" : "Inactive"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <StatusIndicator 
              status={ollamaAvailable ? "connected" : "disconnected"} 
              label="Ollama" 
            />
            <StatusIndicator 
              status={n8nConnected ? "connected" : "disconnected"} 
              label="n8n" 
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-primary/20 to-purple-500/20">
                <Brain className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  OpenClaw CNS
                  <Badge variant="outline">🦞</Badge>
                </CardTitle>
                <CardDescription>
                  Central Nervous System • Ollama + n8n Integration
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!isInitialized ? (
                <Button onClick={handleInitialize} disabled={isInitializing}>
                  {isInitializing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Initialize
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={handleShutdown}>
                    <Square className="h-4 w-4 mr-2" />
                    Shutdown
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        
        {isInitialized && (
          <CardContent>
            <div className="flex items-center gap-6">
              <StatusIndicator 
                status={ollamaAvailable ? "connected" : "disconnected"} 
                label={`Ollama ${ollamaAvailable ? "(Ready)" : "(Offline)"}`} 
              />
              <StatusIndicator 
                status={n8nConnected ? "connected" : "disconnected"} 
                label={`n8n (${connections.length} connections)`} 
              />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Activity className="h-4 w-4" />
                {stats?.totalRequests || 0} requests
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Stats */}
      {isInitialized && <StatsPanel />}

      {/* Fallback chat — works even when CNS / portal isn't running, by routing
          through the OpenClaw gateway. */}
      {!isInitialized && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Chat (OpenClaw fallback)
            </CardTitle>
            <CardDescription>
              CNS isn't initialized yet — using the OpenClaw gateway so you can still chat.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ChatPanel />
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      {isInitialized && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">
              <Gauge className="h-4 w-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="chat">
              <MessageSquare className="h-4 w-4 mr-2" />
              Chat
            </TabsTrigger>
            <TabsTrigger value="voice">
              <Mic className="h-4 w-4 mr-2" />
              Voice
            </TabsTrigger>
            <TabsTrigger value="ollama">
              <Cpu className="h-4 w-4 mr-2" />
              Ollama
            </TabsTrigger>
            <TabsTrigger value="n8n">
              <Workflow className="h-4 w-4 mr-2" />
              n8n
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Cpu className="h-4 w-4" />
                    Local AI (Ollama)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <OllamaPanel />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Workflow className="h-4 w-4" />
                    Automation (n8n)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <N8nPanel />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="chat" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Chat with CNS
                </CardTitle>
                <CardDescription>
                  Chat with the AI using local (Ollama) or cloud models
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ChatPanel />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="voice" className="mt-4">
            <VoicePanel />
          </TabsContent>

          <TabsContent value="ollama" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Cpu className="h-4 w-4" />
                  Ollama Configuration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <OllamaPanel />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="n8n" className="mt-4">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Cable className="h-4 w-4" />
                    Connections
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <N8nPanel />
                </CardContent>
              </Card>

              {connections.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Workflow className="h-4 w-4" />
                      Workflows
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <N8nWorkflowsPanel connectionId={connections[0]?.id} />
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

export default CNSDashboard;
