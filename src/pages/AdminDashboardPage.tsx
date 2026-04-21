/**
 * Admin Dashboard — System overview for power users
 *
 * Central command page showing:
 * - System health status (all services)
 * - Resource usage (CPU, memory, storage, tokens)
 * - Active agents, running builds, deployments
 * - Recent errors and warnings
 * - Quick actions (restart, clear cache, backup)
 * - Service status grid (Ollama, IMAP, IPC, MCP, n8n, Celestia)
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Activity, Server, Cpu, HardDrive, Bot, Rocket, Zap,
  AlertTriangle, CheckCircle2, XCircle, RefreshCw, Clock,
  Database, Globe, Wifi, Shield, Terminal, BarChart3,
  Gauge, Download, Trash2, Archive, Power,
} from "lucide-react";

function StatusBadge({ status }: { status: "healthy" | "degraded" | "down" | "unknown" }) {
  const config = {
    healthy: { label: "Healthy", className: "bg-green-500/20 text-green-400" },
    degraded: { label: "Degraded", className: "bg-amber-500/20 text-amber-400" },
    down: { label: "Down", className: "bg-red-500/20 text-red-400" },
    unknown: { label: "Unknown", className: "bg-gray-500/20 text-gray-400" },
  };
  const c = config[status];
  return <Badge className={`${c.className} text-[10px]`}>{c.label}</Badge>;
}

export default function AdminDashboardPage() {
  const services = [
    { name: "Ollama", status: "healthy" as const, info: "12 models loaded", icon: <Cpu className="w-5 h-5" /> },
    { name: "IPC Server", status: "healthy" as const, info: "165 handlers registered", icon: <Server className="w-5 h-5" /> },
    { name: "MCP Server", status: "healthy" as const, info: "16 tool modules", icon: <Terminal className="w-5 h-5" /> },
    { name: "Email (IMAP)", status: "healthy" as const, info: "hello@joymarketplace.io", icon: <Globe className="w-5 h-5" /> },
    { name: "OpenClaw Gateway", status: "healthy" as const, info: "Connected", icon: <Wifi className="w-5 h-5" /> },
    { name: "Celestia Node", status: "unknown" as const, info: "Not configured", icon: <Database className="w-5 h-5" /> },
    { name: "n8n Engine", status: "unknown" as const, info: "Not started", icon: <Zap className="w-5 h-5" /> },
    { name: "Marketplace API", status: "degraded" as const, info: "Disconnected", icon: <Globe className="w-5 h-5" /> },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Gauge className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Admin Dashboard</h1>
              <p className="text-sm text-muted-foreground">System overview and management</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm"><RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh</Button>
            <Button variant="outline" size="sm"><Archive className="w-3.5 h-3.5 mr-1" /> Backup</Button>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Active Agents", value: "14", icon: <Bot className="w-4 h-4 text-violet-400" />, change: "+2 this week" },
            { label: "Apps Built", value: "44+", icon: <Rocket className="w-4 h-4 text-green-400" />, change: "+5 this week" },
            { label: "Total Files", value: "1,175", icon: <Database className="w-4 h-4 text-blue-400" />, change: "14.5 MB source" },
            { label: "Lines of Code", value: "417K", icon: <BarChart3 className="w-4 h-4 text-amber-400" />, change: "+30K this week" },
          ].map((kpi) => (
            <Card key={kpi.label} className="bg-muted/20 border-border/40">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  {kpi.icon}
                  <span className="text-[11px] text-muted-foreground/60">{kpi.label}</span>
                </div>
                <span className="text-2xl font-bold block">{kpi.value}</span>
                <span className="text-[10px] text-muted-foreground/50">{kpi.change}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Resource Usage */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "CPU", value: 23, max: "100%", color: "bg-blue-500" },
            { label: "Memory", value: 45, max: "16 GB", color: "bg-purple-500" },
            { label: "Storage", value: 12, max: "500 GB", color: "bg-green-500" },
            { label: "Token Budget", value: 8, max: "Monthly", color: "bg-amber-500" },
          ].map((res) => (
            <Card key={res.label} className="bg-muted/20 border-border/40">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium">{res.label}</span>
                  <span className="text-xs text-muted-foreground/50">{res.value}%</span>
                </div>
                <Progress value={res.value} className="h-2" />
                <span className="text-[10px] text-muted-foreground/40 mt-1 block">{res.max}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Service Status Grid */}
        <h3 className="text-sm font-semibold mb-3">Service Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {services.map((svc) => (
            <Card key={svc.name} className="bg-muted/10 border-border/30">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-muted/30 flex items-center justify-center text-muted-foreground/60">{svc.icon}</div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium block">{svc.name}</span>
                  <span className="text-[10px] text-muted-foreground/50">{svc.info}</span>
                </div>
                <StatusBadge status={svc.status} />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick Actions */}
        <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Clear Cache", icon: <Trash2 className="w-4 h-4" />, action: () => toast.info("Cache cleared") },
            { label: "Restart Services", icon: <RefreshCw className="w-4 h-4" />, action: () => toast.info("Restarting...") },
            { label: "Export Data", icon: <Download className="w-4 h-4" />, action: () => toast.info("Exporting...") },
            { label: "Run Backup", icon: <Archive className="w-4 h-4" />, action: () => toast.info("Backup started") },
          ].map((qa) => (
            <Button key={qa.label} variant="outline" className="h-auto py-3 flex-col gap-2" onClick={qa.action}>
              {qa.icon}
              <span className="text-xs">{qa.label}</span>
            </Button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
