/**
 * Plugin Marketplace Page
 * UI for browsing, installing, and managing plugins
 */

import { useState, useMemo } from "react";
import {
  usePluginSystem,
  useInstalledPlugins,
  useRegistrySearch,
  useInstallPlugin,
  useUninstallPlugin,
  useEnablePlugin,
  useDisablePlugin,
  useUpdatePlugin,
  usePlugin,
  type InstalledPlugin,
  type PluginRegistryEntry,
  type PluginId,
} from "@/hooks/usePlugins";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Puzzle,
  Search,
  Download,
  Trash2,
  RefreshCw,
  Settings,
  Shield,
  Star,
  Package,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Loader2,
  ExternalLink,
  Upload,
  Globe,
  Code,
  Palette,
  Wrench,
  Zap,
  Database,
  Bot,
  MoreVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// =============================================================================
// CATEGORY CONFIG
// =============================================================================

const CATEGORY_CONFIG = {
  ai: { icon: <Bot className="h-4 w-4" />, label: "AI", color: "bg-purple-500/20 text-purple-600" },
  ui: { icon: <Palette className="h-4 w-4" />, label: "UI", color: "bg-pink-500/20 text-pink-600" },
  tools: { icon: <Wrench className="h-4 w-4" />, label: "Tools", color: "bg-blue-500/20 text-blue-600" },
  integrations: { icon: <Zap className="h-4 w-4" />, label: "Integrations", color: "bg-yellow-500/20 text-yellow-600" },
  themes: { icon: <Palette className="h-4 w-4" />, label: "Themes", color: "bg-green-500/20 text-green-600" },
  data: { icon: <Database className="h-4 w-4" />, label: "Data", color: "bg-cyan-500/20 text-cyan-600" },
  automation: { icon: <Zap className="h-4 w-4" />, label: "Automation", color: "bg-orange-500/20 text-orange-600" },
  other: { icon: <Package className="h-4 w-4" />, label: "Other", color: "bg-gray-500/20 text-gray-600" },
} as const;

const TRUST_CONFIG = {
  official: { icon: <Shield className="h-4 w-4" />, label: "Official", color: "bg-blue-500/20 text-blue-600" },
  verified: { icon: <CheckCircle2 className="h-4 w-4" />, label: "Verified", color: "bg-green-500/20 text-green-600" },
  community: { icon: <Globe className="h-4 w-4" />, label: "Community", color: "bg-purple-500/20 text-purple-600" },
  local: { icon: <Code className="h-4 w-4" />, label: "Local", color: "bg-yellow-500/20 text-yellow-600" },
  unknown: { icon: <AlertCircle className="h-4 w-4" />, label: "Unknown", color: "bg-gray-500/20 text-gray-600" },
} as const;

const STATUS_CONFIG = {
  installed: { icon: <Package className="h-4 w-4" />, label: "Installed", color: "bg-gray-500/20 text-gray-600" },
  enabled: { icon: <CheckCircle2 className="h-4 w-4" />, label: "Enabled", color: "bg-green-500/20 text-green-600" },
  disabled: { icon: <XCircle className="h-4 w-4" />, label: "Disabled", color: "bg-yellow-500/20 text-yellow-600" },
  error: { icon: <AlertCircle className="h-4 w-4" />, label: "Error", color: "bg-red-500/20 text-red-600" },
  updating: { icon: <Loader2 className="h-4 w-4 animate-spin" />, label: "Updating", color: "bg-blue-500/20 text-blue-600" },
} as const;

// =============================================================================
// INSTALLED PLUGIN CARD
// =============================================================================

function InstalledPluginCard({
  plugin,
  onEnable,
  onDisable,
  onUninstall,
  onUpdate,
  onConfigure,
}: {
  plugin: InstalledPlugin;
  onEnable: () => void;
  onDisable: () => void;
  onUninstall: () => void;
  onUpdate: () => void;
  onConfigure: () => void;
}) {
  const categoryConfig = CATEGORY_CONFIG[plugin.manifest.category];
  const trustConfig = TRUST_CONFIG[plugin.trust];
  const statusConfig = STATUS_CONFIG[plugin.status];
  const isEnabled = plugin.status === "enabled";

  return (
    <Card className="group relative">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
              {plugin.manifest.icon ? (
                <img src={plugin.manifest.icon} alt="" className="h-6 w-6" />
              ) : (
                <Puzzle className="h-6 w-6" />
              )}
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {plugin.manifest.name}
                <Badge variant="outline" className="text-xs">
                  v{plugin.manifest.version}
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{plugin.manifest.author}</p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onConfigure}>
                <Settings className="mr-2 h-4 w-4" />
                Configure
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onUpdate}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Check for Updates
              </DropdownMenuItem>
              {plugin.manifest.homepage && (
                <DropdownMenuItem asChild>
                  <a href={plugin.manifest.homepage} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Homepage
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onUninstall} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Uninstall
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {plugin.manifest.description}
        </p>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className={categoryConfig.color}>
            {categoryConfig.icon}
            <span className="ml-1">{categoryConfig.label}</span>
          </Badge>
          <Badge variant="outline" className={trustConfig.color}>
            {trustConfig.icon}
            <span className="ml-1">{trustConfig.label}</span>
          </Badge>
          <Badge variant="outline" className={statusConfig.color}>
            {statusConfig.icon}
            <span className="ml-1">{statusConfig.label}</span>
          </Badge>
        </div>
        {plugin.lastError && (
          <p className="text-xs text-destructive mt-2 line-clamp-2">
            Error: {plugin.lastError}
          </p>
        )}
      </CardContent>
      <CardFooter className="pt-0">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Label htmlFor={`enable-${plugin.id}`} className="text-sm">
              {isEnabled ? "Enabled" : "Disabled"}
            </Label>
            <Switch
              id={`enable-${plugin.id}`}
              checked={isEnabled}
              onCheckedChange={(checked) => (checked ? onEnable() : onDisable())}
            />
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}

// =============================================================================
// REGISTRY PLUGIN CARD
// =============================================================================

function RegistryPluginCard({
  plugin,
  isInstalled,
  onInstall,
  isInstalling,
}: {
  plugin: PluginRegistryEntry;
  isInstalled: boolean;
  onInstall: () => void;
  isInstalling: boolean;
}) {
  const categoryConfig = CATEGORY_CONFIG[plugin.category];
  const trustConfig = TRUST_CONFIG[plugin.trust];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
              {plugin.iconUrl ? (
                <img src={plugin.iconUrl} alt="" className="h-6 w-6" />
              ) : (
                <Puzzle className="h-6 w-6" />
              )}
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {plugin.name}
                <Badge variant="outline" className="text-xs">
                  v{plugin.version}
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{plugin.author}</p>
            </div>
          </div>
          {plugin.verified && (
            <Badge variant="outline" className="bg-green-500/20 text-green-600">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Verified
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {plugin.description}
        </p>
        <div className="flex flex-wrap gap-1 mb-3">
          <Badge variant="outline" className={categoryConfig.color}>
            {categoryConfig.icon}
            <span className="ml-1">{categoryConfig.label}</span>
          </Badge>
          <Badge variant="outline" className={trustConfig.color}>
            {trustConfig.icon}
            <span className="ml-1">{trustConfig.label}</span>
          </Badge>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Download className="h-3 w-3" />
              {plugin.downloads.toLocaleString()}
            </span>
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
              {plugin.rating.toFixed(1)} ({plugin.ratingCount})
            </span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="pt-0">
        <Button
          onClick={onInstall}
          disabled={isInstalled || isInstalling}
          className="w-full"
          variant={isInstalled ? "secondary" : "default"}
        >
          {isInstalling ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Installing...
            </>
          ) : isInstalled ? (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Installed
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Install
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}

// =============================================================================
// INSTALL FROM URL DIALOG
// =============================================================================

function InstallFromUrlDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const installPlugin = useInstallPlugin();

  const handleInstall = async () => {
    await installPlugin.mutateAsync({ source: "url", value: url });
    onClose();
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Install from URL</DialogTitle>
        <DialogDescription>
          Enter the URL of a plugin package (.zip file)
        </DialogDescription>
      </DialogHeader>
      <div className="py-4">
        <Input
          placeholder="https://example.com/plugin.zip"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleInstall} disabled={!url || installPlugin.isPending}>
          {installPlugin.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Install
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// =============================================================================
// MAIN PAGE COMPONENT
// =============================================================================

export default function PluginMarketplacePage() {
  const { isReady, isInitializing, initialize } = usePluginSystem();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [configPlugin, setConfigPlugin] = useState<PluginId | null>(null);

  const { data: installedPlugins = [], isLoading: isLoadingInstalled } = useInstalledPlugins(isReady);
  const { data: registryPlugins = [], isLoading: isLoadingRegistry } = useRegistrySearch(
    {
      query: searchQuery || undefined,
      category: selectedCategory !== "all" ? (selectedCategory as any) : undefined,
      limit: 50,
    },
    isReady
  );

  const installPlugin = useInstallPlugin();
  const uninstallPlugin = useUninstallPlugin();
  const enablePlugin = useEnablePlugin();
  const disablePlugin = useDisablePlugin();
  const updatePlugin = useUpdatePlugin();

  const installedIds = useMemo(
    () => new Set(installedPlugins.map((p) => p.manifest.id)),
    [installedPlugins]
  );

  if (!isReady) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] gap-4">
        <Puzzle className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Plugin Marketplace</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Extend JoyCreate with plugins for new AI models, tools, themes, and integrations.
        </p>
        <Button onClick={initialize} disabled={isInitializing} size="lg">
          {isInitializing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Initialize Plugin System
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Puzzle className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Plugin Marketplace</h1>
            <p className="text-sm text-muted-foreground">
              {installedPlugins.length} plugins installed
            </p>
          </div>
        </div>
        <Dialog open={showInstallDialog} onOpenChange={setShowInstallDialog}>
          <DialogTrigger asChild>
            <Button variant="outline">
              <Upload className="mr-2 h-4 w-4" />
              Install from URL
            </Button>
          </DialogTrigger>
          {showInstallDialog && (
            <InstallFromUrlDialog onClose={() => setShowInstallDialog(false)} />
          )}
        </Dialog>
      </div>

      {/* Search and Filter */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search plugins..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
              <SelectItem key={key} value={key}>
                <div className="flex items-center gap-2">
                  {config.icon}
                  {config.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="installed" className="space-y-4">
        <TabsList>
          <TabsTrigger value="installed">
            <Package className="mr-2 h-4 w-4" />
            Installed ({installedPlugins.length})
          </TabsTrigger>
          <TabsTrigger value="browse">
            <Globe className="mr-2 h-4 w-4" />
            Browse
          </TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="space-y-4">
          {isLoadingInstalled ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : installedPlugins.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Package className="h-8 w-8 mb-2" />
              <p>No plugins installed yet</p>
              <p className="text-sm">Browse the marketplace to find plugins</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {installedPlugins.map((plugin) => (
                <InstalledPluginCard
                  key={plugin.id}
                  plugin={plugin}
                  onEnable={() => enablePlugin.mutate(plugin.id)}
                  onDisable={() => disablePlugin.mutate(plugin.id)}
                  onUninstall={() => uninstallPlugin.mutate(plugin.id)}
                  onUpdate={() => updatePlugin.mutate(plugin.id)}
                  onConfigure={() => setConfigPlugin(plugin.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="browse" className="space-y-4">
          {isLoadingRegistry ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : registryPlugins.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Search className="h-8 w-8 mb-2" />
              <p>No plugins found</p>
              <p className="text-sm">Try a different search query</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {registryPlugins.map((plugin) => (
                <RegistryPluginCard
                  key={plugin.id}
                  plugin={plugin}
                  isInstalled={installedIds.has(plugin.id)}
                  onInstall={() =>
                    installPlugin.mutate({ source: "registry", value: plugin.id })
                  }
                  isInstalling={installPlugin.isPending}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Plugin Configuration Dialog */}
      {configPlugin && (
        <PluginConfigDialog
          pluginId={configPlugin}
          onClose={() => setConfigPlugin(null)}
        />
      )}
    </div>
  );
}

// =============================================================================
// PLUGIN CONFIG DIALOG
// =============================================================================

function PluginConfigDialog({
  pluginId,
  onClose,
}: {
  pluginId: PluginId;
  onClose: () => void;
}) {
  const { data: plugin } = usePlugin(pluginId);

  if (!plugin) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Configure {plugin.manifest.name}
          </DialogTitle>
          <DialogDescription>
            Customize plugin settings and permissions
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Plugin Info */}
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            <div className="h-12 w-12 rounded-lg bg-background flex items-center justify-center">
              {plugin.manifest.icon ? (
                <img src={plugin.manifest.icon} alt="" className="h-8 w-8" />
              ) : (
                <Puzzle className="h-8 w-8" />
              )}
            </div>
            <div>
              <p className="font-medium">{plugin.manifest.name}</p>
              <p className="text-sm text-muted-foreground">
                v{plugin.manifest.version} by {plugin.manifest.author}
              </p>
            </div>
          </div>

          {/* Permissions */}
          {plugin.manifest.permissions && plugin.manifest.permissions.length > 0 && (
            <div>
              <Label className="text-base">Permissions</Label>
              <div className="mt-2 space-y-2">
                {plugin.manifest.permissions.map((perm) => (
                  <div
                    key={perm.name}
                    className="flex items-center justify-between p-2 border rounded-lg"
                  >
                    <div>
                      <p className="text-sm font-medium">{perm.name}</p>
                      <p className="text-xs text-muted-foreground">{perm.description}</p>
                    </div>
                    <Switch
                      checked={plugin.permissions.includes(perm.name)}
                      disabled={perm.required}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Configuration */}
          {plugin.manifest.configuration && plugin.manifest.configuration.length > 0 && (
            <div>
              <Label className="text-base">Settings</Label>
              <p className="text-sm text-muted-foreground mt-1">
                Configuration options for this plugin
              </p>
              {/* TODO: Render configuration inputs based on schema */}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
