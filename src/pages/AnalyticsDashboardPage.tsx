/**
 * Analytics Dashboard — Platform-wide metrics and insights
 *
 * Tabs:
 * 1. Overview — KPIs, trends, activity heatmap
 * 2. Agents — agent usage, performance, costs
 * 3. Apps — build metrics, deployment stats, user analytics
 * 4. Marketplace — sales, revenue, popular items
 * 5. AI Usage — token consumption, model performance, cost breakdown
 * 6. Community — engagement, growth, contributions
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart3, TrendingUp, TrendingDown, Bot, Rocket,
  Package, Cpu, Users, DollarSign, Eye, Activity,
  Clock, Zap, Download, ArrowUpRight, ArrowDownRight,
  Calendar, Globe, Layers, BarChart2,
} from "lucide-react";

function KPICard({ label, value, change, changeType, icon }: {
  label: string; value: string; change: string; changeType: "up" | "down" | "neutral"; icon: React.ReactNode;
}) {
  return (
    <Card className="bg-muted/20 border-border/40">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-muted-foreground/60">{icon}</span>
          <Badge className={`text-[9px] ${changeType === "up" ? "bg-green-500/20 text-green-400" : changeType === "down" ? "bg-red-500/20 text-red-400" : "bg-gray-500/20 text-gray-400"}`}>
            {changeType === "up" ? <ArrowUpRight className="w-2.5 h-2.5 mr-0.5" /> : changeType === "down" ? <ArrowDownRight className="w-2.5 h-2.5 mr-0.5" /> : null}
            {change}
          </Badge>
        </div>
        <span className="text-2xl font-bold block">{value}</span>
        <span className="text-[11px] text-muted-foreground/50">{label}</span>
      </CardContent>
    </Card>
  );
}

function MetricRow({ label, value, pct, color = "bg-blue-500" }: { label: string; value: string; pct: number; color?: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-xs w-40 truncate">{label}</span>
      <Progress value={pct} className="flex-1 h-2" />
      <span className="text-xs text-muted-foreground/60 w-20 text-right">{value}</span>
    </div>
  );
}

function OverviewTab() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Total Users" value="1,247" change="+12%" changeType="up" icon={<Users className="w-4 h-4" />} />
        <KPICard label="Active Agents" value="14" change="+2" changeType="up" icon={<Bot className="w-4 h-4" />} />
        <KPICard label="Apps Deployed" value="44" change="+5" changeType="up" icon={<Rocket className="w-4 h-4" />} />
        <KPICard label="Revenue (MTD)" value="$4,270" change="+23%" changeType="up" icon={<DollarSign className="w-4 h-4" />} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-muted/10 border-border/30">
          <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Activity This Week</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-7 gap-1">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => {
                const heights = [70, 85, 45, 90, 60, 30, 40];
                return (
                  <div key={day} className="text-center">
                    <div className="h-20 flex items-end justify-center mb-1">
                      <div className="w-6 bg-gradient-to-t from-blue-500 to-purple-500 rounded-t" style={{ height: `${heights[i]}%` }} />
                    </div>
                    <span className="text-[9px] text-muted-foreground/50">{day}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-muted/10 border-border/30">
          <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Top Actions Today</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4 space-y-1">
            <MetricRow label="Chat messages sent" value="847" pct={85} />
            <MetricRow label="Agent invocations" value="234" pct={48} />
            <MetricRow label="App builds triggered" value="127" pct={32} />
            <MetricRow label="Documents created" value="56" pct={18} />
            <MetricRow label="Marketplace views" value="412" pct={65} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AgentAnalyticsTab() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <KPICard label="Total Invocations" value="12,400" change="+18%" changeType="up" icon={<Zap className="w-4 h-4" />} />
        <KPICard label="Avg Response Time" value="1.2s" change="-0.3s" changeType="up" icon={<Clock className="w-4 h-4" />} />
        <KPICard label="Success Rate" value="98.7%" change="+0.2%" changeType="up" icon={<Activity className="w-4 h-4" />} />
      </div>
      <Card className="bg-muted/10 border-border/30">
        <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Agent Usage Ranking</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4 space-y-1">
          <MetricRow label="CustomerCare Pro" value="4,820" pct={100} />
          <MetricRow label="Code Review Bot" value="3,100" pct={64} />
          <MetricRow label="Content Writer" value="2,340" pct={49} />
          <MetricRow label="Data Analyst" value="1,200" pct={25} />
          <MetricRow label="Security Scanner" value="940" pct={20} />
        </CardContent>
      </Card>
    </div>
  );
}

function MarketplaceAnalyticsTab() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <KPICard label="Total Sales" value="287" change="+34%" changeType="up" icon={<Package className="w-4 h-4" />} />
        <KPICard label="Revenue" value="$12,450" change="+28%" changeType="up" icon={<DollarSign className="w-4 h-4" />} />
        <KPICard label="Listings" value="89" change="+12" changeType="up" icon={<Layers className="w-4 h-4" />} />
        <KPICard label="Avg Rating" value="4.6★" change="+0.1" changeType="up" icon={<Eye className="w-4 h-4" />} />
      </div>
      <Card className="bg-muted/10 border-border/30">
        <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Top Selling Items</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4 space-y-1">
          <MetricRow label="AI3 Marketplace Template" value="$3,200" pct={100} />
          <MetricRow label="CustomerCare Pro Agent" value="$2,800" pct={88} />
          <MetricRow label="ProAccountant Dashboard" value="$2,100" pct={66} />
          <MetricRow label="Data Pipeline Workflow" value="$1,400" pct={44} />
          <MetricRow label="E-Commerce Starter Kit" value="$890" pct={28} />
        </CardContent>
      </Card>
    </div>
  );
}

function AIUsageTab() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <KPICard label="Tokens Used (MTD)" value="8.2M" change="+15%" changeType="up" icon={<Cpu className="w-4 h-4" />} />
        <KPICard label="AI Cost (MTD)" value="$127" change="-8%" changeType="up" icon={<DollarSign className="w-4 h-4" />} />
        <KPICard label="Models Active" value="12" change="+2" changeType="up" icon={<Layers className="w-4 h-4" />} />
        <KPICard label="Local vs Cloud" value="67% / 33%" change="" changeType="neutral" icon={<Globe className="w-4 h-4" />} />
      </div>
      <Card className="bg-muted/10 border-border/30">
        <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Token Usage by Model</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4 space-y-1">
          <MetricRow label="Claude Sonnet 4" value="3.2M" pct={39} />
          <MetricRow label="Gemini 2.5 Flash" value="1.8M" pct={22} />
          <MetricRow label="DeepSeek Chat (local)" value="1.4M" pct={17} />
          <MetricRow label="GLM-4 Flash (local)" value="980K" pct={12} />
          <MetricRow label="Kimi K2.5 (local)" value="820K" pct={10} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function AnalyticsDashboardPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [timeRange, setTimeRange] = useState("30d");

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Analytics</h1>
              <p className="text-sm text-muted-foreground">Platform-wide metrics and insights</p>
            </div>
          </div>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="border-b px-4">
          <TabsList className="bg-transparent">
            <TabsTrigger value="overview" className="gap-1.5"><BarChart2 className="w-3.5 h-3.5" /> Overview</TabsTrigger>
            <TabsTrigger value="agents" className="gap-1.5"><Bot className="w-3.5 h-3.5" /> Agents</TabsTrigger>
            <TabsTrigger value="marketplace" className="gap-1.5"><Package className="w-3.5 h-3.5" /> Marketplace</TabsTrigger>
            <TabsTrigger value="ai-usage" className="gap-1.5"><Cpu className="w-3.5 h-3.5" /> AI Usage</TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea className="flex-1 p-4">
          <TabsContent value="overview" className="mt-0"><OverviewTab /></TabsContent>
          <TabsContent value="agents" className="mt-0"><AgentAnalyticsTab /></TabsContent>
          <TabsContent value="marketplace" className="mt-0"><MarketplaceAnalyticsTab /></TabsContent>
          <TabsContent value="ai-usage" className="mt-0"><AIUsageTab /></TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
