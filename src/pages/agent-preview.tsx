/**
 * Agent Preview Page
 * Renders a generated agent UI with live preview and export options.
 */

import { useState, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  Download,
  Monitor,
  Smartphone,
  Tablet,
  Code2,
  Eye,
  Palette,
  Settings,
  RefreshCw,
  Copy,
  Check,
  FileCode,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { agentBuilderClient } from "@/ipc/agent_builder_client";
import { IpcClient } from "@/ipc/ipc_client";
import { showError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useExport } from "@/hooks/use-export";
import { FileText } from "lucide-react";

import type { AgentUIConfig, AgentUILayout, GenerateAgentUIResult } from "@/types/agent_ui_types";
import { exportAgentUI } from "@/lib/agent_ui_generator";
import {
  AGENT_UI_TEMPLATES,
  UI_THEMES,
  getTemplatesForAgentType,
  getAvailableThemes,
  createConfigFromTemplate,
} from "@/constants/agent_ui_templates";

// Device presets for preview
const DEVICE_PRESETS = {
  desktop: { width: "100%", maxWidth: "1200px", height: "100%" },
  tablet: { width: "768px", maxWidth: "768px", height: "100%" },
  mobile: { width: "375px", maxWidth: "375px", height: "100%" },
} as const;

type DeviceType = keyof typeof DEVICE_PRESETS;

export default function AgentPreviewPage() {
  const navigate = useNavigate();
  const { agentId } = useParams({ from: "/agents/$agentId/preview" });
  const queryClient = useQueryClient();

  // State
  const [activeTab, setActiveTab] = useState<"preview" | "code" | "config">("preview");
  const [deviceMode, setDeviceMode] = useState<DeviceType>("desktop");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [selectedTheme, setSelectedTheme] = useState<string>("default");
  const [exportFormat, setExportFormat] = useState<"react" | "vue" | "html">("react");
  const [copiedCode, setCopiedCode] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  // Fetch agent data
  const { data: agent, isLoading: agentLoading } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => agentBuilderClient.getAgent(Number(agentId)),
    enabled: !!agentId,
  });

  const { exportToDocument, hasLibreOffice } = useExport();

  const handleExportAgentDoc = (format: "docx" | "pdf") => {
    if (!agent) return;
    const sections = [
      { type: "heading" as const, level: 1, content: agent.name },
      { type: "paragraph" as const, content: agent.description || "No description." },
      { type: "heading" as const, level: 2, content: "Configuration" },
      { type: "paragraph" as const, content: `Type: ${agent.type || "chatbot"}` },
      { type: "paragraph" as const, content: `Status: ${agent.status || "draft"}` },
      { type: "paragraph" as const, content: `Model: ${agent.modelId || "default"}` },
      { type: "paragraph" as const, content: `Temperature: ${agent.temperature ?? "N/A"}` },
      { type: "paragraph" as const, content: `Max Tokens: ${agent.maxTokens ?? "N/A"}` },
      ...(agent.systemPrompt
        ? [
            { type: "heading" as const, level: 2, content: "System Prompt" },
            { type: "paragraph" as const, content: agent.systemPrompt },
          ]
        : []),
      { type: "heading" as const, level: 2, content: "Export Info" },
      { type: "paragraph" as const, content: `Generated: ${new Date().toLocaleString()}` },
    ];
    exportToDocument.mutate({
      name: `agent-${agent.name}-docs`,
      sections,
      format,
      title: `Agent: ${agent.name}`,
      subtitle: agent.description || undefined,
    });
  };

  // Fetch generated UI for the agent
  const { data: generatedUI, isLoading: uiLoading, refetch: refetchUI } = useQuery({
    queryKey: ["agent-ui", agentId, selectedTemplate, selectedTheme],
    queryFn: async () => {
      const ipc = IpcClient.getInstance();
      return ipc.generateAgentUI({
        agentId: agentId!,
        agentType: agent?.type || "chatbot",
        templateId: selectedTemplate || undefined,
        theme: selectedTheme,
      });
    },
    enabled: !!agentId && !!agent,
  });

  // Mutation for regenerating UI
  const regenerateMutation = useMutation({
    mutationFn: async (config: { templateId?: string; theme?: string }) => {
      const ipc = IpcClient.getInstance();
      return ipc.generateAgentUI({
        agentId: agentId!,
        agentType: agent?.type || "chatbot",
        templateId: config.templateId,
        theme: config.theme,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-ui", agentId] });
      setPreviewKey((prev) => prev + 1);
      showSuccess("UI regenerated");
    },
    onError: (error: Error) => {
      showError(`Failed to regenerate: ${error.message}`);
    },
  });

  // Get available templates for this agent type
  const availableTemplates = useMemo(() => {
    if (!agent) return AGENT_UI_TEMPLATES;
    return getTemplatesForAgentType(agent.type);
  }, [agent]);

  const themes = useMemo(() => getAvailableThemes(), []);

  // Generate export code
  const exportedCode = useMemo(() => {
    if (!generatedUI) return "";
    return exportAgentUI(generatedUI, exportFormat);
  }, [generatedUI, exportFormat]);

  // Handle copy code
  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportedCode);
      setCopiedCode(true);
      showSuccess("Code copied to clipboard");
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      showError("Failed to copy code");
    }
  }, [exportedCode]);

  // Handle download code
  const handleDownloadCode = useCallback(() => {
    const extensions = { react: "tsx", vue: "vue", html: "html" };
    const ext = extensions[exportFormat];
    const filename = `agent-ui-${agent?.name || "agent"}.${ext}`;
    
    const blob = new Blob([exportedCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    
    showSuccess(`Downloaded ${filename}`);
  }, [exportedCode, exportFormat, agent?.name]);

  // Handle template change
  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplate(templateId);
    regenerateMutation.mutate({ templateId, theme: selectedTheme });
  };

  // Handle theme change
  const handleThemeChange = (theme: string) => {
    setSelectedTheme(theme);
    regenerateMutation.mutate({ templateId: selectedTemplate, theme });
  };

  // Loading state
  if (agentLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Agent not found
  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <Bot className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Agent not found</p>
        <Button variant="outline" onClick={() => navigate({ to: "/agents" })}>
          Back to Agents
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: "/agents/$agentId", params: { agentId } })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <div>
              <h1 className="font-semibold">{agent.name} UI Preview</h1>
              <p className="text-xs text-muted-foreground">{agent.type} agent</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Device selector */}
          <div className="flex items-center border rounded-md">
            <Button
              variant={deviceMode === "desktop" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-r-none"
              onClick={() => setDeviceMode("desktop")}
            >
              <Monitor className="h-4 w-4" />
            </Button>
            <Button
              variant={deviceMode === "tablet" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-none border-l"
              onClick={() => setDeviceMode("tablet")}
            >
              <Tablet className="h-4 w-4" />
            </Button>
            <Button
              variant={deviceMode === "mobile" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-l-none border-l"
              onClick={() => setDeviceMode("mobile")}
            >
              <Smartphone className="h-4 w-4" />
            </Button>
          </div>

          {/* Refresh */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchUI()}
            disabled={uiLoading}
          >
            <RefreshCw className={cn("h-4 w-4 mr-1", uiLoading && "animate-spin")} />
            Refresh
          </Button>

          {/* Export dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="default" size="sm">
                <Download className="h-4 w-4 mr-1" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { setExportFormat("react"); handleDownloadCode(); }}>
                <FileCode className="h-4 w-4 mr-2" />
                Export as React
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setExportFormat("vue"); handleDownloadCode(); }}>
                <FileCode className="h-4 w-4 mr-2" />
                Export as Vue
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setExportFormat("html"); handleDownloadCode(); }}>
                <FileCode className="h-4 w-4 mr-2" />
                Export as HTML
              </DropdownMenuItem>
              {hasLibreOffice && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleExportAgentDoc("docx")}>
                    <FileText className="h-4 w-4 mr-2" />
                    Export Documentation (DOCX)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExportAgentDoc("pdf")}>
                    <FileText className="h-4 w-4 mr-2" />
                    Export Documentation (PDF)
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r bg-card overflow-auto">
          <div className="p-4 space-y-6">
            {/* Template selector */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Template</Label>
              <Select
                value={selectedTemplate}
                onValueChange={handleTemplateChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {availableTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplate && (
                <p className="text-xs text-muted-foreground">
                  {availableTemplates.find((t) => t.id === selectedTemplate)?.description}
                </p>
              )}
            </div>

            {/* Theme selector */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Theme</Label>
              <Select value={selectedTheme} onValueChange={handleThemeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select theme" />
                </SelectTrigger>
                <SelectContent>
                  {themes.map((theme) => (
                    <SelectItem key={theme.id} value={theme.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded-full border"
                          style={{ backgroundColor: theme.colors.primary }}
                        />
                        {theme.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Generated info */}
            {generatedUI && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Generated</Label>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>{generatedUI.pages.length} page(s)</p>
                  <p>{generatedUI.components.length} component(s)</p>
                </div>
              </div>
            )}

            {/* Layout info */}
            {generatedUI && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Layout</CardTitle>
                </CardHeader>
                <CardContent>
                  <Badge variant="outline" className="capitalize">
                    {generatedUI.pages[0]?.name || "Main"}
                  </Badge>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Preview area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as typeof activeTab)}
            className="flex-1 flex flex-col"
          >
            <div className="px-4 border-b">
              <TabsList className="h-10">
                <TabsTrigger value="preview" className="gap-2">
                  <Eye className="h-4 w-4" />
                  Preview
                </TabsTrigger>
                <TabsTrigger value="code" className="gap-2">
                  <Code2 className="h-4 w-4" />
                  Code
                </TabsTrigger>
                <TabsTrigger value="config" className="gap-2">
                  <Settings className="h-4 w-4" />
                  Config
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Preview tab */}
            <TabsContent value="preview" className="flex-1 m-0 p-4 bg-muted/30">
              <div
                className="mx-auto h-full bg-background border rounded-lg shadow-sm overflow-hidden transition-all duration-300"
                style={DEVICE_PRESETS[deviceMode]}
              >
                {uiLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : generatedUI ? (
                  <AgentUIPreview
                    key={previewKey}
                    generatedUI={generatedUI}
                    theme={(themes.find((t) => t.id === selectedTheme)?.colors || UI_THEMES.default) as PreviewTheme}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-4">
                    <Bot className="h-12 w-12 text-muted-foreground" />
                    <p className="text-muted-foreground">Select a template to preview</p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Code tab */}
            <TabsContent value="code" className="flex-1 m-0 flex flex-col overflow-hidden">
              <div className="px-4 py-2 border-b flex items-center justify-between">
                <Select
                  value={exportFormat}
                  onValueChange={(v) => setExportFormat(v as typeof exportFormat)}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="react">React</SelectItem>
                    <SelectItem value="vue">Vue</SelectItem>
                    <SelectItem value="html">HTML</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={handleCopyCode}>
                  {copiedCode ? (
                    <Check className="h-4 w-4 mr-1" />
                  ) : (
                    <Copy className="h-4 w-4 mr-1" />
                  )}
                  {copiedCode ? "Copied" : "Copy"}
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <pre className="p-4 text-sm font-mono">
                  <code>{exportedCode}</code>
                </pre>
              </ScrollArea>
            </TabsContent>

            {/* Config tab */}
            <TabsContent value="config" className="flex-1 m-0 overflow-auto">
              <ScrollArea className="h-full">
                <div className="p-4">
                  {generatedUI?.pages[0] && (
                    <pre className="text-sm font-mono bg-muted p-4 rounded-lg overflow-auto">
                      {JSON.stringify(generatedUI, null, 2)}
                    </pre>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// AGENT UI PREVIEW COMPONENT
// =============================================================================

interface PreviewTheme {
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  success: string;
  warning: string;
  error: string;
  userBubble: string;
  assistantBubble: string;
}

interface AgentUIPreviewProps {
  generatedUI: GenerateAgentUIResult;
  theme: PreviewTheme;
}

function AgentUIPreview({ generatedUI, theme }: AgentUIPreviewProps) {
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    { role: "assistant", content: "Hello! How can I help you today?" },
  ]);
  const [inputValue, setInputValue] = useState("");

  // Simulated send message
  const handleSend = () => {
    if (!inputValue.trim()) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", content: inputValue },
      { role: "assistant", content: "This is a preview response. The actual agent would respond here." },
    ]);
    setInputValue("");
  };

  // Render a simplified chat preview based on the generated UI
  return (
    <div
      className="h-full flex flex-col"
      style={{
        backgroundColor: theme.background,
        color: theme.text,
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 border-b flex items-center gap-3"
        style={{ borderColor: theme.border }}
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{ backgroundColor: theme.primary }}
        >
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="font-semibold" style={{ color: theme.text }}>
            Agent Preview
          </h2>
          <p className="text-xs" style={{ color: theme.textSecondary }}>
            Online
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className="max-w-[80%] px-4 py-2 rounded-2xl"
              style={{
                backgroundColor: msg.role === "user" ? theme.userBubble : theme.assistantBubble,
                color: msg.role === "user" ? "#fff" : theme.text,
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="p-4 border-t" style={{ borderColor: theme.border }}>
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 px-4 py-2 rounded-full border focus:outline-none focus:ring-2"
            style={{
              borderColor: theme.border,
              backgroundColor: theme.surface,
              color: theme.text,
            }}
            placeholder="Type a message..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
          />
          <button
            className="px-4 py-2 rounded-full text-white font-medium"
            style={{ backgroundColor: theme.primary }}
            onClick={handleSend}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
