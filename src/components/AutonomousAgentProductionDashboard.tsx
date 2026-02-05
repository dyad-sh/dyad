/**
 * AutonomousAgentProductionDashboard.tsx
 *
 * Production-ready dashboard for managing autonomous agents with:
 * - Resource monitoring (CPU, Memory, Disk)
 * - Throttle state management
 * - System health overview
 * - Pending approval workflows
 * - Schedule management
 * - Notification center
 * - Backup management
 * - Quota tracking
 * - Analytics metrics
 */

import { useState, useEffect } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  Bell,
  Brain,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  Download,
  Eye,
  GitBranch,
  HardDrive,
  Heart,
  LayoutTemplate,
  LineChart,
  MemoryStick,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Server,
  Settings,
  Shield,
  Users,
  XCircle,
  Zap,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useResourceUsage,
  useThrottleState,
  useSystemHealth,
  usePendingApprovals,
  useRespondToApproval,
  useSchedules,
  useCreateSchedule,
  useTemplates,
  useNotifications,
  useMarkNotificationRead,
  useBackups,
  useCreateBackup,
  useMetrics,
  useAuditLog,
  useProductionEvents,
  useInitializeProductionSystem,
} from "@/hooks/useAutonomousAgentProduction";
import type {
  ResourceThrottle,
  ApprovalRequest,
  Schedule,
  AgentTemplate,
  Notification,
  Backup,
  AuditLogEntry,
  SystemHealth,
  HealthStatus,
} from "@/lib/autonomous_agent_production";
import type { AutonomousAgentId } from "@/lib/autonomous_agent";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";

// ============================================================================
// Resource Monitor Component
// ============================================================================

function ResourceGauge({
  label,
  value,
  icon: Icon,
  color,
  threshold = 80,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  threshold?: number;
}) {
  const isWarning = value > threshold;
  const isCritical = value > 90;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={cn(
          "relative flex h-20 w-20 items-center justify-center rounded-full border-4",
          isCritical ? "border-red-500" : isWarning ? "border-yellow-500" : color
        )}
      >
        <div className="text-center">
          <span
            className={cn(
              "text-lg font-bold",
              isCritical ? "text-red-500" : isWarning ? "text-yellow-500" : ""
            )}
          >
            {value.toFixed(0)}%
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
    </div>
  );
}

type ThrottleLevel = ResourceThrottle["currentLevel"];

function ThrottleIndicator({ level }: { level: ThrottleLevel }) {
  const config: Record<ThrottleLevel, { color: string; icon: React.ReactNode; label: string }> = {
    none: { color: "bg-green-500", icon: <Play className="h-4 w-4" />, label: "Full Speed" },
    light: { color: "bg-blue-500", icon: <Activity className="h-4 w-4" />, label: "Light Throttle" },
    moderate: {
      color: "bg-yellow-500",
      icon: <AlertTriangle className="h-4 w-4" />,
      label: "Moderate Throttle",
    },
    heavy: {
      color: "bg-orange-500",
      icon: <AlertTriangle className="h-4 w-4" />,
      label: "Heavy Throttle",
    },
    paused: { color: "bg-red-500", icon: <Pause className="h-4 w-4" />, label: "Paused" },
  };

  const { color, icon, label } = config[level];

  return (
    <Badge variant="outline" className={cn("gap-1", color, "text-white")}>
      {icon}
      {label}
    </Badge>
  );
}

function ResourceMonitorPanel() {
  const { data: resources, isLoading } = useResourceUsage();
  const { data: throttle } = useThrottleState();

  if (isLoading || !resources) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Resource Monitor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Resource Monitor
          </CardTitle>
          {throttle && <ThrottleIndicator level={throttle.currentLevel} />}
        </div>
        <CardDescription>Real-time system resource usage</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-around gap-4">
          <ResourceGauge
            label="CPU"
            value={resources.cpu.usage}
            icon={Cpu}
            color="border-blue-500"
          />
          <ResourceGauge
            label="Memory"
            value={resources.memory.percentage}
            icon={MemoryStick}
            color="border-purple-500"
          />
          <ResourceGauge
            label="Disk"
            value={resources.disk.percentage}
            icon={HardDrive}
            color="border-green-500"
          />
        </div>
        <Separator className="my-4" />
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="text-muted-foreground">Total Memory:</div>
          <div>{(resources.memory.total / 1024 / 1024 / 1024).toFixed(1)} GB</div>
          <div className="text-muted-foreground">Free Memory:</div>
          <div>{(resources.memory.free / 1024 / 1024 / 1024).toFixed(1)} GB</div>
          <div className="text-muted-foreground">Load Average:</div>
          <div>{resources.cpu.loadAverage.map((l: number) => l.toFixed(2)).join(", ")}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// System Health Component
// ============================================================================

function HealthStatusIcon({ status }: { status: HealthStatus }) {
  switch (status) {
    case "healthy":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "degraded":
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case "unhealthy":
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return <Eye className="h-4 w-4 text-muted-foreground" />;
  }
}

function SystemHealthPanel() {
  const { data: health, isLoading, refetch } = useSystemHealth();
  const [expanded, setExpanded] = useState(false);

  if (isLoading || !health) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5" />
            System Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const componentEntries = Object.entries(health.components) as [string, HealthStatus][];
  const healthyCount = componentEntries.filter(([, status]) => status === "healthy").length;
  const totalCount = componentEntries.length;
  
  // Calculate overall status
  const hasUnhealthy = componentEntries.some(([, status]) => status === "unhealthy");
  const hasDegraded = componentEntries.some(([, status]) => status === "degraded");
  const overallStatus = hasUnhealthy ? "unhealthy" : hasDegraded ? "degraded" : "healthy";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5" />
            System Health
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant={overallStatus === "healthy" ? "default" : "destructive"}
              className={cn(
                overallStatus === "healthy" && "bg-green-500",
                overallStatus === "degraded" && "bg-yellow-500"
              )}
            >
              {overallStatus.toUpperCase()}
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <CardDescription>
          {healthyCount}/{totalCount} components healthy
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Progress value={(healthyCount / totalCount) * 100} className="mb-4" />
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between">
              <span>Component Details</span>
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-2">
              {componentEntries.map(([name, status]) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded border p-2"
                >
                  <div className="flex items-center gap-2">
                    <HealthStatusIcon status={status} />
                    <span className="font-medium capitalize">{name}</span>
                  </div>
                  <Badge variant={status === "healthy" ? "default" : "destructive"}>
                    {status}
                  </Badge>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Approval Workflow Component
// ============================================================================

function ApprovalCard({
  approval,
  onApprove,
  onReject,
}: {
  approval: ApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
}) {
  const riskColors: Record<string, string> = {
    low: "bg-green-500",
    medium: "bg-yellow-500",
    high: "bg-orange-500",
    critical: "bg-red-500",
  };

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            <span className="font-medium">{approval.action}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{approval.description}</p>
        </div>
        <Badge className={riskColors[approval.risk]}>{approval.risk.toUpperCase()}</Badge>
      </div>
      <Separator className="my-3" />
      <div className="mb-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Agent:</span>
          <span className="font-mono text-xs">{approval.agentId.slice(0, 12)}...</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Requested:</span>
          <span>{formatDistanceToNow(approval.createdAt, { addSuffix: true })}</span>
        </div>
        {approval.expiresAt && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Expires:</span>
            <span>{formatDistanceToNow(approval.expiresAt, { addSuffix: true })}</span>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="default" size="sm" className="flex-1" onClick={onApprove}>
          <CheckCircle className="mr-1 h-4 w-4" />
          Approve
        </Button>
        <Button variant="destructive" size="sm" className="flex-1" onClick={onReject}>
          <XCircle className="mr-1 h-4 w-4" />
          Reject
        </Button>
      </div>
    </div>
  );
}

function ApprovalsPanel() {
  const { data: approvals, isLoading } = usePendingApprovals();
  const respondMutation = useRespondToApproval();

  const handleRespond = async (approvalId: string, approved: boolean) => {
    try {
      await respondMutation.mutateAsync({
        approvalId: approvalId as ApprovalRequest["id"],
        approved,
        approvedBy: "user",
        reason: approved ? "Approved by user" : "Rejected by user",
      });
      toast.success(approved ? "Approved" : "Rejected", {
        description: `Action has been ${approved ? "approved" : "rejected"}.`,
      });
    } catch (error) {
      toast.error("Error", {
        description: "Failed to respond to approval request.",
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Pending Approvals
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Pending Approvals
          </CardTitle>
          {approvals && approvals.length > 0 && (
            <Badge variant="destructive">{approvals.length}</Badge>
          )}
        </div>
        <CardDescription>Human-in-the-loop approval workflow</CardDescription>
      </CardHeader>
      <CardContent>
        {!approvals || approvals.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <CheckCircle className="mx-auto mb-2 h-8 w-8" />
            <p>No pending approvals</p>
          </div>
        ) : (
          <ScrollArea className="h-[300px]">
            <div className="space-y-3">
              {approvals.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  onApprove={() => handleRespond(approval.id, true)}
                  onReject={() => handleRespond(approval.id, false)}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Schedule Management Component
// ============================================================================

function ScheduleRow({ schedule }: { schedule: Schedule }) {
  const typeIcons: Record<string, React.ReactNode> = {
    cron: <Clock className="h-4 w-4" />,
    interval: <RefreshCw className="h-4 w-4" />,
    once: <Calendar className="h-4 w-4" />,
  };

  return (
    <TableRow>
      <TableCell>{typeIcons[schedule.type]}</TableCell>
      <TableCell className="font-medium">{schedule.name}</TableCell>
      <TableCell className="font-mono text-xs">
        {schedule.type === "cron" ? schedule.cronExpression : `${schedule.intervalMs}ms`}
      </TableCell>
      <TableCell>
        <Badge variant={schedule.enabled ? "default" : "secondary"}>
          {schedule.enabled ? "Active" : "Disabled"}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {schedule.lastRunAt
          ? formatDistanceToNow(schedule.lastRunAt, { addSuffix: true })
          : "Never"}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {schedule.nextRunAt ? format(schedule.nextRunAt, "PPp") : "-"}
      </TableCell>
    </TableRow>
  );
}

function SchedulesPanel() {
  const { data: schedules, isLoading } = useSchedules();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const createMutation = useCreateSchedule();

  const [newSchedule, setNewSchedule] = useState({
    name: "",
    type: "interval" as "cron" | "interval" | "once",
    missionId: "",
    cronExpression: "",
    intervalMs: 3600000,
  });

  const handleCreate = async () => {
    try {
      await createMutation.mutateAsync({
        name: newSchedule.name,
        type: newSchedule.type,
        agentId: newSchedule.missionId as unknown as AutonomousAgentId,
        description: "",
        cronExpression: newSchedule.type === "cron" ? newSchedule.cronExpression : undefined,
        intervalMs: newSchedule.type === "interval" ? newSchedule.intervalMs : undefined,
        enabled: true,
        missionTemplate: {
          type: "scheduled",
          objective: newSchedule.name,
          context: "",
          constraints: [],
        },
        maxFailures: 3,
        pauseOnFailure: true,
      });
      setShowCreateDialog(false);
      toast.success("Schedule created", { description: "New schedule has been created." });
    } catch (error) {
      toast.error("Error", { description: "Failed to create schedule." });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Schedules
          </CardTitle>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" />
                New Schedule
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Schedule</DialogTitle>
                <DialogDescription>Schedule a mission to run automatically</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={newSchedule.name}
                    onChange={(e) => setNewSchedule({ ...newSchedule, name: e.target.value })}
                    placeholder="Daily backup"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={newSchedule.type}
                    onValueChange={(v) =>
                      setNewSchedule({ ...newSchedule, type: v as typeof newSchedule.type })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cron">Cron Expression</SelectItem>
                      <SelectItem value="interval">Fixed Interval</SelectItem>
                      <SelectItem value="once">One-Time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {newSchedule.type === "cron" && (
                  <div className="space-y-2">
                    <Label>Cron Expression</Label>
                    <Input
                      value={newSchedule.cronExpression}
                      onChange={(e) =>
                        setNewSchedule({ ...newSchedule, cronExpression: e.target.value })
                      }
                      placeholder="0 0 * * *"
                    />
                  </div>
                )}
                {newSchedule.type === "interval" && (
                  <div className="space-y-2">
                    <Label>Interval (minutes)</Label>
                    <Input
                      type="number"
                      value={newSchedule.intervalMs / 60000}
                      onChange={(e) =>
                        setNewSchedule({
                          ...newSchedule,
                          intervalMs: parseInt(e.target.value) * 60000,
                        })
                      }
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Mission ID</Label>
                  <Input
                    value={newSchedule.missionId}
                    onChange={(e) => setNewSchedule({ ...newSchedule, missionId: e.target.value })}
                    placeholder="mission_..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending}>
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <CardDescription>Automated mission scheduling</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !schedules || schedules.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Calendar className="mx-auto mb-2 h-8 w-8" />
            <p>No schedules configured</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">Type</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead>Next Run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.map((schedule) => (
                <ScheduleRow key={schedule.id} schedule={schedule} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Notifications Panel
// ============================================================================

function NotificationItem({
  notification,
  onMarkRead,
}: {
  notification: Notification;
  onMarkRead: () => void;
}) {
  const priorityColors: Record<string, string> = {
    low: "text-muted-foreground",
    normal: "text-foreground",
    high: "text-orange-500",
    urgent: "text-red-500",
    critical: "text-red-500",
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3",
        !notification.read && "bg-muted/50"
      )}
    >
      <Bell className={cn("mt-0.5 h-4 w-4", priorityColors[notification.priority])} />
      <div className="flex-1">
        <p className={cn("font-medium", priorityColors[notification.priority])}>
          {notification.title}
        </p>
        <p className="text-sm text-muted-foreground">{notification.message}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatDistanceToNow(notification.createdAt, { addSuffix: true })}
        </p>
      </div>
      {!notification.read && (
        <Button variant="ghost" size="sm" onClick={onMarkRead}>
          <Eye className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function NotificationsPanel() {
  const { data: notifications, isLoading } = useNotifications();
  const markReadMutation = useMarkNotificationRead();

  const unreadCount = notifications?.filter(n => !n.read).length ?? 0;

  const handleMarkRead = async (id: string) => {
    await markReadMutation.mutateAsync(id as Notification["id"]);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notifications
          </CardTitle>
          {unreadCount > 0 && (
            <Badge variant="destructive">{unreadCount}</Badge>
          )}
        </div>
        <CardDescription>System alerts and updates</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !notifications || notifications.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Bell className="mx-auto mb-2 h-8 w-8" />
            <p>No notifications</p>
          </div>
        ) : (
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkRead={() => handleMarkRead(notification.id)}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Templates Gallery
// ============================================================================

function TemplateCard({ template }: { template: AgentTemplate }) {
  const categoryIcons: Record<string, React.ReactNode> = {
    Research: <Brain className="h-8 w-8" />,
    Development: <Zap className="h-8 w-8" />,
    Design: <LayoutTemplate className="h-8 w-8" />,
    Analytics: <LineChart className="h-8 w-8" />,
    Automation: <RefreshCw className="h-8 w-8" />,
    Security: <Shield className="h-8 w-8" />,
    Assistant: <Users className="h-8 w-8" />,
    Knowledge: <Database className="h-8 w-8" />,
  };

  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-lg">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-lg",
              "bg-primary/10 text-primary"
            )}
          >
            {categoryIcons[template.category] || <Brain className="h-8 w-8" />}
          </div>
          <Badge variant="secondary">{template.category}</Badge>
        </div>
        <CardTitle className="mt-2">{template.name}</CardTitle>
        <CardDescription>{template.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {template.config.capabilities.slice(0, 3).map((cap: string) => (
              <Badge key={cap} variant="outline" className="text-xs">
                {cap.replace(/_/g, " ")}
              </Badge>
            ))}
            {template.config.capabilities.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{template.config.capabilities.length - 3} more
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {template.config.maxActionsPerHour} actions/hr •{" "}
            {template.config.learningEnabled ? "Learning enabled" : "Learning disabled"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function TemplatesPanel() {
  const { data: templates, isLoading } = useTemplates();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutTemplate className="h-5 w-5" />
          Agent Templates
        </CardTitle>
        <CardDescription>Pre-configured agent templates for common use cases</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !templates || templates.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <LayoutTemplate className="mx-auto mb-2 h-8 w-8" />
            <p>No templates available</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => (
              <TemplateCard key={template.id} template={template} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Backup Management
// ============================================================================

function BackupRow({ backup }: { backup: Backup }) {
  const typeIcons: Record<string, React.ReactNode> = {
    full: <Database className="h-4 w-4" />,
    incremental: <GitBranch className="h-4 w-4" />,
    agent_only: <Brain className="h-4 w-4" />,
    knowledge_only: <Network className="h-4 w-4" />,
  };

  const statusColors: Record<string, string> = {
    creating: "bg-yellow-500",
    completed: "bg-green-500",
    failed: "bg-red-500",
    restoring: "bg-blue-500",
  };

  return (
    <TableRow>
      <TableCell>{typeIcons[backup.type]}</TableCell>
      <TableCell>{format(backup.createdAt, "PPp")}</TableCell>
      <TableCell>
        <Badge className={statusColors[backup.status]}>{backup.status}</Badge>
      </TableCell>
      <TableCell>{backup.size ? `${(backup.size / 1024 / 1024).toFixed(1)} MB` : "-"}</TableCell>
      <TableCell>
        {backup.status === "completed" && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Download className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download backup</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </TableCell>
    </TableRow>
  );
}

function BackupsPanel() {
  const { data: backups, isLoading } = useBackups();
  const createMutation = useCreateBackup();

  const handleCreate = async (type: Backup["type"]) => {
    try {
      await createMutation.mutateAsync({ type });
      toast.success("Backup started", { description: `Creating ${type} backup...` });
    } catch (error) {
      toast.error("Error", { description: "Failed to create backup." });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5" />
            Backups
          </CardTitle>
          <Select onValueChange={(v) => handleCreate(v as Backup["type"])}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Create backup..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full">Full Backup</SelectItem>
              <SelectItem value="incremental">Incremental</SelectItem>
              <SelectItem value="agent_only">Agents Only</SelectItem>
              <SelectItem value="knowledge_only">Knowledge Only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <CardDescription>Backup and disaster recovery</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !backups || backups.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Archive className="mx-auto mb-2 h-8 w-8" />
            <p>No backups created</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">Type</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Size</TableHead>
                <TableHead className="w-[50px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.map((backup) => (
                <BackupRow key={backup.id} backup={backup} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Audit Log Panel
// ============================================================================

function AuditLogPanel() {
  const { data: auditLog, isLoading } = useAuditLog();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5" />
          Audit Log
        </CardTitle>
        <CardDescription>Security and activity tracking</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !auditLog || auditLog.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Eye className="mx-auto mb-2 h-8 w-8" />
            <p>No audit entries</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLog.map((entry: AuditLogEntry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-muted-foreground">
                      {format(entry.timestamp, "PPp")}
                    </TableCell>
                    <TableCell className="font-medium">{entry.action}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {entry.agentId ? entry.agentId.slice(0, 12) + "..." : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={entry.allowed ? "default" : "destructive"}>
                        {entry.allowed ? "Allowed" : "Denied"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Metrics Panel
// ============================================================================

function MetricsPanel() {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const { data: metrics, isLoading } = useMetrics("agent_performance", dayAgo, now);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LineChart className="h-5 w-5" />
          Metrics
        </CardTitle>
        <CardDescription>Agent performance data</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !metrics || (Array.isArray(metrics) && metrics.length === 0) ? (
          <div className="py-8 text-center text-muted-foreground">
            <LineChart className="mx-auto mb-2 h-8 w-8" />
            <p>No metrics collected</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {(Array.isArray(metrics) ? metrics.slice(0, 8) : []).map((metric, i) => (
              <div key={i} className="rounded-lg border p-3">
                <p className="text-sm text-muted-foreground">{metric.metric || "metric"}</p>
                <p className="text-2xl font-bold">
                  {typeof metric.value === "number" ? metric.value.toFixed(1) : "-"}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Dashboard Component
// ============================================================================

export function AutonomousAgentProductionDashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [isReady, setIsReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const initSystem = useInitializeProductionSystem();

  // Initialize production system on mount (with retry)
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setInitError(null);
      try {
        await initSystem.mutateAsync();
        if (!cancelled) setIsReady(true);
      } catch (error) {
        if (!cancelled) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          setInitError(msg);
          toast.error(`Production system init failed: ${msg}`);
        }
      }
    };
    init();
    return () => { cancelled = true; };
  }, [retryCount]);

  // Subscribe to production events
  const { events } = useProductionEvents();

  // Log events for debugging
  useEffect(() => {
    if (events.length > 0) {
      console.log("Production events:", events[0]);
    }
  }, [events]);

  if (!isReady) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex h-[60vh] items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            {initError ? (
              <>
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <p className="text-destructive font-medium">Production system failed to initialize</p>
                <p className="max-w-md text-center text-sm text-muted-foreground">{initError}</p>
                <Button
                  variant="outline"
                  onClick={() => setRetryCount((c) => c + 1)}
                  disabled={initSystem.isPending}
                >
                  {initSystem.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Retry
                </Button>
              </>
            ) : (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-muted-foreground">Initializing Production System...</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Production Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor and manage autonomous agent operations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Settings className="mr-1 h-4 w-4" />
            Settings
          </Button>
          <Button variant="default" size="sm">
            <Play className="mr-1 h-4 w-4" />
            Start All
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="overview">
            <Activity className="mr-1 h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="approvals">
            <Shield className="mr-1 h-4 w-4" />
            Approvals
          </TabsTrigger>
          <TabsTrigger value="schedules">
            <Calendar className="mr-1 h-4 w-4" />
            Schedules
          </TabsTrigger>
          <TabsTrigger value="templates">
            <LayoutTemplate className="mr-1 h-4 w-4" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="backups">
            <Archive className="mr-1 h-4 w-4" />
            Backups
          </TabsTrigger>
          <TabsTrigger value="audit">
            <Eye className="mr-1 h-4 w-4" />
            Audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <ResourceMonitorPanel />
            <SystemHealthPanel />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <NotificationsPanel />
            <MetricsPanel />
          </div>
        </TabsContent>

        <TabsContent value="approvals">
          <ApprovalsPanel />
        </TabsContent>

        <TabsContent value="schedules">
          <SchedulesPanel />
        </TabsContent>

        <TabsContent value="templates">
          <TemplatesPanel />
        </TabsContent>

        <TabsContent value="backups">
          <BackupsPanel />
        </TabsContent>

        <TabsContent value="audit">
          <AuditLogPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default AutonomousAgentProductionDashboard;
