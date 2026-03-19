/**
 * AgentFlywheelTab — Per-agent Data Flywheel configuration & monitoring
 * Enable/disable auto-capture, thumbs feedback, corrections mode.
 * View stats, trigger manual training cycles, and monitor run history.
 */

import { useState, useEffect } from "react";
import {
  RotateCw,
  Play,
  Database,
  ThumbsUp,
  ThumbsDown,
  Pencil,
  RefreshCw,
  TrendingUp,
  Clock,
  AlertCircle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useFlywheelStats,
  useFlywheelRuns,
  useRunFlywheelCycle,
} from "@/hooks/use-flywheel";
import { agentBuilderClient } from "@/ipc/agent_builder_client";
import { FlywheelClient } from "@/ipc/flywheel_client";
import type { FlywheelConfig } from "@/types/agent_builder";
import { formatDistanceToNow } from "date-fns";

interface Props {
  agentId: number;
}

const DEFAULT_FLYWHEEL_CONFIG: FlywheelConfig = {
  enabled: false,
  modes: {
    autoCapture: true,
    thumbsFeedback: true,
    corrections: true,
  },
  schedule: "weekly",
  minSamplesBeforeTraining: 50,
  baseModel: "tinyllama",
  trainingMethod: "lora",
};

const BASE_MODELS = [
  { value: "tinyllama", label: "TinyLlama (1.1B — 2.5GB RAM)" },
  { value: "phi-2", label: "Phi-2 (2.7B — 6GB RAM)" },
  { value: "llama-2-7b", label: "Llama 2 7B (14GB RAM)" },
  { value: "mistral-7b", label: "Mistral 7B (14GB RAM)" },
  { value: "codellama-7b", label: "CodeLlama 7B (14GB RAM)" },
  { value: "llama-2-13b", label: "Llama 2 13B (26GB RAM)" },
];

export function AgentFlywheelTab({ agentId }: Props) {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<FlywheelConfig>(
    DEFAULT_FLYWHEEL_CONFIG,
  );
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch agent config to get flywheel settings
  const { data: agentData } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () =>
      agentBuilderClient.getAgent(agentId),
  });

  // Flywheel stats & runs
  const { data: stats, isLoading: statsLoading } = useFlywheelStats(agentId);
  const { data: runs } = useFlywheelRuns(agentId);
  const runCycleMutation = useRunFlywheelCycle();

  // Load config from agent data
  useEffect(() => {
    if (agentData?.config?.flywheel) {
      setConfig(agentData.config.flywheel);
    }
  }, [agentData]);

  // Save flywheel config
  const saveMutation = useMutation({
    mutationFn: async (newConfig: FlywheelConfig) => {
      const currentConfig = agentData?.config || {};
      const result = await agentBuilderClient.updateAgent({
        id: agentId,
        config: { ...currentConfig, flywheel: newConfig },
      });

      // Sync n8n workflow with schedule setting
      const client = FlywheelClient.getInstance();
      if (newConfig.enabled && newConfig.schedule !== "manual") {
        client
          .registerN8nWorkflow(newConfig.schedule)
          .catch(() => {}); // non-fatal
      } else {
        client.removeN8nWorkflow().catch(() => {}); // non-fatal
      }

      return result;
    },
    onSuccess: () => {
      setHasChanges(false);
      queryClient.invalidateQueries({
        queryKey: ["agent", agentId],
      });
    },
  });

  const updateConfig = (patch: Partial<FlywheelConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
    setHasChanges(true);
  };

  const updateModes = (
    patch: Partial<FlywheelConfig["modes"]>,
  ) => {
    setConfig((prev) => ({
      ...prev,
      modes: { ...prev.modes, ...patch },
    }));
    setHasChanges(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <RotateCw className="h-5 w-5" />
            Data Flywheel
          </h2>
          <p className="text-sm text-muted-foreground">
            Self-reinforcing training loop — interactions become training data
            that makes the model smarter
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <Button
              onClick={() => saveMutation.mutate(config)}
              disabled={saveMutation.isPending}
              size="sm"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              Save
            </Button>
          )}
        </div>
      </div>

      {/* Enable/Disable Toggle */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Enable Flywheel</CardTitle>
              <CardDescription>
                Automatically capture interactions for model improvement
              </CardDescription>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(enabled) => updateConfig({ enabled })}
            />
          </div>
        </CardHeader>
      </Card>

      {config.enabled && (
        <>
          {/* Capture Modes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Capture Modes</CardTitle>
              <CardDescription>
                Choose how training data is collected
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-blue-500" />
                  <div>
                    <Label className="font-medium">Auto-Capture</Label>
                    <p className="text-xs text-muted-foreground">
                      Save every Q&A pair automatically
                    </p>
                  </div>
                </div>
                <Switch
                  checked={config.modes.autoCapture}
                  onCheckedChange={(autoCapture) =>
                    updateModes({ autoCapture })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ThumbsUp className="h-4 w-4 text-green-500" />
                  <div>
                    <Label className="font-medium">Thumbs Feedback</Label>
                    <p className="text-xs text-muted-foreground">
                      Learn from thumbs up/down ratings
                    </p>
                  </div>
                </div>
                <Switch
                  checked={config.modes.thumbsFeedback}
                  onCheckedChange={(thumbsFeedback) =>
                    updateModes({ thumbsFeedback })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Pencil className="h-4 w-4 text-orange-500" />
                  <div>
                    <Label className="font-medium">User Corrections</Label>
                    <p className="text-xs text-muted-foreground">
                      Capture corrected responses as training data
                    </p>
                  </div>
                </div>
                <Switch
                  checked={config.modes.corrections}
                  onCheckedChange={(corrections) =>
                    updateModes({ corrections })
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* Training Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Training Configuration</CardTitle>
              <CardDescription>
                How and when to fine-tune the model
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Schedule</Label>
                  <Select
                    value={config.schedule}
                    onValueChange={(schedule: "daily" | "weekly" | "manual") =>
                      updateConfig({ schedule })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="manual">Manual Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Min Samples Before Training</Label>
                  <Input
                    type="number"
                    min={10}
                    max={10000}
                    value={config.minSamplesBeforeTraining}
                    onChange={(e) =>
                      updateConfig({
                        minSamplesBeforeTraining: Number(e.target.value) || 50,
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Base Model</Label>
                  <Select
                    value={config.baseModel}
                    onValueChange={(baseModel) =>
                      updateConfig({ baseModel })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BASE_MODELS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Training Method</Label>
                  <Select
                    value={config.trainingMethod}
                    onValueChange={(
                      trainingMethod: "lora" | "qlora" | "full",
                    ) => updateConfig({ trainingMethod })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lora">LoRA (Recommended)</SelectItem>
                      <SelectItem value="qlora">QLoRA (Low VRAM)</SelectItem>
                      <SelectItem value="full">
                        Full Fine-Tune (Max GPU)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats Dashboard */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Flywheel Stats</CardTitle>
                  <CardDescription>
                    Training data accumulation & cycle history
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runCycleMutation.mutate(agentId)}
                  disabled={
                    runCycleMutation.isPending ||
                    !stats ||
                    stats.pendingPairs < config.minSamplesBeforeTraining
                  }
                >
                  {runCycleMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-1" />
                  )}
                  Run Flywheel Now
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : stats ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-3">
                    <StatCard
                      icon={<Database className="h-4 w-4" />}
                      label="Total Pairs"
                      value={stats.totalPairs}
                    />
                    <StatCard
                      icon={<Clock className="h-4 w-4" />}
                      label="Pending"
                      value={stats.pendingPairs}
                      highlight={
                        stats.pendingPairs >= config.minSamplesBeforeTraining
                      }
                    />
                    <StatCard
                      icon={<ThumbsUp className="h-4 w-4 text-green-500" />}
                      label="Positive"
                      value={stats.positivePairs}
                    />
                    <StatCard
                      icon={<ThumbsDown className="h-4 w-4 text-red-500" />}
                      label="Negative"
                      value={stats.negativePairs}
                    />
                  </div>

                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>
                      <strong>{stats.correctedPairs}</strong> corrections
                    </span>
                    <span>
                      <strong>{stats.totalRuns}</strong> training runs
                    </span>
                    {stats.lastRunAt && (
                      <span>
                        Last run{" "}
                        {formatDistanceToNow(new Date(stats.lastRunAt), {
                          addSuffix: true,
                        })}
                      </span>
                    )}
                  </div>

                  {stats.pendingPairs > 0 &&
                    stats.pendingPairs < config.minSamplesBeforeTraining && (
                      <p className="text-xs text-muted-foreground">
                        Need{" "}
                        {config.minSamplesBeforeTraining - stats.pendingPairs}{" "}
                        more samples before training can start
                      </p>
                    )}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Run History */}
          {runs && runs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Training History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {runs.slice(0, 5).map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                    >
                      <div className="flex items-center gap-2">
                        {run.status === "completed" ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : run.status === "failed" ? (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        ) : run.status === "training" ? (
                          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                        ) : (
                          <Clock className="h-4 w-4 text-gray-400" />
                        )}
                        <span className="text-sm">
                          {run.trainingSamplesCount} samples
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {run.status}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(run.startedAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`p-3 rounded-lg border ${
        highlight
          ? "border-green-500/50 bg-green-50 dark:bg-green-900/20"
          : "bg-muted/50"
      }`}
    >
      <div className="flex items-center gap-1 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-lg font-semibold">{value}</span>
    </div>
  );
}
