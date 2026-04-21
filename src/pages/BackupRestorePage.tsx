/**
 * Backup & Restore Page
 *
 * Manage system backups, schedule automated backups,
 * view history, and restore from snapshots.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Archive, Download, Upload, Clock, CheckCircle2,
  HardDrive, Database, Trash2, RefreshCw, Calendar,
  Shield, AlertTriangle, Play, Settings,
} from "lucide-react";

interface BackupEntry {
  id: string;
  name: string;
  timestamp: string;
  size: string;
  type: "full" | "incremental" | "config-only";
  status: "completed" | "in-progress" | "failed";
  includes: string[];
}

const MOCK_BACKUPS: BackupEntry[] = [
  { id: "1", name: "Daily Backup", timestamp: new Date(Date.now() - 3600000).toISOString(), size: "2.1 GB", type: "full", status: "completed", includes: ["apps", "agents", "config", "models", "data"] },
  { id: "2", name: "Config Snapshot", timestamp: new Date(Date.now() - 86400000).toISOString(), size: "12 MB", type: "config-only", status: "completed", includes: ["config", "settings"] },
  { id: "3", name: "Weekly Full", timestamp: new Date(Date.now() - 604800000).toISOString(), size: "1.8 GB", type: "full", status: "completed", includes: ["apps", "agents", "config", "models", "data"] },
  { id: "4", name: "Pre-Migration", timestamp: new Date(Date.now() - 1209600000).toISOString(), size: "1.5 GB", type: "full", status: "completed", includes: ["apps", "agents", "config"] },
];

export default function BackupRestorePage() {
  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center">
              <Archive className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Backup & Restore</h1>
              <p className="text-sm text-muted-foreground">Manage system backups and recovery</p>
            </div>
          </div>
          <Button onClick={() => toast.info("Starting backup...")}><Archive className="w-4 h-4 mr-1.5" /> Create Backup Now</Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        {/* Schedule Settings */}
        <Card className="bg-muted/10 border-border/30 mb-6">
          <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Automated Backup Schedule</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Switch defaultChecked id="auto-backup" />
                <Label htmlFor="auto-backup" className="text-xs">Enable Auto-Backup</Label>
              </div>
              <Select defaultValue="daily">
                <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Every Hour</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
              <Select defaultValue="full">
                <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full Backup</SelectItem>
                  <SelectItem value="incremental">Incremental</SelectItem>
                  <SelectItem value="config-only">Config Only</SelectItem>
                </SelectContent>
              </Select>
              <Select defaultValue="5">
                <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">Keep 3 backups</SelectItem>
                  <SelectItem value="5">Keep 5 backups</SelectItem>
                  <SelectItem value="10">Keep 10 backups</SelectItem>
                  <SelectItem value="30">Keep 30 backups</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Backup History */}
        <h3 className="text-sm font-semibold mb-3">Backup History</h3>
        <div className="space-y-2">
          {MOCK_BACKUPS.map((backup) => (
            <Card key={backup.id} className="bg-muted/10 border-border/30">
              <CardContent className="p-3 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  {backup.status === "completed" ? <CheckCircle2 className="w-5 h-5 text-green-400" /> :
                   backup.status === "in-progress" ? <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" /> :
                   <AlertTriangle className="w-5 h-5 text-red-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{backup.name}</span>
                    <Badge variant="outline" className="text-[9px] capitalize">{backup.type}</Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-foreground/50">{new Date(backup.timestamp).toLocaleString()}</span>
                    <span className="text-[10px] text-muted-foreground/50">•</span>
                    <span className="text-[10px] text-muted-foreground/50">{backup.size}</span>
                    <span className="text-[10px] text-muted-foreground/50">•</span>
                    <span className="text-[10px] text-muted-foreground/50">{backup.includes.join(", ")}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => toast.info(`Restoring from ${backup.name}...`)}>
                    <Upload className="w-3 h-3 mr-0.5" /> Restore
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-[10px]">
                    <Download className="w-3 h-3 mr-0.5" /> Download
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground/50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
