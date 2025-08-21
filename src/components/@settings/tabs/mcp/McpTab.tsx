import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { McpServerList } from "./McpServerList";
import { useMCP } from "../../../../hooks/useMCP";
import { EXAMPLE_MCP_CONFIGS } from "../../../../atoms/mcpAtoms";
import type { McpConfig } from "../../../../lib/services/mcpSchemas";

export function McpTab() {
  const {
    settings,
    serverTools,
    isInitialized,
    error,
    isUpdatingConfig,
    isCheckingServers,
    updateSettings,
    checkServersAvailabilities,
    loadExampleConfig,
    initialize,
    refreshMCP,
    debugMCP,
  } = useMCP();

  const [configText, setConfigText] = useState("");
  const [maxLLMSteps, setMaxLLMSteps] = useState(10);

  // Initialize MCP on mount
  useEffect(() => {
    if (!isInitialized) {
      initialize();
    }
  }, [isInitialized, initialize]);

  // Update form when settings change
  useEffect(() => {
    if (settings) {
      setConfigText(JSON.stringify(settings.mcpConfig, null, 2));
      setMaxLLMSteps(settings.maxLLMSteps);
    }
  }, [settings]);

  const handleSaveConfig = async () => {
    try {
      const parsedConfig: McpConfig = JSON.parse(configText);
      const newSettings = {
        mcpConfig: parsedConfig,
        maxLLMSteps,
      };
      await updateSettings(newSettings);
    } catch (err) {
      console.error("Invalid JSON configuration:", err);
    }
  };

  const handleLoadExample = (configName: keyof typeof EXAMPLE_MCP_CONFIGS) => {
    loadExampleConfig(configName);
  };

  const handleRefresh = () => {
    checkServersAvailabilities();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>MCP Servers Configuration</CardTitle>
          <p className="text-sm text-muted-foreground">
            Configure Model Context Protocol (MCP) servers to extend AI capabilities with external tools and services. 
            MCP tools are automatically loaded on startup from your Cursor configuration and are available in chat.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="config">MCP Configuration (JSON)</Label>
            <Textarea
              id="config"
              placeholder="Enter your MCP server configuration..."
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              className="min-h-[200px] font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxSteps">Maximum LLM Steps</Label>
            <Input
              id="maxSteps"
              type="number"
              min="1"
              max="50"
              value={maxLLMSteps}
              onChange={(e) => setMaxLLMSteps(parseInt(e.target.value) || 10)}
            />
            <p className="text-xs text-muted-foreground">
              Maximum number of tool execution steps per conversation turn.
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSaveConfig} disabled={isUpdatingConfig}>
              {isUpdatingConfig ? "Saving..." : "Save Configuration"}
            </Button>
            <Button onClick={handleRefresh} disabled={isCheckingServers} variant="outline">
              {isCheckingServers ? "Checking..." : "Check Servers"}
            </Button>
            <Button onClick={refreshMCP} disabled={isUpdatingConfig} variant="outline">
              {isUpdatingConfig ? "Refreshing..." : "Refresh MCP"}
            </Button>
            <Button onClick={debugMCP} variant="outline">
              Debug MCP
            </Button>
          </div>

          {/* MCP Status Information */}
          <div className="space-y-2">
            <Label>MCP Status</Label>
            <div className="text-sm space-y-1">
              <div className="flex items-center gap-2">
                <span>Status:</span>
                <span className={`px-2 py-1 rounded text-xs ${
                  isInitialized ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {isInitialized ? 'Initialized' : 'Not Initialized'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span>Available Servers:</span>
                <span className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-800">
                  {Object.keys(serverTools).length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span>Total Tools:</span>
                <span className="px-2 py-1 rounded text-xs bg-purple-100 text-purple-800">
                  {Object.values(serverTools).reduce((total, server) => total + (server.tools?.length || 0), 0)}
                </span>
              </div>
              {error && (
                <div className="text-red-600 text-xs">
                  Error: {error}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Example Configurations</CardTitle>
          <p className="text-sm text-muted-foreground">
            Load pre-configured examples to get started quickly.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleLoadExample('everything')}
            >
              Everything Server
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleLoadExample('filesystem')}
            >
              Filesystem Server
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleLoadExample('deepwiki')}
            >
              DeepWiki Server
            </Button>
          </div>
        </CardContent>
      </Card>

      <Separator />

      <McpServerList
        serverTools={serverTools}
        onRefresh={handleRefresh}
        isRefreshing={isCheckingServers}
      />

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="text-sm text-destructive">
              <strong>Error:</strong> {error}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
