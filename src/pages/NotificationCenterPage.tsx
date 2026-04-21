/**
 * Notification Center Page
 *
 * Centralized notification management with real-time updates,
 * categorization, filtering, and smart notification preferences.
 *
 * Features:
 * - All notifications in one place (system, agent, build, deploy, marketplace, social)
 * - Read/unread management with bulk actions
 * - Priority filtering (urgent, high, medium, low, info)
 * - Category filtering (agents, builds, deploys, marketplace, social, system)
 * - Notification preferences per category
 * - Mark all read, dismiss, snooze
 * - Real-time push notification settings
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Bell, BellOff, BellRing, Check, CheckCheck, Trash2, Clock,
  Search, Filter, Bot, Rocket, Package, Users, Settings,
  AlertTriangle, Info, AlertCircle, Zap, Archive,
  Workflow, Shield, Mail, MessageSquare, Activity, RefreshCw,
  Volume2, VolumeX, Eye, EyeOff, ChevronRight, MoreVertical,
} from "lucide-react";

// ============================================================================
// TYPES
// ============================================================================

type NotificationPriority = "urgent" | "high" | "medium" | "low" | "info";
type NotificationCategory = "agents" | "builds" | "deploys" | "marketplace" | "social" | "system" | "security" | "workflows";

interface Notification {
  id: string;
  title: string;
  message: string;
  priority: NotificationPriority;
  category: NotificationCategory;
  read: boolean;
  dismissed: boolean;
  createdAt: string;
  actionUrl?: string;
  actionLabel?: string;
  icon?: string;
  source?: string;
}

interface NotificationPrefs {
  category: NotificationCategory;
  enabled: boolean;
  sound: boolean;
  desktop: boolean;
  email: boolean;
}

// ============================================================================
// MOCK DATA
// ============================================================================

const MOCK_NOTIFICATIONS: Notification[] = [
  { id: "1", title: "Agent 'CustomerCare Pro' deployed", message: "Successfully deployed to production environment", priority: "medium", category: "agents", read: false, dismissed: false, createdAt: new Date(Date.now() - 300000).toISOString(), actionUrl: "/agents", actionLabel: "View Agent" },
  { id: "2", title: "Build failed: DataVault Pro", message: "TypeScript error in src/components/vault.tsx line 42", priority: "high", category: "builds", read: false, dismissed: false, createdAt: new Date(Date.now() - 900000).toISOString(), actionUrl: "/app-details", actionLabel: "Fix Build" },
  { id: "3", title: "New marketplace sale", message: "AI3 Marketplace template purchased by user@example.com", priority: "medium", category: "marketplace", read: false, dismissed: false, createdAt: new Date(Date.now() - 1800000).toISOString(), actionUrl: "/nft-marketplace", actionLabel: "View Sale" },
  { id: "4", title: "Security alert: New login from unknown device", message: "A new device logged in from 192.168.1.50 at 10:32 AM", priority: "urgent", category: "security", read: false, dismissed: false, createdAt: new Date(Date.now() - 3600000).toISOString(), actionUrl: "/secrets-vault" },
  { id: "5", title: "Workflow 'Email Triage' completed", message: "Processed 47 emails, 3 flagged as urgent", priority: "low", category: "workflows", read: true, dismissed: false, createdAt: new Date(Date.now() - 7200000).toISOString(), actionUrl: "/workflows" },
  { id: "6", title: "Agent Swarm evolved: Gen 5 complete", message: "Best fitness improved from 0.82 to 0.91", priority: "info", category: "agents", read: true, dismissed: false, createdAt: new Date(Date.now() - 14400000).toISOString(), actionUrl: "/agent-swarm" },
  { id: "7", title: "Celestia blob anchored", message: "Identity event anchored at height 1,234,567", priority: "info", category: "system", read: true, dismissed: false, createdAt: new Date(Date.now() - 28800000).toISOString() },
  { id: "8", title: "Deploy succeeded: CloudSync Landing", message: "Live at cloudsync.joycreate.app", priority: "medium", category: "deploys", read: true, dismissed: false, createdAt: new Date(Date.now() - 43200000).toISOString(), actionUrl: "/deploy" },
];

const PRIORITY_CONFIG: Record<NotificationPriority, { icon: React.ReactNode; color: string; bg: string }> = {
  urgent: { icon: <AlertCircle className="w-4 h-4" />, color: "text-red-500", bg: "bg-red-500/10 border-red-500/20" },
  high: { icon: <AlertTriangle className="w-4 h-4" />, color: "text-orange-500", bg: "bg-orange-500/10 border-orange-500/20" },
  medium: { icon: <Info className="w-4 h-4" />, color: "text-blue-500", bg: "bg-blue-500/10 border-blue-500/20" },
  low: { icon: <Bell className="w-4 h-4" />, color: "text-gray-400", bg: "bg-muted/20 border-border/40" },
  info: { icon: <Info className="w-4 h-4" />, color: "text-gray-500", bg: "bg-muted/10 border-border/30" },
};

const CATEGORY_CONFIG: Record<NotificationCategory, { icon: React.ReactNode; label: string; color: string }> = {
  agents: { icon: <Bot className="w-3.5 h-3.5" />, label: "Agents", color: "text-violet-400" },
  builds: { icon: <Zap className="w-3.5 h-3.5" />, label: "Builds", color: "text-amber-400" },
  deploys: { icon: <Rocket className="w-3.5 h-3.5" />, label: "Deploys", color: "text-green-400" },
  marketplace: { icon: <Package className="w-3.5 h-3.5" />, label: "Marketplace", color: "text-pink-400" },
  social: { icon: <Users className="w-3.5 h-3.5" />, label: "Social", color: "text-cyan-400" },
  system: { icon: <Settings className="w-3.5 h-3.5" />, label: "System", color: "text-gray-400" },
  security: { icon: <Shield className="w-3.5 h-3.5" />, label: "Security", color: "text-red-400" },
  workflows: { icon: <Workflow className="w-3.5 h-3.5" />, label: "Workflows", color: "text-orange-400" },
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ============================================================================
// NOTIFICATION ITEM
// ============================================================================

function NotificationItem({ notif, onMarkRead, onDismiss }: {
  notif: Notification;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const priority = PRIORITY_CONFIG[notif.priority];
  const category = CATEGORY_CONFIG[notif.category];

  return (
    <div className={`p-3 rounded-lg border transition-colors cursor-pointer ${notif.read ? "bg-muted/5 border-border/20 opacity-70" : priority.bg} hover:opacity-100`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${priority.color}`}>{priority.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h4 className={`text-sm font-medium truncate ${notif.read ? "text-muted-foreground" : ""}`}>{notif.title}</h4>
            {!notif.read && <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
          </div>
          <p className="text-xs text-muted-foreground/70 line-clamp-1">{notif.message}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${category.color}`}>
              <span className="mr-0.5">{category.icon}</span> {category.label}
            </Badge>
            <span className="text-[10px] text-muted-foreground/50">{timeAgo(notif.createdAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {notif.actionUrl && (
            <Button size="sm" variant="ghost" className="h-7 text-[10px]">
              {notif.actionLabel || "View"} <ChevronRight className="w-3 h-3 ml-0.5" />
            </Button>
          )}
          {!notif.read && (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onMarkRead(notif.id)}>
              <Check className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground/50" onClick={() => onDismiss(notif.id)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PREFERENCES TAB
// ============================================================================

function NotificationPreferencesTab() {
  const categories: NotificationCategory[] = ["agents", "builds", "deploys", "marketplace", "social", "system", "security", "workflows"];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Notification Preferences</h3>
      <div className="space-y-2">
        {categories.map((cat) => {
          const config = CATEGORY_CONFIG[cat];
          return (
            <Card key={cat} className="bg-muted/10 border-border/30">
              <CardContent className="p-3 flex items-center gap-4">
                <div className={`w-8 h-8 rounded-lg bg-muted/30 flex items-center justify-center ${config.color}`}>
                  {config.icon}
                </div>
                <span className="text-sm font-medium flex-1">{config.label}</span>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <Switch defaultChecked id={`${cat}-enabled`} />
                    <Label htmlFor={`${cat}-enabled`} className="text-[10px] text-muted-foreground/60">Enabled</Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Switch defaultChecked id={`${cat}-sound`} />
                    <Label htmlFor={`${cat}-sound`} className="text-[10px] text-muted-foreground/60">Sound</Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Switch id={`${cat}-desktop`} />
                    <Label htmlFor={`${cat}-desktop`} className="text-[10px] text-muted-foreground/60">Desktop</Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Switch id={`${cat}-email`} />
                    <Label htmlFor={`${cat}-email`} className="text-[10px] text-muted-foreground/60">Email</Label>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function NotificationCenterPage() {
  const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);
  const [filter, setFilter] = useState<"all" | "unread" | "urgent">("all");
  const [categoryFilter, setCategoryFilter] = useState<NotificationCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("notifications");

  const filteredNotifications = useMemo(() => {
    return notifications
      .filter((n) => !n.dismissed)
      .filter((n) => {
        if (filter === "unread") return !n.read;
        if (filter === "urgent") return n.priority === "urgent" || n.priority === "high";
        return true;
      })
      .filter((n) => categoryFilter === "all" || n.category === categoryFilter)
      .filter((n) => !searchQuery || n.title.toLowerCase().includes(searchQuery.toLowerCase()) || n.message.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [notifications, filter, categoryFilter, searchQuery]);

  const unreadCount = notifications.filter((n) => !n.read && !n.dismissed).length;

  const handleMarkRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    toast.success("Marked as read");
  };

  const handleDismiss = (id: string) => {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, dismissed: true } : n));
    toast.success("Notification dismissed");
  };

  const handleMarkAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    toast.success("All notifications marked as read");
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <BellRing className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Notification Center</h1>
              <p className="text-sm text-muted-foreground">
                {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}` : "All caught up!"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleMarkAllRead} disabled={unreadCount === 0}>
              <CheckCheck className="w-3.5 h-3.5 mr-1" /> Mark All Read
            </Button>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="border-b px-4">
          <TabsList className="bg-transparent">
            <TabsTrigger value="notifications" className="gap-1.5">
              <Bell className="w-3.5 h-3.5" /> Notifications
              {unreadCount > 0 && <Badge className="ml-1 bg-blue-500 text-[10px] px-1.5 py-0">{unreadCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="preferences" className="gap-1.5">
              <Settings className="w-3.5 h-3.5" /> Preferences
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="notifications" className="flex-1 m-0 overflow-hidden flex flex-col">
          {/* Filters */}
          <div className="flex items-center gap-2 p-3 border-b">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
              <Input placeholder="Search notifications..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 h-8 text-xs" />
            </div>
            <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
              <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="unread">Unread</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as any)}>
              <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
                  <SelectItem key={key} value={key}>{config.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notification List */}
          <ScrollArea className="flex-1 p-3">
            <div className="space-y-2">
              {filteredNotifications.length > 0 ? (
                filteredNotifications.map((notif) => (
                  <NotificationItem key={notif.id} notif={notif} onMarkRead={handleMarkRead} onDismiss={handleDismiss} />
                ))
              ) : (
                <div className="text-center py-12">
                  <BellOff className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground/50">No notifications match your filters</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="preferences" className="flex-1 m-0 overflow-auto p-4">
          <NotificationPreferencesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
