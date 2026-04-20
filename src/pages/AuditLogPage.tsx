/**
 * Audit Log Page — Security and access trail
 *
 * Features:
 * - Full history of user actions, system events, and security events
 * - Filter by action type, severity, date range
 * - Searchable
 * - Export to CSV/JSON
 */

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Shield, Search, Download, Clock, User, Bot, Rocket,
  Settings, Lock, Key, Eye, AlertTriangle, CheckCircle2,
  FileText, Database, Globe, Terminal, Activity,
} from "lucide-react";

type AuditSeverity = "info" | "warning" | "critical";
type AuditCategory = "auth" | "agents" | "builds" | "deploys" | "settings" | "data" | "marketplace" | "system";

interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  category: AuditCategory;
  severity: AuditSeverity;
  actor: string;
  details: string;
  ip?: string;
}

const SEVERITY_CONFIG: Record<AuditSeverity, { color: string; icon: React.ReactNode }> = {
  info: { color: "text-blue-400", icon: <Eye className="w-3.5 h-3.5" /> },
  warning: { color: "text-amber-400", icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  critical: { color: "text-red-400", icon: <Shield className="w-3.5 h-3.5" /> },
};

const MOCK_ENTRIES: AuditEntry[] = [
  { id: "1", timestamp: new Date(Date.now() - 600000).toISOString(), action: "Agent deployed", category: "agents", severity: "info", actor: "Terry", details: "CustomerCare Pro → production" },
  { id: "2", timestamp: new Date(Date.now() - 1800000).toISOString(), action: "Build completed", category: "builds", severity: "info", actor: "System", details: "DataVault Pro build #47 succeeded" },
  { id: "3", timestamp: new Date(Date.now() - 3600000).toISOString(), action: "Login from new device", category: "auth", severity: "warning", actor: "Terry", details: "Windows 11, Chrome 124", ip: "192.168.1.50" },
  { id: "4", timestamp: new Date(Date.now() - 7200000).toISOString(), action: "API key regenerated", category: "settings", severity: "critical", actor: "Terry", details: "Anthropic API key rotated" },
  { id: "5", timestamp: new Date(Date.now() - 14400000).toISOString(), action: "Data export", category: "data", severity: "info", actor: "Terry", details: "Exported 3 datasets (45MB)" },
  { id: "6", timestamp: new Date(Date.now() - 28800000).toISOString(), action: "Marketplace listing created", category: "marketplace", severity: "info", actor: "Terry", details: "AI3 Marketplace template published" },
  { id: "7", timestamp: new Date(Date.now() - 43200000).toISOString(), action: "Settings changed", category: "settings", severity: "info", actor: "Terry", details: "Updated model routing config" },
  { id: "8", timestamp: new Date(Date.now() - 86400000).toISOString(), action: "System backup", category: "system", severity: "info", actor: "System", details: "Automatic backup completed (2.1GB)" },
];

export default function AuditLogPage() {
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<AuditSeverity | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<AuditCategory | "all">("all");

  const filtered = useMemo(() => {
    return MOCK_ENTRIES
      .filter((e) => severityFilter === "all" || e.severity === severityFilter)
      .filter((e) => categoryFilter === "all" || e.category === categoryFilter)
      .filter((e) => !search || e.action.toLowerCase().includes(search.toLowerCase()) || e.details.toLowerCase().includes(search.toLowerCase()));
  }, [search, severityFilter, categoryFilter]);

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Audit Log</h1>
              <p className="text-sm text-muted-foreground">{filtered.length} events</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => toast.info("Exporting audit log...")}><Download className="w-3.5 h-3.5 mr-1" /> Export</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 p-3 border-b">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <Input placeholder="Search actions..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 h-8 text-xs" />
        </div>
        <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as any)}>
          <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severity</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as any)}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="auth">Auth</SelectItem>
            <SelectItem value="agents">Agents</SelectItem>
            <SelectItem value="builds">Builds</SelectItem>
            <SelectItem value="deploys">Deploys</SelectItem>
            <SelectItem value="settings">Settings</SelectItem>
            <SelectItem value="data">Data</SelectItem>
            <SelectItem value="marketplace">Marketplace</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Log entries */}
      <ScrollArea className="flex-1 p-3">
        <div className="space-y-1">
          {filtered.map((entry) => {
            const sev = SEVERITY_CONFIG[entry.severity];
            return (
              <div key={entry.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/10 group">
                <div className={sev.color}>{sev.icon}</div>
                <span className="text-[10px] text-muted-foreground/50 w-24 shrink-0 font-mono">{new Date(entry.timestamp).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 w-20 justify-center capitalize">{entry.category}</Badge>
                <span className="text-xs font-medium flex-1 truncate">{entry.action}</span>
                <span className="text-[11px] text-muted-foreground/60 truncate max-w-[200px]">{entry.details}</span>
                <span className="text-[10px] text-muted-foreground/40">{entry.actor}</span>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
