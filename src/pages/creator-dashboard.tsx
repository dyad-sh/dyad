/**
 * Creator Dashboard — Unified view of all created assets, earnings, and analytics.
 */

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  DollarSign,
  BarChart3,
  Package,
  Loader2,
  ExternalLink,
  TrendingUp,
  Eye,
  Star,
  Download,
  Bot,
  AppWindow,
  Workflow,
  Database,
  Brain,
  Rocket,
  User,
  CheckCircle,
  Copy,
} from "lucide-react";
import {
  useCreatorOverview,
  useCreatorAssets,
  useCreatorEarnings,
  useCreatorAnalytics,
} from "@/hooks/use_creator_dashboard";
import type { CreatorAssetRecord, PublishableAssetType } from "@/types/publish_types";
import { useNavigate } from "@tanstack/react-router";

// Tab definitions
const TABS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "profile", label: "Profile", icon: User },
  { id: "assets", label: "My Assets", icon: Package },
  { id: "earnings", label: "Earnings", icon: DollarSign },
  { id: "analytics", label: "Analytics", icon: TrendingUp },
] as const;

type TabId = (typeof TABS)[number]["id"];

const ASSET_ICONS: Record<string, React.ElementType> = {
  app: AppWindow,
  agent: Bot,
  workflow: Workflow,
  dataset: Database,
  model: Brain,
};

const STATUS_COLORS: Record<string, string> = {
  local: "bg-gray-500/15 text-gray-600",
  draft: "bg-yellow-500/15 text-yellow-600",
  "pending-review": "bg-blue-500/15 text-blue-600",
  published: "bg-green-500/15 text-green-600",
  rejected: "bg-red-500/15 text-red-600",
  archived: "bg-gray-500/15 text-gray-600",
};

export default function CreatorDashboardPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-gradient-to-r from-amber-600/10 via-orange-600/10 to-rose-600/10 px-6 py-6">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Creator Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Manage all your creations, track earnings, and publish to JoyMarketplace
            </p>
          </div>
          <div className="ml-auto">
            <Button onClick={() => navigate({ to: "/nft-marketplace" })} variant="outline">
              <ExternalLink className="w-4 h-4 mr-2" />
              Open Marketplace
            </Button>
          </div>
        </div>
      </div>

      {/* Tab nav */}
      <div className="border-b px-6">
        <div className="max-w-5xl mx-auto flex gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-5xl mx-auto">
          {activeTab === "overview" && <OverviewTab />}
          {activeTab === "profile" && <ProfileTab />}
          {activeTab === "assets" && <AssetsTab />}
          {activeTab === "earnings" && <EarningsTab />}
          {activeTab === "analytics" && <AnalyticsTab />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile tab
// ---------------------------------------------------------------------------

function ProfileTab() {
  const { data: assets, isLoading: loadingAssets } = useCreatorAssets();
  const { data: analytics } = useCreatorAnalytics();

  const publishedAssets = (assets ?? []).filter(
    (a) => a.publishStatus === "published"
  );

  if (loadingAssets) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Profile header card */}
      <div className="rounded-xl border bg-gradient-to-r from-emerald-600/10 via-teal-600/10 to-cyan-600/10 p-6">
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
            <User className="w-10 h-10 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold">My Creator Profile</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {publishedAssets.length} published asset
              {publishedAssets.length !== 1 ? "s" : ""} on JoyMarketplace
            </p>
            <div className="flex gap-4 mt-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Download className="w-4 h-4" />
                {analytics?.totalDownloads?.toLocaleString() ?? 0} downloads
              </span>
              <span className="flex items-center gap-1">
                <Star className="w-4 h-4 text-yellow-500" />
                {analytics?.averageRating?.toFixed(1) ?? "\u2013"} avg rating
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Published assets */}
      <div>
        <h3 className="font-semibold text-lg mb-4">Published Assets</h3>
        {publishedAssets.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>No published assets yet</p>
            <p className="text-sm mt-1">
              Publish your first app, agent, or workflow to see it here
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {publishedAssets.map((asset) => (
              <div
                key={`${asset.assetType}-${asset.id}`}
                className="rounded-xl border bg-card p-4"
                data-joy-assist="published-asset-card"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-xs">
                    {asset.assetType}
                  </Badge>
                  <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                </div>
                <p className="font-medium">{asset.name}</p>
                {asset.publishedAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Published {new Date(asset.publishedAt).toLocaleDateString()}
                  </p>
                )}
                {asset.marketplaceId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-7 text-xs"
                    data-joy-assist="view-marketplace-link"
                    asChild
                  >
                    <a
                      href={`https://joymarketplace.io/assets/${asset.marketplaceId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-3 h-3 mr-1" />
                      View on Marketplace
                    </a>
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab() {
  const { data: overview, isLoading } = useCreatorOverview();
  const navigate = useNavigate();

  if (isLoading || !overview) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stats = [
    { label: "Apps", value: overview.totalApps, icon: AppWindow, color: "text-blue-500" },
    { label: "Agents", value: overview.totalAgents, icon: Bot, color: "text-violet-500" },
    { label: "Workflows", value: overview.totalWorkflows, icon: Workflow, color: "text-orange-500" },
    { label: "Datasets", value: overview.totalDatasets, icon: Database, color: "text-emerald-500" },
    { label: "Models", value: overview.totalModels, icon: Brain, color: "text-pink-500" },
    { label: "Published", value: overview.publishedCount, icon: Rocket, color: "text-amber-500" },
  ];

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="rounded-xl border bg-card p-4 text-center"
            >
              <Icon className={cn("w-5 h-5 mx-auto mb-2", s.color)} />
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* Earnings summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-card p-6">
          <p className="text-sm text-muted-foreground">Total Earnings</p>
          <p className="text-3xl font-bold mt-1">
            ${(overview.totalEarnings / 100).toFixed(2)}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-6">
          <p className="text-sm text-muted-foreground">This Month</p>
          <p className="text-3xl font-bold mt-1">
            ${(overview.thisMonthEarnings / 100).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Quick actions */}
      <div className="rounded-xl border bg-card p-6">
        <h3 className="font-semibold mb-4">Quick Actions</h3>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => navigate({ to: "/" })}>
            <AppWindow className="w-4 h-4 mr-2" />
            New App
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: "/agents" })}>
            <Bot className="w-4 h-4 mr-2" />
            New Agent
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: "/workflows" })}>
            <Workflow className="w-4 h-4 mr-2" />
            New Workflow
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: "/nft-marketplace" })}>
            <Eye className="w-4 h-4 mr-2" />
            Browse Marketplace
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assets tab
// ---------------------------------------------------------------------------

function AssetsTab() {
  const { data: assets, isLoading } = useCreatorAssets();
  const [typeFilter, setTypeFilter] = useState<PublishableAssetType | "all">("all");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const filtered =
    typeFilter === "all"
      ? assets ?? []
      : (assets ?? []).filter((a) => a.assetType === typeFilter);

  return (
    <div className="space-y-4">
      {/* Type filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {["all", "app", "agent", "workflow", "dataset", "model"].map((t) => (
          <Button
            key={t}
            variant={typeFilter === t ? "default" : "outline"}
            size="sm"
            onClick={() => setTypeFilter(t as any)}
          >
            {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1) + "s"}
          </Button>
        ))}
      </div>

      {/* Asset list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No assets found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((asset) => (
            <AssetRow key={`${asset.assetType}-${asset.id}`} asset={asset} />
          ))}
        </div>
      )}
    </div>
  );
}

function AssetRow({ asset }: { asset: CreatorAssetRecord }) {
  const Icon = ASSET_ICONS[asset.assetType] ?? Package;

  return (
    <div className="flex items-center gap-4 rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors">
      <Icon className="w-5 h-5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{asset.name}</p>
        <p className="text-xs text-muted-foreground">
          {asset.assetType} · Updated{" "}
          {new Date(asset.updatedAt).toLocaleDateString()}
        </p>
      </div>
      <Badge
        variant="secondary"
        className={cn("text-xs", STATUS_COLORS[asset.publishStatus] ?? "")}
      >
        {asset.publishStatus}
      </Badge>
      {asset.earnings !== undefined && asset.earnings > 0 && (
        <span className="text-xs font-medium text-green-600">
          ${(asset.earnings / 100).toFixed(2)}
        </span>
      )}
      {asset.marketplaceId && (
        <Button variant="ghost" size="sm" className="h-7" asChild>
          <a
            href={`https://joymarketplace.io/assets/${asset.marketplaceId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Earnings tab
// ---------------------------------------------------------------------------

function EarningsTab() {
  const { data: earnings, isLoading } = useCreatorEarnings();

  if (isLoading || !earnings) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Earnings" value={`$${(earnings.totalEarnings / 100).toFixed(2)}`} />
        <StatCard label="This Month" value={`$${(earnings.thisMonth / 100).toFixed(2)}`} />
        <StatCard label="Last Month" value={`$${(earnings.lastMonth / 100).toFixed(2)}`} />
        <StatCard label="Pending Payout" value={`$${(earnings.pendingPayout / 100).toFixed(2)}`} />
      </div>

      {/* Per-asset earnings */}
      {earnings.byAsset.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3">Earnings by Asset</h3>
          <div className="space-y-2">
            {earnings.byAsset.map((a) => (
              <div
                key={a.assetId}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium text-sm">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.assetType} · {a.sales} sales
                  </p>
                </div>
                <span className="font-semibold text-green-600">
                  ${(a.earnings / 100).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly chart placeholder */}
      {earnings.byMonth.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3">Monthly Revenue</h3>
          <div className="flex items-end gap-2 h-40 rounded-lg border bg-card p-4">
            {earnings.byMonth.slice(-12).map((m) => {
              const maxEarnings = Math.max(
                ...earnings.byMonth.map((x) => x.earnings),
                1
              );
              const height = (m.earnings / maxEarnings) * 100;
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center">
                  <div
                    className="w-full bg-gradient-to-t from-violet-500 to-fuchsia-400 rounded-t"
                    style={{ height: `${height}%` }}
                  />
                  <span className="text-[9px] text-muted-foreground mt-1 rotate-[-45deg]">
                    {m.month.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analytics tab
// ---------------------------------------------------------------------------

function AnalyticsTab() {
  const { data: analytics, isLoading } = useCreatorAnalytics();

  if (isLoading || !analytics) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Downloads" value={analytics.totalDownloads.toLocaleString()} />
        <StatCard label="Total Installs" value={analytics.totalInstalls.toLocaleString()} />
        <StatCard label="Average Rating" value={analytics.averageRating.toFixed(1)} />
        <StatCard label="Total Reviews" value={analytics.totalReviews.toLocaleString()} />
      </div>

      {analytics.topAssets.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3">Top Assets</h3>
          <div className="space-y-2">
            {analytics.topAssets.map((a) => (
              <div
                key={a.assetId}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <p className="font-medium text-sm">{a.name}</p>
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Download className="w-3 h-3" />
                    {a.downloads}
                  </span>
                  <span className="flex items-center gap-1 text-amber-600">
                    <Star className="w-3 h-3 fill-amber-500" />
                    {a.rating.toFixed(1)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}
