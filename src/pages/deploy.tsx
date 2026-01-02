/**
 * Deploy & Publish Page
 * Publish apps to JoyMarketplace for monetization
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Rocket,
  Upload,
  DollarSign,
  Package,
  ExternalLink,
  Settings,
  Check,
  AlertCircle,
  Loader2,
  Key,
  User,
  TrendingUp,
  Download,
  Eye,
  Star,
  ShoppingCart,
  Globe,
  Image,
  Tag,
  FileText,
  ChevronRight,
  Sparkles,
  Store,
  Wallet,
  BarChart3,
  RefreshCw,
  Copy,
  Folder,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

import { MarketplaceClient } from "@/ipc/marketplace_client";
import { IpcClient } from "@/ipc/ipc_client";
import type { App } from "@/ipc/ipc_types";
import type {
  PublishAppRequest,
  AssetCategory,
  PricingModel,
  MarketplaceAsset,
} from "@/types/marketplace_types";

const CATEGORIES: { value: AssetCategory; label: string; icon: any }[] = [
  { value: "web-app", label: "Web Application", icon: Globe },
  { value: "mobile-app", label: "Mobile App", icon: Package },
  { value: "dashboard", label: "Dashboard", icon: BarChart3 },
  { value: "e-commerce", label: "E-Commerce", icon: ShoppingCart },
  { value: "portfolio", label: "Portfolio", icon: User },
  { value: "landing-page", label: "Landing Page", icon: FileText },
  { value: "saas", label: "SaaS", icon: Sparkles },
  { value: "tool", label: "Tool/Utility", icon: Settings },
  { value: "ai-agent", label: "AI Agent", icon: Sparkles },
  { value: "template", label: "Template", icon: Copy },
  { value: "other", label: "Other", icon: Package },
];

const PRICING_MODELS: { value: PricingModel; label: string; description: string }[] = [
  { value: "free", label: "Free", description: "Give away for free" },
  { value: "one-time", label: "One-Time Purchase", description: "Single payment" },
  { value: "subscription", label: "Subscription", description: "Recurring monthly" },
  { value: "pay-what-you-want", label: "Pay What You Want", description: "Buyer sets price" },
];

export default function DeployPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState("publish");
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  
  // Publish form state
  const [publishForm, setPublishForm] = useState<Partial<PublishAppRequest>>({
    name: "",
    shortDescription: "",
    description: "",
    category: "web-app",
    tags: [],
    pricingModel: "free",
    price: 0,
    version: "1.0.0",
    techStack: [],
    features: [],
  });
  const [tagInput, setTagInput] = useState("");

  // Get marketplace status
  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery({
    queryKey: ["marketplace-status"],
    queryFn: () => MarketplaceClient.getStatus(),
  });

  // Get user's apps
  const { data: appsData } = useQuery({
    queryKey: ["apps"],
    queryFn: () => IpcClient.getInstance().listApps(),
  });
  const apps: App[] = appsData?.apps || [];

  // Get published assets
  const { data: publishedAssets = [], isLoading: assetsLoading } = useQuery({
    queryKey: ["marketplace-assets"],
    queryFn: () => MarketplaceClient.listAssets(),
    enabled: status?.connected === true,
  });

  // Get earnings
  const { data: earnings } = useQuery({
    queryKey: ["marketplace-earnings"],
    queryFn: () => MarketplaceClient.getEarnings(),
    enabled: status?.connected === true,
  });

  // Connect mutation
  const connectMutation = useMutation({
    mutationFn: (key: string) => MarketplaceClient.connect(key),
    onSuccess: () => {
      toast.success("Connected to JoyMarketplace!");
      setConnectDialogOpen(false);
      setApiKey("");
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["marketplace-assets"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to connect: ${error.message}`);
    },
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: () => MarketplaceClient.disconnect(),
    onSuccess: () => {
      toast.success("Disconnected from JoyMarketplace");
      refetchStatus();
    },
  });

  // Publish mutation
  const publishMutation = useMutation({
    mutationFn: (request: PublishAppRequest) => MarketplaceClient.publish(request),
    onSuccess: (response) => {
      if (response.success) {
        toast.success("App published successfully!");
        setPublishDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["marketplace-assets"] });
        if (response.assetUrl) {
          MarketplaceClient.openInBrowser(`/assets/${response.assetId}`);
        }
      } else {
        toast.error(`Publish failed: ${response.message}`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Publish error: ${error.message}`);
    },
  });

  // Export ZIP mutation
  const exportZipMutation = useMutation({
    mutationFn: (appId: number) => MarketplaceClient.exportZip(appId),
    onSuccess: (result) => {
      toast.success(`App exported to: ${result.path}`);
    },
    onError: (error: Error) => {
      toast.error(`Export failed: ${error.message}`);
    },
  });

  const handleConnect = () => {
    if (!apiKey.trim()) {
      toast.error("Please enter your API key");
      return;
    }
    connectMutation.mutate(apiKey);
  };

  const handlePublish = () => {
    if (!selectedAppId) {
      toast.error("Please select an app to publish");
      return;
    }
    if (!publishForm.name?.trim()) {
      toast.error("Please enter a name for your listing");
      return;
    }
    
    publishMutation.mutate({
      appId: selectedAppId,
      name: publishForm.name!,
      shortDescription: publishForm.shortDescription || "",
      description: publishForm.description || "",
      category: publishForm.category as AssetCategory,
      tags: publishForm.tags || [],
      pricingModel: publishForm.pricingModel as PricingModel,
      price: publishForm.pricingModel !== "free" ? (publishForm.price || 0) * 100 : undefined,
      version: publishForm.version || "1.0.0",
      techStack: publishForm.techStack,
      features: publishForm.features,
    });
  };

  const addTag = () => {
    if (tagInput.trim() && !publishForm.tags?.includes(tagInput.trim())) {
      setPublishForm({
        ...publishForm,
        tags: [...(publishForm.tags || []), tagInput.trim()],
      });
      setTagInput("");
    }
  };

  const removeTag = (tag: string) => {
    setPublishForm({
      ...publishForm,
      tags: publishForm.tags?.filter((t) => t !== tag) || [],
    });
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const getStatusBadge = (assetStatus: string) => {
    switch (assetStatus) {
      case "published":
        return <Badge className="bg-green-500/10 text-green-500">Published</Badge>;
      case "pending-review":
        return <Badge className="bg-yellow-500/10 text-yellow-500">Pending Review</Badge>;
      case "draft":
        return <Badge className="bg-gray-500/10 text-gray-500">Draft</Badge>;
      case "rejected":
        return <Badge className="bg-red-500/10 text-red-500">Rejected</Badge>;
      default:
        return <Badge variant="secondary">{assetStatus}</Badge>;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b bg-gradient-to-r from-violet-500/10 via-purple-500/10 to-fuchsia-500/10 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg">
              <Rocket className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent">
                Deploy & Publish
              </h1>
              <p className="text-sm text-muted-foreground">
                Publish your apps to JoyMarketplace for monetization
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {status?.connected ? (
              <>
                <Badge variant="outline" className="gap-1 px-3 py-1.5 bg-green-500/10 border-green-500/30">
                  <Check className="h-3 w-3 text-green-500" />
                  <span className="text-green-600">Connected</span>
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => MarketplaceClient.openInBrowser()}
                >
                  <Store className="h-4 w-4 mr-2" />
                  Open Marketplace
                </Button>
              </>
            ) : (
              <Button
                onClick={() => setConnectDialogOpen(true)}
                className="bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600"
              >
                <Key className="h-4 w-4 mr-2" />
                Connect Account
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        {!status?.connected ? (
          // Not connected state
          <div className="max-w-2xl mx-auto">
            <Card className="border-2 border-dashed">
              <CardContent className="p-12 text-center">
                <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center mb-6">
                  <Store className="h-8 w-8 text-violet-500" />
                </div>
                <h2 className="text-xl font-semibold mb-2">Connect to JoyMarketplace</h2>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  Publish your apps to JoyMarketplace and start earning money from your creations.
                  Set your own prices and reach thousands of users.
                </p>
                <div className="flex flex-col gap-4 items-center">
                  <Button
                    onClick={() => setConnectDialogOpen(true)}
                    size="lg"
                    className="bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600"
                  >
                    <Key className="h-4 w-4 mr-2" />
                    Connect Your Account
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => MarketplaceClient.openInBrowser("/register")}
                  >
                    <User className="h-4 w-4 mr-2" />
                    Create Publisher Account
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Feature highlights */}
            <div className="grid grid-cols-3 gap-4 mt-8">
              <Card>
                <CardContent className="p-6 text-center">
                  <DollarSign className="h-8 w-8 mx-auto mb-3 text-green-500" />
                  <h3 className="font-medium mb-1">Monetize Your Work</h3>
                  <p className="text-sm text-muted-foreground">
                    Set your own prices or offer for free
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6 text-center">
                  <Globe className="h-8 w-8 mx-auto mb-3 text-blue-500" />
                  <h3 className="font-medium mb-1">Global Reach</h3>
                  <p className="text-sm text-muted-foreground">
                    Reach thousands of users worldwide
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6 text-center">
                  <TrendingUp className="h-8 w-8 mx-auto mb-3 text-violet-500" />
                  <h3 className="font-medium mb-1">Track Earnings</h3>
                  <p className="text-sm text-muted-foreground">
                    Real-time analytics and payouts
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          // Connected state
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="publish" className="gap-2">
                <Upload className="h-4 w-4" />
                Publish
              </TabsTrigger>
              <TabsTrigger value="assets" className="gap-2">
                <Package className="h-4 w-4" />
                My Assets
              </TabsTrigger>
              <TabsTrigger value="earnings" className="gap-2">
                <Wallet className="h-4 w-4" />
                Earnings
              </TabsTrigger>
            </TabsList>

            {/* Publish Tab */}
            <TabsContent value="publish" className="space-y-6">
              {/* Quick stats */}
              <div className="grid grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-blue-500/10">
                        <Package className="h-5 w-5 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Local Apps</p>
                        <p className="text-2xl font-bold">{apps.length}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-green-500/10">
                        <Upload className="h-5 w-5 text-green-500" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Published</p>
                        <p className="text-2xl font-bold">{publishedAssets.length}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-yellow-500/10">
                        <Download className="h-5 w-5 text-yellow-500" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Total Downloads</p>
                        <p className="text-2xl font-bold">
                          {publishedAssets.reduce((sum, a) => sum + (a.downloads || 0), 0)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-violet-500/10">
                        <DollarSign className="h-5 w-5 text-violet-500" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Total Earnings</p>
                        <p className="text-2xl font-bold">
                          {formatCurrency(earnings?.totalEarnings || 0)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Apps to publish */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Folder className="h-5 w-5" />
                    Your Apps
                  </CardTitle>
                  <CardDescription>
                    Select an app to publish to JoyMarketplace
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {apps.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>No apps yet. Create your first app to get started!</p>
                      <Button
                        variant="outline"
                        className="mt-4"
                        onClick={() => navigate({ to: "/" })}
                      >
                        Create App
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      {apps.map((app) => (
                        <Card
                          key={app.id}
                          className={`cursor-pointer transition-all hover:border-violet-500/50 ${
                            selectedAppId === app.id ? "border-violet-500 bg-violet-500/5" : ""
                          }`}
                          onClick={() => {
                            setSelectedAppId(app.id);
                            setPublishForm({
                              ...publishForm,
                              name: app.name,
                            });
                          }}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20">
                                  <Package className="h-5 w-5 text-violet-500" />
                                </div>
                                <div>
                                  <p className="font-medium">{app.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    Created {new Date(app.createdAt).toLocaleDateString()}
                                  </p>
                                </div>
                              </div>
                              {selectedAppId === app.id && (
                                <Check className="h-5 w-5 text-violet-500" />
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Action buttons */}
              {selectedAppId && (
                <div className="flex gap-4">
                  <Button
                    onClick={() => setPublishDialogOpen(true)}
                    className="flex-1 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600"
                  >
                    <Rocket className="h-4 w-4 mr-2" />
                    Publish to Marketplace
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => exportZipMutation.mutate(selectedAppId)}
                    disabled={exportZipMutation.isPending}
                  >
                    {exportZipMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Export ZIP
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* Assets Tab */}
            <TabsContent value="assets" className="space-y-4">
              {assetsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : publishedAssets.length === 0 ? (
                <Card>
                  <CardContent className="p-12 text-center">
                    <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <h3 className="text-lg font-medium mb-2">No published assets yet</h3>
                    <p className="text-muted-foreground mb-4">
                      Publish your first app to start earning!
                    </p>
                    <Button onClick={() => setActiveTab("publish")}>
                      <Upload className="h-4 w-4 mr-2" />
                      Publish an App
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {publishedAssets.map((asset) => (
                    <Card key={asset.id}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center">
                              <Package className="h-8 w-8 text-violet-500" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="font-medium">{asset.name}</h3>
                                {getStatusBadge(asset.status)}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {asset.shortDescription}
                              </p>
                              <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Download className="h-3 w-3" />
                                  {asset.downloads} downloads
                                </span>
                                <span className="flex items-center gap-1">
                                  <Star className="h-3 w-3" />
                                  {asset.rating.toFixed(1)} ({asset.reviewCount})
                                </span>
                                <span>v{asset.version}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">
                              {asset.pricingModel === "free"
                                ? "Free"
                                : formatCurrency(asset.price || 0)}
                            </Badge>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => MarketplaceClient.openInBrowser(`/assets/${asset.id}`)}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Earnings Tab */}
            <TabsContent value="earnings" className="space-y-6">
              <div className="grid grid-cols-4 gap-4">
                <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/20">
                  <CardContent className="p-6">
                    <p className="text-sm text-muted-foreground mb-1">Total Earnings</p>
                    <p className="text-3xl font-bold text-green-600">
                      {formatCurrency(earnings?.totalEarnings || 0)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-muted-foreground mb-1">This Month</p>
                    <p className="text-3xl font-bold">
                      {formatCurrency(earnings?.thisMonth || 0)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-muted-foreground mb-1">Last Month</p>
                    <p className="text-3xl font-bold">
                      {formatCurrency(earnings?.lastMonth || 0)}
                    </p>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 border-violet-500/20">
                  <CardContent className="p-6">
                    <p className="text-sm text-muted-foreground mb-1">Pending Payout</p>
                    <p className="text-3xl font-bold text-violet-600">
                      {formatCurrency(earnings?.pendingPayout || 0)}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Top Performing Assets</CardTitle>
                </CardHeader>
                <CardContent>
                  {earnings?.topAssets?.length ? (
                    <div className="space-y-4">
                      {earnings.topAssets.map((asset, index) => (
                        <div key={asset.assetId} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-lg font-bold text-muted-foreground">
                              #{index + 1}
                            </span>
                            <div>
                              <p className="font-medium">{asset.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {asset.sales} sales
                              </p>
                            </div>
                          </div>
                          <p className="font-bold text-green-600">
                            {formatCurrency(asset.earnings)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">
                      No sales data yet
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Connect Dialog */}
      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect to JoyMarketplace</DialogTitle>
            <DialogDescription>
              Enter your API key to connect your publisher account.
              You can find this in your marketplace dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <Input
                id="api-key"
                type="password"
                placeholder="jm_pk_..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <Button
              variant="link"
              className="px-0"
              onClick={() => MarketplaceClient.openInBrowser("/dashboard/api-keys")}
            >
              Get your API key from the dashboard
              <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleConnect}
              disabled={connectMutation.isPending}
              className="bg-gradient-to-r from-violet-500 to-fuchsia-500"
            >
              {connectMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Key className="h-4 w-4 mr-2" />
              )}
              Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish Dialog */}
      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Publish to JoyMarketplace</DialogTitle>
            <DialogDescription>
              Fill in the details for your marketplace listing
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {/* Basic Info */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="listing-name">Listing Name *</Label>
                <Input
                  id="listing-name"
                  placeholder="My Awesome App"
                  value={publishForm.name}
                  onChange={(e) => setPublishForm({ ...publishForm, name: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="short-desc">Short Description *</Label>
                <Input
                  id="short-desc"
                  placeholder="A brief description (max 100 chars)"
                  maxLength={100}
                  value={publishForm.shortDescription}
                  onChange={(e) => setPublishForm({ ...publishForm, shortDescription: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Full Description</Label>
                <Textarea
                  id="description"
                  placeholder="Describe your app in detail..."
                  rows={4}
                  value={publishForm.description}
                  onChange={(e) => setPublishForm({ ...publishForm, description: e.target.value })}
                />
              </div>
            </div>

            <Separator />

            {/* Category & Tags */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={publishForm.category}
                  onValueChange={(v) => setPublishForm({ ...publishForm, category: v as AssetCategory })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        <div className="flex items-center gap-2">
                          <cat.icon className="h-4 w-4" />
                          {cat.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Version</Label>
                <Input
                  placeholder="1.0.0"
                  value={publishForm.version}
                  onChange={(e) => setPublishForm({ ...publishForm, version: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Add a tag..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                />
                <Button type="button" variant="outline" onClick={addTag}>
                  <Tag className="h-4 w-4" />
                </Button>
              </div>
              {publishForm.tags && publishForm.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {publishForm.tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="cursor-pointer"
                      onClick={() => removeTag(tag)}
                    >
                      {tag} ×
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Pricing */}
            <div className="space-y-4">
              <Label>Pricing</Label>
              <div className="grid grid-cols-2 gap-3">
                {PRICING_MODELS.map((model) => (
                  <Card
                    key={model.value}
                    className={`cursor-pointer transition-all ${
                      publishForm.pricingModel === model.value
                        ? "border-violet-500 bg-violet-500/5"
                        : "hover:border-violet-500/50"
                    }`}
                    onClick={() => setPublishForm({ ...publishForm, pricingModel: model.value })}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{model.label}</p>
                          <p className="text-xs text-muted-foreground">{model.description}</p>
                        </div>
                        {publishForm.pricingModel === model.value && (
                          <Check className="h-4 w-4 text-violet-500" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {publishForm.pricingModel !== "free" && (
                <div className="space-y-2">
                  <Label htmlFor="price">Price (USD)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="price"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="9.99"
                      className="pl-8"
                      value={publishForm.price || ""}
                      onChange={(e) => setPublishForm({ ...publishForm, price: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handlePublish}
              disabled={publishMutation.isPending}
              className="bg-gradient-to-r from-violet-500 to-fuchsia-500"
            >
              {publishMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4 mr-2" />
              )}
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
