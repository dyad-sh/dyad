import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { McpStatusBadge } from "./McpStatusBadge";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import type { MCPServerTools } from "../../../../lib/services/mcpSchemas";

interface McpServerListItemProps {
  serverName: string;
  serverData: {
    status: 'checking' | 'available' | 'unavailable';
    tools: any[];
    error?: string;
  };
}

export function McpServerListItem({ serverName, serverData }: McpServerListItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{serverName}</CardTitle>
          <McpStatusBadge status={serverData.status} />
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{serverData.tools.length} tools available</span>
          {serverData.error && (
            <Badge variant="destructive" className="text-xs">
              Error
            </Badge>
          )}
        </div>

        {serverData.error && (
          <div className="p-2 bg-destructive/10 border border-destructive/20 rounded-md">
            <p className="text-xs text-destructive">{serverData.error}</p>
          </div>
        )}

        {serverData.tools.length > 0 && (
          <div className="space-y-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between p-0"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              <span className="text-sm">View Tools</span>
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
            {isExpanded && (
              <div className="space-y-2 mt-2">
                {serverData.tools.slice(0, 3).map((tool, index) => (
                  <div key={index} className="p-2 border rounded-md bg-muted/50">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 mt-0.5 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium">{tool.name}</h4>
                        {tool.description && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {tool.description}
                          </p>
                        )}
                        {tool.inputSchema?.properties && (
                          <div className="mt-2">
                            <p className="text-xs font-medium text-muted-foreground">Parameters:</p>
                            <div className="mt-1 space-y-1">
                              {Object.entries(tool.inputSchema.properties).slice(0, 2).map(([paramName, paramSchema]: [string, any]) => (
                                <div key={paramName} className="flex items-center gap-2 text-xs">
                                  <code className="text-xs bg-muted px-1 py-0.5 rounded">
                                    {paramName}
                                  </code>
                                  <span className="text-muted-foreground">
                                    {paramSchema.type}
                                    {tool.inputSchema?.required?.includes(paramName) && (
                                      <span className="text-destructive ml-1">*</span>
                                    )}
                                  </span>
                                </div>
                              ))}
                              {Object.keys(tool.inputSchema.properties).length > 2 && (
                                <p className="text-xs text-muted-foreground">
                                  ... and {Object.keys(tool.inputSchema.properties).length - 2} more parameters
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {serverData.tools.length > 3 && (
                  <p className="text-xs text-muted-foreground text-center">
                    ... and {serverData.tools.length - 3} more tools
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
