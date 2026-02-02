/**
 * Studio AI Panel - Reusable AI panel for integration across all studios
 * 
 * Provides a unified interface for Claude Code + Ollama powered AI features
 * in Data Studio, Document Studio, Asset Studio, Agent Swarms, and Dataset Studio
 */

import { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Sparkles,
  Cpu,
  Cloud,
  Code,
  FileText,
  Database,
  Bot,
  Wand2,
  Settings,
  Play,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Shield,
  Zap,
  BookOpen,
} from "lucide-react";

import {
  useStudioAIConfig,
  useStudioAIStats,
  useDataGeneration,
  useDocumentGeneration,
  useCodeGeneration,
  useSchemaGeneration,
  useAgentSwarmAI,
  useDatasetGeneration,
  useStudioAIChat,
} from "@/hooks/useStudioAI";

// ============================================================================
// Types
// ============================================================================

export type StudioType = "data" | "document" | "asset" | "swarm" | "dataset";

interface StudioAIPanelProps {
  studioType: StudioType;
  context?: Record<string, unknown>;
  onResult?: (result: unknown) => void;
  className?: string;
}

// ============================================================================
// Quick Chat Panel
// ============================================================================

function QuickChatPanel() {
  const [message, setMessage] = useState("");
  const { messages, sendMessage, isLoading, clearMessages } = useStudioAIChat();

  const handleSend = () => {
    if (!message.trim()) return;
    sendMessage({ message, preferLocal: true });
    setMessage("");
  };

  return (
    <div className="space-y-3">
      <ScrollArea className="h-[200px] border rounded-md p-3">
        {messages.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">
            Start a conversation with your local AI
          </p>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`rounded-lg px-3 py-2 max-w-[80%] text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="flex gap-2">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask your AI assistant..."
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          disabled={isLoading}
        />
        <Button onClick={handleSend} disabled={isLoading || !message.trim()}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        </Button>
        {messages.length > 0 && (
          <Button variant="outline" onClick={clearMessages}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Config Panel
// ============================================================================

function ConfigPanel() {
  const { config, setPreferLocal, setUseClaudeCode, isLoading } = useStudioAIConfig();
  const { stats, localPercentage } = useStudioAIStats();

  if (isLoading || !config) {
    return <div className="p-4 text-center text-muted-foreground">Loading config...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Privacy Mode (Local First)
          </Label>
          <p className="text-xs text-muted-foreground">
            Prefer Ollama for all operations
          </p>
        </div>
        <Switch
          checked={config.privacyMode}
          onCheckedChange={setPreferLocal}
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="flex items-center gap-2">
            <Code className="h-4 w-4" />
            Use Claude Code
          </Label>
          <p className="text-xs text-muted-foreground">
            Enable agentic coding features
          </p>
        </div>
        <Switch
          checked={config.useClaudeCode}
          onCheckedChange={setUseClaudeCode}
        />
      </div>

      {stats && (
        <div className="pt-4 border-t space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Local Processing</span>
            <span className="font-medium">{localPercentage}%</span>
          </div>
          <Progress value={localPercentage} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{stats.ollamaRequests} Ollama</span>
            <span>{stats.anthropicRequests} Cloud</span>
            <span>{stats.claudeCodeTasks} Claude Code</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Data Generation Panel
// ============================================================================

function DataGenerationPanel({ onResult }: { onResult?: (result: unknown) => void }) {
  const [schema, setSchema] = useState("{}");
  const [count, setCount] = useState(10);
  const { generateItems, isGenerating, generatedItems } = useDataGeneration();

  const handleGenerate = () => {
    try {
      const parsedSchema = JSON.parse(schema);
      generateItems(
        { schema: parsedSchema, count },
        { onSuccess: (data) => onResult?.(data) }
      );
    } catch (e) {
      console.error("Invalid schema JSON");
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>JSON Schema</Label>
        <Textarea
          value={schema}
          onChange={(e) => setSchema(e.target.value)}
          placeholder='{"name": "string", "age": "number", "email": "string"}'
          rows={4}
          className="font-mono text-sm"
        />
      </div>

      <div className="flex items-center gap-4">
        <div className="space-y-2">
          <Label>Count</Label>
          <Input
            type="number"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            min={1}
            max={1000}
            className="w-24"
          />
        </div>

        <Button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="mt-auto"
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 mr-2" />
          )}
          Generate
        </Button>
      </div>

      {generatedItems && (
        <div className="border rounded-md p-3">
          <Badge variant="outline" className="mb-2">
            {generatedItems.length} items generated
          </Badge>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Document Generation Panel
// ============================================================================

function DocumentGenerationPanel({ onResult }: { onResult?: (result: unknown) => void }) {
  const [docType, setDocType] = useState<"report" | "article" | "email" | "presentation">("article");
  const [description, setDescription] = useState("");
  const { generateDocument, isGenerating, generatedDocument } = useDocumentGeneration();

  const handleGenerate = () => {
    if (!description.trim()) return;
    generateDocument(
      { type: docType, description },
      { onSuccess: (data) => onResult?.(data) }
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Document Type</Label>
        <Select value={docType} onValueChange={(v: typeof docType) => setDocType(v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="article">Article</SelectItem>
            <SelectItem value="report">Report</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="presentation">Presentation</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the document you want to generate..."
          rows={3}
        />
      </div>

      <Button onClick={handleGenerate} disabled={isGenerating || !description.trim()}>
        {isGenerating ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <FileText className="h-4 w-4 mr-2" />
        )}
        Generate Document
      </Button>

      {generatedDocument && (
        <div className="border rounded-md p-3">
          <Badge variant="outline" className="mb-2">Document Generated</Badge>
          <ScrollArea className="h-[150px]">
            <pre className="text-sm whitespace-pre-wrap">{generatedDocument.content}</pre>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Code Generation Panel
// ============================================================================

function CodeGenerationPanel({ onResult }: { onResult?: (result: unknown) => void }) {
  const [language, setLanguage] = useState("typescript");
  const [description, setDescription] = useState("");
  const [includeTests, setIncludeTests] = useState(false);
  const { generateCode, isGenerating, generatedCode } = useCodeGeneration();

  const handleGenerate = () => {
    if (!description.trim()) return;
    generateCode(
      { language, description, includeTests },
      { onSuccess: (data) => onResult?.(data) }
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Language</Label>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="typescript">TypeScript</SelectItem>
              <SelectItem value="python">Python</SelectItem>
              <SelectItem value="javascript">JavaScript</SelectItem>
              <SelectItem value="rust">Rust</SelectItem>
              <SelectItem value="go">Go</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex items-center gap-2">
            <Switch checked={includeTests} onCheckedChange={setIncludeTests} />
            <Label>Include Tests</Label>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the code you want to generate..."
          rows={3}
        />
      </div>

      <Button onClick={handleGenerate} disabled={isGenerating || !description.trim()}>
        {isGenerating ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Code className="h-4 w-4 mr-2" />
        )}
        Generate Code
      </Button>

      {generatedCode && (
        <div className="border rounded-md p-3">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline">{language}</Badge>
            <Badge variant="secondary">Claude Code</Badge>
          </div>
          <ScrollArea className="h-[200px]">
            <pre className="text-sm font-mono">{generatedCode}</pre>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Agent Swarm Panel
// ============================================================================

function AgentSwarmPanel({ onResult }: { onResult?: (result: unknown) => void }) {
  const [role, setRole] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [objectives, setObjectives] = useState("");
  const { generateConfig, isGeneratingConfig, generatedConfig } = useAgentSwarmAI();

  const handleGenerate = () => {
    if (!role.trim() || !capabilities.trim() || !objectives.trim()) return;
    generateConfig(
      {
        role,
        capabilities: capabilities.split(",").map((c) => c.trim()),
        objectives: objectives.split(",").map((o) => o.trim()),
      },
      { onSuccess: (data) => onResult?.(data) }
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Agent Role</Label>
        <Input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="e.g., Data Analyst, Code Reviewer, Research Assistant"
        />
      </div>

      <div className="space-y-2">
        <Label>Capabilities (comma-separated)</Label>
        <Textarea
          value={capabilities}
          onChange={(e) => setCapabilities(e.target.value)}
          placeholder="data analysis, report generation, pattern recognition"
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label>Objectives (comma-separated)</Label>
        <Textarea
          value={objectives}
          onChange={(e) => setObjectives(e.target.value)}
          placeholder="analyze datasets, identify trends, generate insights"
          rows={2}
        />
      </div>

      <Button onClick={handleGenerate} disabled={isGeneratingConfig}>
        {isGeneratingConfig ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Bot className="h-4 w-4 mr-2" />
        )}
        Generate Agent Config
      </Button>

      {generatedConfig && (
        <div className="border rounded-md p-3">
          <Badge variant="outline" className="mb-2">Agent Configuration Generated</Badge>
          <ScrollArea className="h-[150px]">
            <pre className="text-sm font-mono">
              {JSON.stringify(generatedConfig, null, 2)}
            </pre>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Dataset Generation Panel
// ============================================================================

function DatasetGenerationPanel({ onResult }: { onResult?: (result: unknown) => void }) {
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(10);
  const [dataType, setDataType] = useState<"qa" | "conversation" | "classification">("qa");
  const { generateQA, isGeneratingQA, qaPairs, generateConversations, isGeneratingConversations } = useDatasetGeneration();

  const handleGenerate = () => {
    if (!topic.trim()) return;
    
    if (dataType === "qa") {
      generateQA(
        { topic, count },
        { onSuccess: (data) => onResult?.(data) }
      );
    } else if (dataType === "conversation") {
      generateConversations(
        { scenario: topic, turns: count },
        { onSuccess: (data) => onResult?.(data) }
      );
    }
  };

  const isGenerating = isGeneratingQA || isGeneratingConversations;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Dataset Type</Label>
        <Select value={dataType} onValueChange={(v: typeof dataType) => setDataType(v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="qa">Q&A Pairs</SelectItem>
            <SelectItem value="conversation">Conversations</SelectItem>
            <SelectItem value="classification">Classification</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Topic / Scenario</Label>
        <Input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g., Machine learning basics, Customer support..."
        />
      </div>

      <div className="space-y-2">
        <Label>{dataType === "conversation" ? "Turns" : "Count"}</Label>
        <Input
          type="number"
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          min={1}
          max={100}
          className="w-24"
        />
      </div>

      <Button onClick={handleGenerate} disabled={isGenerating || !topic.trim()}>
        {isGenerating ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Database className="h-4 w-4 mr-2" />
        )}
        Generate Dataset
      </Button>

      {qaPairs && (
        <div className="border rounded-md p-3">
          <Badge variant="outline" className="mb-2">
            {(qaPairs as any).pairs?.length || (qaPairs as any).data?.length || 0} Q&A pairs generated
          </Badge>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function StudioAIPanel({ studioType, context, onResult, className }: StudioAIPanelProps) {
  const { stats } = useStudioAIStats();
  
  const getIcon = () => {
    switch (studioType) {
      case "data": return <Database className="h-5 w-5" />;
      case "document": return <FileText className="h-5 w-5" />;
      case "asset": return <Code className="h-5 w-5" />;
      case "swarm": return <Bot className="h-5 w-5" />;
      case "dataset": return <BookOpen className="h-5 w-5" />;
    }
  };

  const getTitle = () => {
    switch (studioType) {
      case "data": return "Data Studio AI";
      case "document": return "Document Studio AI";
      case "asset": return "Asset Studio AI";
      case "swarm": return "Agent Swarm AI";
      case "dataset": return "Dataset Studio AI";
    }
  };

  const renderPanel = () => {
    switch (studioType) {
      case "data":
        return <DataGenerationPanel onResult={onResult} />;
      case "document":
        return <DocumentGenerationPanel onResult={onResult} />;
      case "asset":
        return <CodeGenerationPanel onResult={onResult} />;
      case "swarm":
        return <AgentSwarmPanel onResult={onResult} />;
      case "dataset":
        return <DatasetGenerationPanel onResult={onResult} />;
    }
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getIcon()}
            <CardTitle className="text-base">{getTitle()}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {stats && (
              <Badge variant="outline" className="text-xs">
                <Cpu className="h-3 w-3 mr-1" />
                {stats.ollamaRequests} local
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs">
              <Sparkles className="h-3 w-3 mr-1" />
              Claude Code + Ollama
            </Badge>
          </div>
        </div>
        <CardDescription>
          AI-powered features using local Ollama and Claude Code
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-0">
        <Accordion type="single" collapsible defaultValue="generation">
          <AccordionItem value="generation">
            <AccordionTrigger className="text-sm">
              <span className="flex items-center gap-2">
                <Wand2 className="h-4 w-4" />
                Generate
              </span>
            </AccordionTrigger>
            <AccordionContent className="pt-3">
              {renderPanel()}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="chat">
            <AccordionTrigger className="text-sm">
              <span className="flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Quick Chat
              </span>
            </AccordionTrigger>
            <AccordionContent className="pt-3">
              <QuickChatPanel />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="settings">
            <AccordionTrigger className="text-sm">
              <span className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </span>
            </AccordionTrigger>
            <AccordionContent className="pt-3">
              <ConfigPanel />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Compact Variant
// ============================================================================

export function StudioAIQuickBar({ 
  onResult,
  className,
}: { 
  onResult?: (result: unknown) => void;
  className?: string;
}) {
  const { config } = useStudioAIConfig();
  const { sendMessageAsync, isLoading } = useStudioAIChat();
  const [prompt, setPrompt] = useState("");

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    const result = await sendMessageAsync({ message: prompt, preferLocal: config?.privacyMode });
    onResult?.(result);
    setPrompt("");
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {config?.privacyMode ? (
          <><Cpu className="h-3 w-3" /> Local</>
        ) : (
          <><Cloud className="h-3 w-3" /> Cloud</>
        )}
      </div>
      <Input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ask AI..."
        className="flex-1"
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        disabled={isLoading}
      />
      <Button size="sm" onClick={handleSubmit} disabled={isLoading || !prompt.trim()}>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}

// ============================================================================
// Status Badge
// ============================================================================

export function StudioAIStatus() {
  const { stats, localPercentage } = useStudioAIStats();
  const { config } = useStudioAIConfig();

  if (!stats) return null;

  return (
    <div className="flex items-center gap-2 text-xs">
      <Badge variant={config?.privacyMode ? "default" : "secondary"}>
        {config?.privacyMode ? (
          <><Shield className="h-3 w-3 mr-1" /> Privacy Mode</>
        ) : (
          <><Cloud className="h-3 w-3 mr-1" /> Cloud Mode</>
        )}
      </Badge>
      <span className="text-muted-foreground">
        {localPercentage}% local • {stats.totalRequests} requests
      </span>
    </div>
  );
}
