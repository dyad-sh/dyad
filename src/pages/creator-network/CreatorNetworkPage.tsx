import { useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Globe, Users, ShoppingCart, TrendingUp, Zap, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { FederationClient } from "@/ipc/federation_client";

const IdentityTab = lazy(() => import("./IdentityTab"));
const PublishTab = lazy(() => import("./PublishTab"));
const BrowseTab = lazy(() => import("./BrowseTab"));
const EarningsTab = lazy(() => import("./EarningsTab"));
const ComputeTab = lazy(() => import("./ComputeTab"));

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function CreatorNetworkPage() {
  const [activeTab, setActiveTab] = useState("identity");

  const { data: identity } = useQuery({
    queryKey: ["federation-identity"],
    queryFn: () => FederationClient.getIdentity(),
  });

  return (
    <div className="flex flex-col h-full w-full" data-joy-assist="creator-network-page">
      {/* Header */}
      <div className="shrink-0 border-b bg-gradient-to-r from-cyan-500/5 via-teal-500/5 to-blue-500/5 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-teal-500/20 border border-cyan-500/20">
              <Globe className="h-5 w-5 text-cyan-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Creator Network</h1>
              <p className="text-sm text-muted-foreground">
                Publish, trade, and compute on the decentralized creator network
              </p>
            </div>
          </div>
          {identity ? (
            <Badge variant="secondary" className="gap-1.5 text-xs">
              <Users className="h-3 w-3" />
              {identity.display_name || identity.did.slice(0, 20) + "..."}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 text-xs text-muted-foreground">
              No Identity
            </Badge>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="shrink-0 border-b px-6">
          <TabsList className="h-11 bg-transparent p-0 gap-1">
            <TabsTrigger value="identity" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <Users className="h-3.5 w-3.5" />
              Identity
            </TabsTrigger>
            <TabsTrigger value="publish" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <ShoppingCart className="h-3.5 w-3.5" />
              Publish
            </TabsTrigger>
            <TabsTrigger value="browse" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <Globe className="h-3.5 w-3.5" />
              Browse
            </TabsTrigger>
            <TabsTrigger value="earnings" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <TrendingUp className="h-3.5 w-3.5" />
              Earnings
            </TabsTrigger>
            <TabsTrigger value="compute" className="gap-1.5 data-[state=active]:shadow-none data-[state=active]:bg-muted">
              <Zap className="h-3.5 w-3.5" />
              Compute
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto">
          <TabsContent value="identity" className="mt-0 h-full">
            <Suspense fallback={<TabFallback />}>
              <IdentityTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="publish" className="mt-0 h-full">
            <Suspense fallback={<TabFallback />}>
              <PublishTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="browse" className="mt-0 h-full">
            <Suspense fallback={<TabFallback />}>
              <BrowseTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="earnings" className="mt-0 h-full">
            <Suspense fallback={<TabFallback />}>
              <EarningsTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="compute" className="mt-0 h-full">
            <Suspense fallback={<TabFallback />}>
              <ComputeTab />
            </Suspense>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
