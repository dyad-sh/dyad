import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Cpu } from "lucide-react";
import { AgentConfig, DEFAULT_COMPUTE_CONFIG } from "@/types/agent-compute";

interface AgentConfigStepProps {
  config: AgentConfig | null;
  onChange: (config: AgentConfig) => void;
}

export function AgentConfigStep({ config, onChange }: AgentConfigStepProps) {
  const current = config ?? {
    computeType: DEFAULT_COMPUTE_CONFIG.computeType,
    cpuCores: DEFAULT_COMPUTE_CONFIG.cpuCores,
    memoryGB: DEFAULT_COMPUTE_CONFIG.memoryGB,
    gpuType: DEFAULT_COMPUTE_CONFIG.gpuType,
    modelId: "",
    entrypoint: "main.py",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-5 w-5" />
          Agent Compute Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Compute Type</Label>
            <Select
              value={current.computeType}
              onValueChange={(v) => onChange({ ...current, computeType: v as AgentConfig["computeType"] })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cpu">CPU</SelectItem>
                <SelectItem value="gpu">GPU</SelectItem>
                <SelectItem value="serverless">Serverless</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>CPU Cores</Label>
            <Input
              type="number"
              value={current.cpuCores}
              onChange={(e) => onChange({ ...current, cpuCores: Number(e.target.value) })}
              min={1}
              max={32}
            />
          </div>
          <div className="space-y-2">
            <Label>Memory (GB)</Label>
            <Input
              type="number"
              value={current.memoryGB}
              onChange={(e) => onChange({ ...current, memoryGB: Number(e.target.value) })}
              min={1}
              max={128}
            />
          </div>
          <div className="space-y-2">
            <Label>Entrypoint</Label>
            <Input
              value={current.entrypoint}
              onChange={(e) => onChange({ ...current, entrypoint: e.target.value })}
              placeholder="main.py"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
