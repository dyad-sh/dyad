// =============================================================================
// Data Studio Page — transform pipeline: clean, dedupe, redact, label
// =============================================================================

import { useState } from "react";
import {
  useVaultAssets,
  useTransformJobs,
  useCreateTransformJob,
  useRunTransformJob,
} from "../../hooks/useLocalVault";
import type { TransformStageConfig } from "../../types/local_vault";
import { VaultNav, VaultLockGate } from "./VaultNav";
import { formatBytes } from "../../lib/vault_utils";
import {
  Wand2,
  Play,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Shield,
  Tag,
  Layers,
  Eraser,
  Filter,
  Plus,
} from "lucide-react";

const DEFAULT_STAGES: TransformStageConfig[] = [
  {
    stage: "extract",
    enabled: true,
    config: { parsePdf: true, parseHtml: true, parseMarkdown: true, extractMetadata: true },
  },
  {
    stage: "normalize",
    enabled: true,
    config: { trimWhitespace: true, normalizeNewlines: true, removeHtmlTags: false },
  },
  {
    stage: "deduplicate",
    enabled: true,
    config: { method: "exact_hash", keepStrategy: "first" },
  },
  {
    stage: "redact",
    enabled: true,
    config: {
      detectEmails: true,
      detectPhones: true,
      detectApiKeys: true,
      detectSsn: true,
      detectCreditCards: true,
      redactionMethod: "mask",
      requireUserApproval: false,
    },
  },
  {
    stage: "label",
    enabled: true,
    config: { autoTag: true, autoCategory: true, sentimentAnalysis: false },
  },
];

export default function DataStudioPage() {
  const { data: assetsResult } = useVaultAssets({ status: "ingested", limit: 200 });
  const { data: readyAssetsResult } = useVaultAssets({ status: "ready", limit: 200 });
  const { data: jobs = [] } = useTransformJobs();
  const createJob = useCreateTransformJob();
  const runJob = useRunTransformJob();

  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [stages, setStages] = useState<TransformStageConfig[]>(DEFAULT_STAGES);
  const [jobName, setJobName] = useState("Transform Pipeline");

  const ingestedAssets = assetsResult?.assets ?? [];
  const readyAssets = readyAssetsResult?.assets ?? [];

  const toggleAsset = (id: string) => {
    setSelectedAssetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const selectAll = () => {
    setSelectedAssetIds(ingestedAssets.map((a) => a.id));
  };

  const handleCreateAndRun = async () => {
    if (selectedAssetIds.length === 0) return;
    const job = await createJob.mutateAsync({
      name: jobName,
      inputAssetIds: selectedAssetIds,
      stages,
    });
    await runJob.mutateAsync(job.id);
    setSelectedAssetIds([]);
  };

  const toggleStage = (index: number) => {
    setStages((prev) =>
      prev.map((s, i) => (i === index ? { ...s, enabled: !s.enabled } : s)),
    );
  };

  return (
    <VaultLockGate>
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Vault Tab Navigation */}
      <VaultNav />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wand2 className="w-7 h-7 text-primary" />
          Data Studio
        </h1>
        <p className="text-muted-foreground mt-1">
          Clean, deduplicate, redact, and label your data — all locally
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left: Select assets + configure pipeline */}
        <div className="space-y-4">
          {/* Select Assets */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Select Assets ({selectedAssetIds.length}/{ingestedAssets.length})
              </h2>
              <button onClick={selectAll} className="text-xs text-primary hover:underline">
                Select All
              </button>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1">
              {ingestedAssets.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No ingested assets to transform. Import data in the Vault first.
                </p>
              ) : (
                ingestedAssets.map((asset) => (
                  <label
                    key={asset.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAssetIds.includes(asset.id)}
                      onChange={() => toggleAsset(asset.id)}
                      className="rounded"
                    />
                    <span className="text-sm truncate flex-1">{asset.name}</span>
                    <span className="text-xs text-muted-foreground">{formatBytes(asset.byteSize)}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Pipeline Stages */}
          <div className="border rounded-lg p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Pipeline Stages
            </h2>

            {stages.map((stage, i) => (
              <div
                key={stage.stage}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${
                  stage.enabled ? "border-primary/30 bg-primary/5" : "opacity-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={stage.enabled}
                  onChange={() => toggleStage(i)}
                  className="rounded"
                />
                <StageIcon stage={stage.stage} />
                <div className="flex-1">
                  <div className="font-medium text-sm capitalize">{stage.stage}</div>
                  <div className="text-xs text-muted-foreground">
                    {stageDescription(stage.stage)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Run */}
          <div className="space-y-2">
            <input
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              placeholder="Job name"
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
            />
            <button
              onClick={handleCreateAndRun}
              disabled={selectedAssetIds.length === 0 || createJob.isPending || runJob.isPending}
              className="w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {createJob.isPending || runJob.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Run Pipeline ({selectedAssetIds.length} assets)
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right: Job history + ready assets */}
        <div className="space-y-4">
          {/* Recent Jobs */}
          <div className="border rounded-lg p-4 space-y-3">
            <h2 className="font-semibold">Recent Transform Jobs</h2>
            {jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No jobs yet</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {jobs.map((job) => (
                  <div key={job.id} className="border rounded-lg p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{job.name}</span>
                      <JobStatusBadge status={job.status} />
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span>{job.itemsProcessed}/{job.itemsTotal} items</span>
                      <span>·</span>
                      <span>Progress: {job.progress}%</span>
                    </div>
                    {job.progress > 0 && (
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                    )}
                    {job.auditLogJson.length > 0 && (
                      <div className="text-xs space-y-0.5 mt-1">
                        {job.auditLogJson.map((entry, i) => (
                          <div key={i} className="text-muted-foreground">
                            ✓ {entry.stage}: {entry.details}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ready Assets */}
          <div className="border rounded-lg p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              Ready Assets ({readyAssets.length})
            </h2>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {readyAssets.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No processed assets yet. Run the pipeline above.
                </p>
              ) : (
                readyAssets.map((asset) => (
                  <div key={asset.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/30">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                    <span className="text-sm truncate flex-1">{asset.name}</span>
                    {asset.piiRedacted && (
                      <span title="PII redacted">
                        <Shield className="w-3.5 h-3.5 text-amber-500" />
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{formatBytes(asset.byteSize)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    </VaultLockGate>
  );
}

function StageIcon({ stage }: { stage: string }) {
  const cn = "w-4 h-4";
  switch (stage) {
    case "extract":
      return <FileText className={`${cn} text-blue-500`} />;
    case "normalize":
      return <Filter className={`${cn} text-cyan-500`} />;
    case "deduplicate":
      return <Layers className={`${cn} text-purple-500`} />;
    case "redact":
      return <Shield className={`${cn} text-amber-500`} />;
    case "label":
      return <Tag className={`${cn} text-green-500`} />;
    default:
      return <Wand2 className={`${cn} text-muted-foreground`} />;
  }
}

function stageDescription(stage: string): string {
  const descs: Record<string, string> = {
    extract: "Parse files, extract metadata (size, type, word count)",
    normalize: "Fix encoding, trim whitespace, normalize line endings",
    deduplicate: "Find and remove exact-hash duplicates",
    redact: "Detect & redact PII (emails, phones, SSNs, API keys)",
    label: "Auto-tag by modality, file type, and category",
  };
  return descs[stage] ?? stage;
}

function JobStatusBadge({ status }: { status: string }) {
  const styles: Record<string, { icon: React.ReactNode; className: string }> = {
    pending: { icon: <Clock className="w-3 h-3" />, className: "text-muted-foreground bg-muted" },
    running: { icon: <Loader2 className="w-3 h-3 animate-spin" />, className: "text-blue-500 bg-blue-500/10" },
    completed: { icon: <CheckCircle2 className="w-3 h-3" />, className: "text-green-500 bg-green-500/10" },
    failed: { icon: <XCircle className="w-3 h-3" />, className: "text-destructive bg-destructive/10" },
    cancelled: { icon: <XCircle className="w-3 h-3" />, className: "text-muted-foreground bg-muted" },
  };
  const s = styles[status] ?? styles.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>
      {s.icon}
      {status}
    </span>
  );
}


