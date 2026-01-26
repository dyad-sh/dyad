import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArrowLeft,
  Search,
  Plus,
  Star,
  ExternalLink,
  Github,
  CheckCircle2,
  Loader2,
  Server,
  Zap,
  Shield,
  Globe,
  Database,
  Cloud,
  Code2,
  FileText,
  MessageSquare,
  BarChart3,
  Settings,
  Sparkles,
  Plug,
} from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { useMcp } from "@/hooks/useMcp";
import { showError, showSuccess } from "@/lib/toast";
import {
  MCP_SERVER_REGISTRY,
  MCP_CATEGORIES,
  type McpServerRegistryEntry,
  type McpServerCategory,
  getFeaturedServers,
  getServersByCategory,
  searchServers,
} from "@/data/mcp_server_registry";

// Icon mapping for categories
const categoryIcons: Record<McpServerCategory, React.ReactNode> = {
  featured: <Star className="h-4 w-4" />,
  "ai-assistants": <Sparkles className="h-4 w-4" />,
  development: <Code2 className="h-4 w-4" />,
  "code-platforms": <Server className="h-4 w-4" />,
  databases: <Database className="h-4 w-4" />,
  "cloud-services": <Cloud className="h-4 w-4" />,
  deployment: <Zap className="h-4 w-4" />,
  "browser-automation": <Globe className="h-4 w-4" />,
  analytics: <BarChart3 className="h-4 w-4" />,
  documentation: <FileText className="h-4 w-4" />,
  productivity: <Settings className="h-4 w-4" />,
  "data-processing": <Database className="h-4 w-4" />,
  communication: <MessageSquare className="h-4 w-4" />,
  other: <Plug className="h-4 w-4" />,
};

interface InstallDialogState {
  isOpen: boolean;
  server: McpServerRegistryEntry | null;
  envValues: Record<string, string>;
  isInstalling: boolean;
}

const McpHubPage: React.FC = () => {
  const router = useRouter();
  const { servers: installedServers, createServer } = useMcp();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<McpServerCategory>("featured");
  const [installDialog, setInstallDialog] = useState<InstallDialogState>({
    isOpen: false,
    server: null,
    envValues: {},
    isInstalling: false,
  });

  // Get installed server IDs for checking
  const installedServerIds = useMemo(() => {
    return new Set(installedServers?.map((s) => s.name.toLowerCase()) ?? []);
  }, [installedServers]);

  // Filter servers based on search or category
  const displayedServers = useMemo(() => {
    if (searchQuery.trim()) {
      return searchServers(searchQuery);
    }
    return getServersByCategory(selectedCategory);
  }, [searchQuery, selectedCategory]);

  const featuredServers = useMemo(() => getFeaturedServers(), []);

  const handleInstallClick = (server: McpServerRegistryEntry) => {
    // Initialize env values from required env vars
    const envValues: Record<string, string> = {};
    server.envVars?.forEach((envVar) => {
      envValues[envVar.key] = "";
    });

    setInstallDialog({
      isOpen: true,
      server,
      envValues,
      isInstalling: false,
    });
  };

  const handleInstall = async () => {
    const { server, envValues } = installDialog;
    if (!server) return;

    // Validate required env vars
    const missingVars = server.envVars?.filter(
      (v) => v.required && !envValues[v.key]?.trim()
    );
    if (missingVars && missingVars.length > 0) {
      showError(`Missing required: ${missingVars.map((v) => v.key).join(", ")}`);
      return;
    }

    setInstallDialog((prev) => ({ ...prev, isInstalling: true }));

    try {
      // Parse command and args
      const config = server.config;
      let command: string | null = null;
      let args: string[] | null = null;
      let url: string | null = null;

      if (config.type === "stdio" && config.command) {
        const parts = config.command.split(" ");
        command = parts[0];
        args = parts.slice(1);
      } else if (config.type === "http" && config.url) {
        url = config.url;
      }

      // Build env object
      const envJson =
        Object.keys(envValues).length > 0
          ? { ...config.env, ...envValues }
          : config.env || null;

      await createServer({
        name: server.name,
        transport: config.type,
        command,
        args,
        url,
        envJson: envJson && Object.keys(envJson).length > 0 ? envJson : null,
        enabled: true,
      });

      showSuccess(`${server.name} MCP server installed successfully!`);
      setInstallDialog({
        isOpen: false,
        server: null,
        envValues: {},
        isInstalling: false,
      });
    } catch (error) {
      showError(`Failed to install: ${error instanceof Error ? error.message : "Unknown error"}`);
      setInstallDialog((prev) => ({ ...prev, isInstalling: false }));
    }
  };

  const isServerInstalled = (server: McpServerRegistryEntry) => {
    return installedServerIds.has(server.name.toLowerCase());
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button
                onClick={() => router.history.back()}
                variant="ghost"
                size="icon"
                className="shrink-0"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <Plug className="h-6 w-6 text-primary" />
                  MCP Hub
                </h1>
                <p className="text-sm text-muted-foreground">
                  Install powerful MCP servers to extend JoyCreate's capabilities
                </p>
              </div>
            </div>

            {/* Search */}
            <div className="relative w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search MCP servers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Featured Section (only when not searching) */}
        {!searchQuery.trim() && selectedCategory === "featured" && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
              <h2 className="text-xl font-semibold">Featured Servers</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {featuredServers.map((server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  isInstalled={isServerInstalled(server)}
                  onInstall={() => handleInstallClick(server)}
                  featured
                />
              ))}
            </div>
          </section>
        )}

        {/* Category Tabs */}
        <Tabs
          value={selectedCategory}
          onValueChange={(v) => setSelectedCategory(v as McpServerCategory)}
          className="w-full"
        >
          <TabsList className="w-full h-auto flex-wrap gap-1 bg-transparent p-0 mb-6">
            {MCP_CATEGORIES.map((category) => (
              <TabsTrigger
                key={category.id}
                value={category.id}
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 px-3 py-1.5 rounded-full border"
              >
                {categoryIcons[category.id]}
                <span>{category.name}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Search Results or Category Content */}
          {searchQuery.trim() ? (
            <div>
              <p className="text-sm text-muted-foreground mb-4">
                {displayedServers.length} server{displayedServers.length !== 1 ? "s" : ""} found for "{searchQuery}"
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayedServers.map((server) => (
                  <ServerCard
                    key={server.id}
                    server={server}
                    isInstalled={isServerInstalled(server)}
                    onInstall={() => handleInstallClick(server)}
                  />
                ))}
              </div>
              {displayedServers.length === 0 && (
                <div className="text-center py-12">
                  <Search className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">No servers found matching your search.</p>
                </div>
              )}
            </div>
          ) : (
            MCP_CATEGORIES.map((category) => (
              <TabsContent key={category.id} value={category.id} className="mt-0">
                {category.id !== "featured" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {getServersByCategory(category.id).map((server) => (
                      <ServerCard
                        key={server.id}
                        server={server}
                        isInstalled={isServerInstalled(server)}
                        onInstall={() => handleInstallClick(server)}
                      />
                    ))}
                  </div>
                )}
                {category.id !== "featured" && getServersByCategory(category.id).length === 0 && (
                  <div className="text-center py-12">
                    <Server className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">No servers in this category yet.</p>
                  </div>
                )}
              </TabsContent>
            ))
          )}
        </Tabs>
      </div>

      {/* Install Dialog */}
      <Dialog
        open={installDialog.isOpen}
        onOpenChange={(open) => {
          if (!open && !installDialog.isInstalling) {
            setInstallDialog({
              isOpen: false,
              server: null,
              envValues: {},
              isInstalling: false,
            });
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" />
              Install {installDialog.server?.name}
            </DialogTitle>
            <DialogDescription>
              {installDialog.server?.description}
            </DialogDescription>
          </DialogHeader>

          {installDialog.server?.envVars && installDialog.server.envVars.length > 0 && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" />
                <span>This server requires authentication</span>
              </div>
              {installDialog.server.envVars.map((envVar) => (
                <div key={envVar.key} className="space-y-2">
                  <Label htmlFor={envVar.key} className="flex items-center gap-1">
                    {envVar.key}
                    {envVar.required && <span className="text-red-500">*</span>}
                  </Label>
                  <Input
                    id={envVar.key}
                    type="password"
                    placeholder={envVar.placeholder || `Enter ${envVar.key}`}
                    value={installDialog.envValues[envVar.key] || ""}
                    onChange={(e) =>
                      setInstallDialog((prev) => ({
                        ...prev,
                        envValues: {
                          ...prev.envValues,
                          [envVar.key]: e.target.value,
                        },
                      }))
                    }
                    disabled={installDialog.isInstalling}
                  />
                  {envVar.description && (
                    <p className="text-xs text-muted-foreground">{envVar.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {!installDialog.server?.envVars?.length && (
            <div className="py-4">
              <p className="text-sm text-muted-foreground">
                This server doesn't require any configuration. Click install to add it to JoyCreate.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setInstallDialog({
                  isOpen: false,
                  server: null,
                  envValues: {},
                  isInstalling: false,
                })
              }
              disabled={installDialog.isInstalling}
            >
              Cancel
            </Button>
            <Button onClick={handleInstall} disabled={installDialog.isInstalling}>
              {installDialog.isInstalling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Install
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

interface ServerCardProps {
  server: McpServerRegistryEntry;
  isInstalled: boolean;
  onInstall: () => void;
  featured?: boolean;
}

const ServerCard: React.FC<ServerCardProps> = ({
  server,
  isInstalled,
  onInstall,
  featured,
}) => {
  return (
    <Card
      className={`relative overflow-hidden transition-all hover:shadow-md ${
        featured
          ? "border-primary/30 bg-gradient-to-br from-primary/5 via-transparent to-transparent"
          : ""
      }`}
    >
      {featured && (
        <div className="absolute top-2 right-2">
          <Badge variant="secondary" className="gap-1 bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
            <Star className="h-3 w-3 fill-current" />
            Featured
          </Badge>
        </div>
      )}
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          {server.name}
          {isInstalled && (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          )}
        </CardTitle>
        <CardDescription className="line-clamp-2">{server.description}</CardDescription>
      </CardHeader>
      <CardContent className="pb-2">
        <div className="flex flex-wrap gap-1">
          {server.tags?.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
          {server.requiresAuth && (
            <Badge variant="outline" className="text-xs gap-1">
              <Shield className="h-3 w-3" />
              Auth
            </Badge>
          )}
        </div>
      </CardContent>
      <CardFooter className="pt-2 gap-2">
        {isInstalled ? (
          <Button variant="secondary" className="flex-1" disabled>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Installed
          </Button>
        ) : (
          <Button onClick={onInstall} className="flex-1">
            <Plus className="h-4 w-4 mr-2" />
            Add to JoyCreate
          </Button>
        )}
        <div className="flex gap-1">
          {server.website && (
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="h-9 w-9"
            >
              <a href={server.website} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
          {server.github && (
            <Button
              variant="ghost"
              size="icon"
              asChild
              className="h-9 w-9"
            >
              <a href={server.github} target="_blank" rel="noopener noreferrer">
                <Github className="h-4 w-4" />
              </a>
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
};

export default McpHubPage;
