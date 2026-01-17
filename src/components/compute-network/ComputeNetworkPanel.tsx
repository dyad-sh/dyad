/**
 * Compute Network Panel
 * UI for decentralized AI inference network
 */

import { useState, useEffect } from "react";
import {
  useComputeNetwork,
  useComputeNetworkEvents,
  useComputePeers,
  useComputeJobs,
  useContentFetch,
  useComputeNetworkMetrics,
  useComputeSystemMetrics,
  useComputeJobStats,
} from "@/hooks/useComputeNetwork";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Activity,
  AlertCircle,
  Check,
  Clock,
  Cloud,
  CloudOff,
  Cpu,
  Download,
  HardDrive,
  Layers,
  Loader2,
  Network,
  Play,
  Plus,
  Power,
  RefreshCw,
  Server,
  Settings,
  Shield,
  Upload,
  Users,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import type {
  PeerInfo,
  InferenceJob,
  FetchProgress,
  NetworkStatus,
} from "@/types/compute_network_types";

// ============================================================================
// Status Badge Component
// ============================================================================

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { color: string; icon: React.ReactNode }> = {
    online: { color: "bg-green-500", icon: <Wifi className="h-3 w-3" /> },
    idle: { color: "bg-blue-500", icon: <Clock className="h-3 w-3" /> },
    busy: { color: "bg-yellow-500", icon: <Activity className="h-3 w-3" /> },
    offline: { color: "bg-gray-500", icon: <WifiOff className="h-3 w-3" /> },
    error: { color: "bg-red-500", icon: <AlertCircle className="h-3 w-3" /> },
    pending: { color: "bg-gray-400", icon: <Clock className="h-3 w-3" /> },
    executing: { color: "bg-blue-500", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    completed: { color: "bg-green-500", icon: <Check className="h-3 w-3" /> },
    failed: { color: "bg-red-500", icon: <AlertCircle className="h-3 w-3" /> },
  };

  const variant = variants[status] || variants.offline;

  return (
    <Badge variant="outline" className="gap-1">
      <span className={cn("h-2 w-2 rounded-full", variant.color)} />
      {status}
    </Badge>
  );
}

// ============================================================================
// Network Status Card
// ============================================================================

function NetworkStatusCard({ status }: { status: NetworkStatus | undefined }) {
  if (!status) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          <CloudOff className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Network not initialized</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Network className="h-5 w-5" />
            Network Status
          </CardTitle>
          <StatusBadge status={status.libp2pStatus} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <Users className="h-5 w-5 mx-auto mb-1 text-blue-500" />
            <p className="text-2xl font-bold">{status.connectedPeers}</p>
            <p className="text-xs text-muted-foreground">Connected Peers</p>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <Server className="h-5 w-5 mx-auto mb-1 text-purple-500" />
            <p className="text-2xl font-bold">{status.knownPeers}</p>
            <p className="text-xs text-muted-foreground">Known Peers</p>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <Zap className="h-5 w-5 mx-auto mb-1 text-yellow-500" />
            <p className="text-2xl font-bold">{status.activeJobs}</p>
            <p className="text-xs text-muted-foreground">Active Jobs</p>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <Download className="h-5 w-5 mx-auto mb-1 text-green-500" />
            <p className="text-2xl font-bold">{status.activeFetches}</p>
            <p className="text-xs text-muted-foreground">Downloads</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Helia:</span>
            <StatusBadge status={status.heliaStatus} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">DHT:</span>
            <Badge variant="outline">{status.dhtMode}</Badge>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Uptime:</span>
            <Badge variant="outline">{Math.floor(status.uptime / 60)}m</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Peer List
// ============================================================================

function PeerList({ peers }: { peers: PeerInfo[] }) {
  if (peers.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No peers connected</p>
        <p className="text-sm">Network discovery in progress...</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {peers.map((peer) => (
        <div
          key={peer.id.peerId}
          className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
        >
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                peer.status === "online"
                  ? "bg-green-500"
                  : peer.status === "busy"
                    ? "bg-yellow-500"
                    : "bg-gray-500"
              )}
            />
            <div>
              <p className="font-mono text-sm">
                {peer.id.displayName || peer.id.peerId.slice(0, 16) + "..."}
              </p>
              <p className="text-xs text-muted-foreground">
                {peer.capabilities.cpuCores} cores • {peer.capabilities.ramMb}MB RAM
                {peer.capabilities.gpus.length > 0 &&
                  ` • ${peer.capabilities.gpus[0].name}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="outline" className="text-xs">
                    {peer.jobsCompleted} jobs
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Reputation: {peer.reputation}/100</p>
                  <p>Avg latency: {peer.avgLatency}ms</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <StatusBadge status={peer.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Job List
// ============================================================================

function JobList({
  jobs,
  onCancel,
}: {
  jobs: InferenceJob[];
  onCancel?: (jobId: string) => void;
}) {
  if (jobs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No active jobs</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="p-3 bg-muted/30 rounded-lg"
        >
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="font-medium">{job.modelName}</p>
              <p className="text-xs text-muted-foreground">{job.type}</p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={job.status} />
              {onCancel && job.status !== "completed" && job.status !== "failed" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onCancel(job.id)}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>

          {(job.status === "executing" || job.status === "fetching-model") && (
            <Progress value={50} className="h-1" />
          )}

          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>ID: {job.id.slice(0, 8)}...</span>
            {job.executor && <span>Executor: {job.executor.slice(0, 8)}...</span>}
            <span>Created: {new Date(job.createdAt).toLocaleTimeString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Content Fetches
// ============================================================================

function FetchList({ fetches }: { fetches: FetchProgress[] }) {
  if (fetches.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Download className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No active downloads</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {fetches.map((fetch) => (
        <div
          key={fetch.requestId}
          className="p-3 bg-muted/30 rounded-lg"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="font-mono text-sm">{fetch.cid.slice(0, 24)}...</p>
            <StatusBadge status={fetch.status} />
          </div>

          <Progress
            value={(fetch.downloadedBytes / Math.max(fetch.totalBytes, 1)) * 100}
            className="h-1"
          />

          <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
            <span>
              {(fetch.downloadedBytes / 1024 / 1024).toFixed(2)}MB /{" "}
              {(fetch.totalBytes / 1024 / 1024).toFixed(2)}MB
            </span>
            <span>{(fetch.bytesPerSecond / 1024).toFixed(0)} KB/s</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// System Metrics Card
// ============================================================================

function SystemMetricsCard() {
  const { data: systemMetrics } = useComputeSystemMetrics();
  const { data: networkMetrics } = useComputeNetworkMetrics();
  const { data: jobStats } = useComputeJobStats();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="h-5 w-5" />
          System Metrics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-muted-foreground">CPU</span>
              <span className="text-sm font-medium">
                {systemMetrics?.cpuUsage.toFixed(1)}%
              </span>
            </div>
            <Progress value={systemMetrics?.cpuUsage ?? 0} className="h-2" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-muted-foreground">Memory</span>
              <span className="text-sm font-medium">
                {systemMetrics?.memoryUsage.toFixed(1)}%
              </span>
            </div>
            <Progress value={systemMetrics?.memoryUsage ?? 0} className="h-2" />
          </div>
        </div>

        {networkMetrics && (
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
            <div className="p-2 bg-muted/30 rounded text-center">
              <p className="text-muted-foreground">Peers</p>
              <p className="font-medium">{networkMetrics.connectedPeers}</p>
            </div>
            <div className="p-2 bg-muted/30 rounded text-center">
              <p className="text-muted-foreground">Latency</p>
              <p className="font-medium">{networkMetrics.avgPeerLatencyMs.toFixed(0)}ms</p>
            </div>
            <div className="p-2 bg-muted/30 rounded text-center">
              <p className="text-muted-foreground">Jobs/hr</p>
              <p className="font-medium">{jobStats?.completedLastHour ?? 0}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Panel Component
// ============================================================================

export function ComputeNetworkPanel() {
  const {
    status,
    isInitialized,
    isConnected,
    initialize,
    shutdown,
    isInitializing,
    isShuttingDown,
    peers,
    jobs,
    activeJobs,
    pendingJobs,
    cancelJob,
    activeFetches,
  } = useComputeNetwork();

  const { events, clearEvents } = useComputeNetworkEvents();
  const [walletAddress, setWalletAddress] = useState("");
  const [showInitDialog, setShowInitDialog] = useState(false);

  const handleInitialize = async () => {
    await initialize({
      enabled: true,
      identity: {
        walletAddress,
      },
    });
    setShowInitDialog(false);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          <span className="font-semibold">Compute Network</span>
          {isInitialized ? (
            <Badge variant="outline" className="text-xs">
              {isConnected ? (
                <>
                  <Cloud className="h-3 w-3 mr-1 text-green-500" />
                  Connected
                </>
              ) : (
                <>
                  <CloudOff className="h-3 w-3 mr-1 text-yellow-500" />
                  Connecting...
                </>
              )}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              <Power className="h-3 w-3 mr-1 text-gray-500" />
              Offline
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isInitialized ? (
            <Dialog open={showInitDialog} onOpenChange={setShowInitDialog}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Power className="h-4 w-4 mr-1" />
                  Start Network
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Initialize Compute Network</DialogTitle>
                  <DialogDescription>
                    Join the decentralized AI inference network to run or request
                    inference jobs.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Wallet Address</label>
                    <Input
                      placeholder="0x..."
                      value={walletAddress}
                      onChange={(e) => setWalletAddress(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Used for identity and payments
                    </p>
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    onClick={handleInitialize}
                    disabled={isInitializing}
                  >
                    {isInitializing && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    Initialize
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => shutdown()}
              disabled={isShuttingDown}
            >
              {isShuttingDown ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Power className="h-4 w-4 mr-1" />
              )}
              Stop
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="overview" className="h-full flex flex-col">
          <div className="border-b px-4">
            <TabsList className="h-10">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="peers">Peers</TabsTrigger>
              <TabsTrigger value="jobs">Jobs</TabsTrigger>
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1 p-4">
            <TabsContent value="overview" className="m-0 space-y-4">
              <NetworkStatusCard status={status} />
              <SystemMetricsCard />

              {activeJobs.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Active Jobs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <JobList jobs={activeJobs} onCancel={cancelJob} />
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="peers" className="m-0">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Connected Peers
                  </CardTitle>
                  <CardDescription>
                    Peers in the decentralized compute network
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <PeerList peers={peers} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="jobs" className="m-0 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Active Jobs</CardTitle>
                </CardHeader>
                <CardContent>
                  <JobList jobs={activeJobs} onCancel={cancelJob} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Pending Jobs</CardTitle>
                </CardHeader>
                <CardContent>
                  <JobList jobs={pendingJobs} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Job History</CardTitle>
                </CardHeader>
                <CardContent>
                  <JobList
                    jobs={jobs.filter(
                      (j) => j.status === "completed" || j.status === "failed"
                    )}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="content" className="m-0">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Download className="h-5 w-5" />
                    Active Downloads
                  </CardTitle>
                  <CardDescription>
                    Content being fetched from the network
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <FetchList fetches={activeFetches} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="events" className="m-0">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Network Events</CardTitle>
                    <Button variant="outline" size="sm" onClick={clearEvents}>
                      Clear
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {events.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No events yet</p>
                    </div>
                  ) : (
                    <div className="space-y-1 font-mono text-xs">
                      {events.slice(-50).reverse().map((event, i) => (
                        <div
                          key={i}
                          className="p-2 bg-muted/30 rounded flex items-center gap-2"
                        >
                          <Badge variant="outline" className="text-[10px]">
                            {event.type}
                          </Badge>
                          <span className="text-muted-foreground truncate">
                            {JSON.stringify(event).slice(0, 100)}...
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </div>
    </div>
  );
}

export default ComputeNetworkPanel;
