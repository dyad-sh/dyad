// =============================================================================
// Web Scraper Page — full-featured scraping UI with templates, preview, jobs
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { IpcClient } from "../../ipc/ipc_client";
import {
  Search,
  Play,
  Pause,
  StopCircle,
  Trash2,
  Eye,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Globe,
  FileJson,
  Image,
  Music,
  Video,
  Tag,
  Sparkles,
  Settings2,
  List,
  Grid3X3,
  ArrowLeft,
  Bot,
  Rss,
  Map,
  Wand2,
  Send,
} from "lucide-react";

// ── Types (mirror the engine types) ─────────────────────────────────────────

interface ScrapingTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  config: Record<string, unknown>;
  fields?: ScrapingField[];
  sampleOutput?: Record<string, unknown>;
  isBuiltin?: boolean;
}

interface ScrapingField {
  id: string;
  name: string;
  type: string;
  selectorStrategy?: string;
  selector?: string;
  attribute?: string;
  transform?: string;
  required?: boolean;
}

interface ScrapingJob {
  id: string;
  name: string;
  datasetId?: string;
  templateId?: string;
  status: string;
  config: Record<string, unknown>;
  progress: { total: number; completed: number; failed: number; skipped: number; currentUrl?: string };
  errors: Array<{ url: string; message: string; timestamp: string }>;
  stats: { pagesScraped: number; itemsExtracted: number; bytesDownloaded: number; mediaDownloaded: number; durationMs: number; averagePageTimeMs: number };
  startedAt?: string;
  completedAt?: string;
}

// ── IPC helpers ─────────────────────────────────────────────────────────────

const ipc = IpcClient.getInstance();

async function ipcInvoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return (window as any).electron.ipcRenderer.invoke(channel, ...args);
}

// ── Component ───────────────────────────────────────────────────────────────

type Tab = "scrape" | "jobs" | "templates";

export default function WebScraperPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("scrape");

  // init engine on mount
  useEffect(() => {
    ipcInvoke("scraping:init").catch(() => {});
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Search className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Web Scraper</h1>
            <p className="text-sm text-muted-foreground">
              Scrape websites, feeds, and sitemaps — AI-powered extraction & auto-tagging
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Wizard button */}
          <button
            onClick={() => navigate({ to: "/local-vault/scrape-wizard" })}
            className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-purple-500 text-white text-sm font-medium flex items-center gap-2 hover:opacity-90 transition-opacity"
          >
            <Wand2 className="w-4 h-4" />
            Wizard
          </button>

          {/* Tabs */}
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            {(["scrape", "jobs", "templates"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  tab === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "scrape" ? "Scrape" : t === "jobs" ? "Jobs" : "Templates"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        {tab === "scrape" && <ScrapeTab />}
        {tab === "jobs" && <JobsTab />}
        {tab === "templates" && <TemplatesTab />}
      </div>
    </div>
  );
}

// ── Scrape Tab ──────────────────────────────────────────────────────────────

function ScrapeTab() {
  const [url, setUrl] = useState("");
  const [sourceType, setSourceType] = useState<"web" | "rss" | "sitemap">("web");
  const [mode, setMode] = useState<"http" | "playwright" | "hybrid">("hybrid");
  const [templateId, setTemplateId] = useState<string>("");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [tagEnabled, setTagEnabled] = useState(true);
  const [crawlEnabled, setCrawlEnabled] = useState(false);
  const [crawlDepth, setCrawlDepth] = useState(2);
  const [crawlMaxPages, setCrawlMaxPages] = useState(50);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [previewResult, setPreviewResult] = useState<any>(null);

  // NLP bar state
  const [nlpQuery, setNlpQuery] = useState("");
  const [nlpLoading, setNlpLoading] = useState(false);
  const [nlpError, setNlpError] = useState<string | null>(null);

  const handleNlpSubmit = useCallback(async () => {
    if (!nlpQuery.trim()) return;
    setNlpLoading(true);
    setNlpError(null);
    try {
      const result = await ipcInvoke("scraping:nlp-configure", { query: nlpQuery }) as any;
      if (result.url) setUrl(result.url);
      if (result.sourceType) setSourceType(result.sourceType);
      if (result.mode) setMode(result.mode);
      if (result.templateId) setTemplateId(result.templateId);
      if (result.aiExtraction !== undefined) setAiEnabled(result.aiExtraction);
      if (result.crawl !== undefined) setCrawlEnabled(result.crawl);
      if (result.crawlDepth !== undefined) setCrawlDepth(result.crawlDepth);
      if (result.crawlMaxPages !== undefined) setCrawlMaxPages(result.crawlMaxPages);
      if (result.autoTag !== undefined) setTagEnabled(result.autoTag);
      // Auto-run if the NLP handler says so
      if (result.autoRun && result.url) {
        // trigger scrape after a short delay for state to settle
        setTimeout(() => {
          const btn = document.querySelector("[data-scrape-btn]") as HTMLButtonElement;
          if (btn) btn.click();
        }, 200);
      }
    } catch (err) {
      setNlpError((err as Error).message);
    } finally {
      setNlpLoading(false);
    }
  }, [nlpQuery]);

  const { data: templates = [] } = useQuery({
    queryKey: ["scraping-templates"],
    queryFn: () => ipcInvoke("scraping:templates") as Promise<ScrapingTemplate[]>,
  });

  const previewMut = useMutation({
    mutationFn: async () => {
      return ipcInvoke("scraping:preview", {
        url,
        templateId: templateId || undefined,
        config: {
          sourceType,
          mode,
          urls: [url],
          aiExtraction: aiEnabled ? { enabled: true } : undefined,
          autoTag: { enabled: tagEnabled },
          crawl: crawlEnabled ? { enabled: true, maxDepth: crawlDepth, maxPages: crawlMaxPages } : undefined,
        },
      }) as Promise<any>;
    },
    onSuccess: (result) => setPreviewResult(result),
  });

  const scrapeMut = useMutation({
    mutationFn: async () => {
      return ipcInvoke("scraping:scrape-url", {
        url,
        templateId: templateId || undefined,
        config: {
          sourceType,
          mode,
          urls: [url],
          aiExtraction: aiEnabled ? { enabled: true } : undefined,
          autoTag: { enabled: tagEnabled },
          crawl: crawlEnabled ? { enabled: true, maxDepth: crawlDepth, maxPages: crawlMaxPages } : undefined,
        },
      }) as Promise<ScrapingJob>;
    },
  });

  const selectedTemplate = templates.find((t) => t.id === templateId);

  return (
    <div className="space-y-6 mx-auto">
      {/* NLP Bar — "Just tell it what you want" */}
      <div className="p-4 rounded-xl border-2 border-dashed border-primary/30 bg-gradient-to-r from-primary/5 to-violet-500/5">
        <div className="flex items-center gap-2 mb-2">
          <Bot className="w-5 h-5 text-primary" />
          <span className="text-sm font-semibold">Smart Scrape</span>
          <span className="text-xs text-muted-foreground">— Describe what you want in plain English</span>
        </div>
        <div className="flex gap-2">
          <input
            value={nlpQuery}
            onChange={(e) => setNlpQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleNlpSubmit()}
            placeholder='e.g. "Scrape all product listings from amazon.com/bestsellers and extract prices, ratings, titles"'
            className="flex-1 px-4 py-2.5 rounded-lg border bg-background text-sm"
            disabled={nlpLoading}
          />
          <button
            onClick={handleNlpSubmit}
            disabled={!nlpQuery.trim() || nlpLoading}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {nlpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Go
          </button>
        </div>
        {nlpError && (
          <p className="text-xs text-destructive mt-2 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> {nlpError}
          </p>
        )}
      </div>

      {/* URL Input */}
      <div className="space-y-2">
        <label className="text-sm font-medium">URL to Scrape</label>
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/page-to-scrape"
            className="flex-1 px-4 py-2.5 rounded-lg border bg-background text-sm"
          />
          <button
            onClick={() => previewMut.mutate()}
            disabled={!url || previewMut.isPending}
            className="px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {previewMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            Preview
          </button>
          <button
            data-scrape-btn
            onClick={() => scrapeMut.mutate()}
            disabled={!url || scrapeMut.isPending}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {scrapeMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Scrape
          </button>
        </div>
      </div>

      {/* Source & Mode row */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="text-sm font-medium">Source Type</label>
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as any)}
            className="w-full px-3 py-2 rounded-lg border bg-background mt-1 text-sm"
          >
            <option value="web">Web Page</option>
            <option value="rss">RSS / Atom Feed</option>
            <option value="sitemap">Sitemap</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">Fetch Mode</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as any)}
            className="w-full px-3 py-2 rounded-lg border bg-background mt-1 text-sm"
          >
            <option value="hybrid">Hybrid (HTTP + Playwright fallback)</option>
            <option value="http">HTTP Only (fast)</option>
            <option value="playwright">Playwright Only (JS rendering)</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">Template</label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-background mt-1 text-sm"
          >
            <option value="">None (auto-detect)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Toggle row */}
      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} className="rounded" />
          <Sparkles className="w-4 h-4 text-amber-500" />
          AI Extraction
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={tagEnabled} onChange={(e) => setTagEnabled(e.target.checked)} className="rounded" />
          <Tag className="w-4 h-4 text-blue-500" />
          Auto-Tag
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={crawlEnabled} onChange={(e) => setCrawlEnabled(e.target.checked)} className="rounded" />
          <Globe className="w-4 h-4 text-green-500" />
          Crawl Site
        </label>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="ml-auto text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <Settings2 className="w-4 h-4" />
          Advanced
          {showAdvanced ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
      </div>

      {/* Advanced Settings */}
      {showAdvanced && (
        <div className="p-4 border rounded-lg bg-muted/20 space-y-4">
          {crawlEnabled && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Max Crawl Depth</label>
                <input
                  type="number"
                  value={crawlDepth}
                  onChange={(e) => setCrawlDepth(Number(e.target.value))}
                  min={1}
                  max={10}
                  className="w-full px-3 py-2 rounded-lg border bg-background mt-1 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Max Pages</label>
                <input
                  type="number"
                  value={crawlMaxPages}
                  onChange={(e) => setCrawlMaxPages(Number(e.target.value))}
                  min={1}
                  max={10000}
                  className="w-full px-3 py-2 rounded-lg border bg-background mt-1 text-sm"
                />
              </div>
            </div>
          )}
          {selectedTemplate && (
            <div>
              <h4 className="text-sm font-medium mb-2">Template Fields ({selectedTemplate.fields?.length ?? 0})</h4>
              <div className="grid grid-cols-2 gap-2">
                {selectedTemplate.fields?.map((f) => (
                  <div key={f.id} className="text-xs p-2 border rounded bg-background">
                    <span className="font-medium">{f.name}</span>
                    <span className="text-muted-foreground ml-2">({f.type})</span>
                    {f.required && <span className="text-red-500 ml-1">*</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {scrapeMut.isSuccess && scrapeMut.data && (
        <div className="p-4 border rounded-lg bg-green-500/5 border-green-500/20">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <h3 className="font-medium text-green-700 dark:text-green-400">Scrape Complete</h3>
          </div>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Pages:</span>{" "}
              <span className="font-medium">{scrapeMut.data.stats.pagesScraped}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Items:</span>{" "}
              <span className="font-medium">{scrapeMut.data.stats.itemsExtracted}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Media:</span>{" "}
              <span className="font-medium">{scrapeMut.data.stats.mediaDownloaded}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Duration:</span>{" "}
              <span className="font-medium">{(scrapeMut.data.stats.durationMs / 1000).toFixed(1)}s</span>
            </div>
          </div>
          {scrapeMut.data.datasetId && (
            <p className="text-xs text-muted-foreground mt-2">
              Dataset ID: {scrapeMut.data.datasetId}
            </p>
          )}
        </div>
      )}

      {scrapeMut.isError && (
        <div className="p-4 border rounded-lg bg-red-500/5 border-red-500/20">
          <div className="flex items-center gap-2">
            <XCircle className="w-5 h-5 text-red-500" />
            <span className="text-sm text-red-700 dark:text-red-400">
              {(scrapeMut.error as Error).message}
            </span>
          </div>
        </div>
      )}

      {/* Preview Panel */}
      {previewResult && (
        <PreviewPanel result={previewResult} onClose={() => setPreviewResult(null)} />
      )}
    </div>
  );
}

// ── Preview Panel ───────────────────────────────────────────────────────────

function PreviewPanel({ result, onClose }: { result: any; onClose: () => void }) {
  const page = result.page;
  const tags = result.tagResults;

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-muted/30 border-b flex items-center justify-between">
        <h3 className="font-medium text-sm flex items-center gap-2">
          <Eye className="w-4 h-4" />
          Preview: {page?.title || result.url}
        </h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <XCircle className="w-4 h-4" />
        </button>
      </div>
      <div className="p-4 space-y-4 max-h-96 overflow-auto text-sm">
        {/* Metadata */}
        {page?.metadata && (
          <div className="space-y-1">
            <h4 className="font-medium text-xs uppercase text-muted-foreground">Metadata</h4>
            <pre className="text-xs bg-muted/30 p-2 rounded overflow-auto max-h-32">
              {JSON.stringify(page.metadata, null, 2)}
            </pre>
          </div>
        )}

        {/* Tags */}
        {tags && (
          <div className="space-y-1">
            <h4 className="font-medium text-xs uppercase text-muted-foreground">Auto Tags</h4>
            <div className="flex flex-wrap gap-1">
              {tags.domainCategory && (
                <span className="px-2 py-0.5 bg-blue-500/10 text-blue-600 rounded-full text-xs">{tags.domainCategory}</span>
              )}
              {tags.contentType && (
                <span className="px-2 py-0.5 bg-green-500/10 text-green-600 rounded-full text-xs">{tags.contentType}</span>
              )}
              {tags.keywords?.slice(0, 10).map((k: string) => (
                <span key={k} className="px-2 py-0.5 bg-muted rounded-full text-xs">{k}</span>
              ))}
            </div>
          </div>
        )}

        {/* Images */}
        {page?.images?.length > 0 && (
          <div className="space-y-1">
            <h4 className="font-medium text-xs uppercase text-muted-foreground">
              Images ({page.images.length})
            </h4>
            <div className="flex gap-2 flex-wrap">
              {page.images.slice(0, 6).map((img: any, i: number) => (
                <div key={i} className="w-20 h-20 bg-muted rounded overflow-hidden">
                  <img src={img.url} alt={img.alt || ""} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Structured Data */}
        {page?.structuredData?.length > 0 && (
          <div className="space-y-1">
            <h4 className="font-medium text-xs uppercase text-muted-foreground">
              Structured Data ({page.structuredData.length})
            </h4>
            <pre className="text-xs bg-muted/30 p-2 rounded overflow-auto max-h-32">
              {JSON.stringify(page.structuredData, null, 2)}
            </pre>
          </div>
        )}

        {/* Content preview */}
        <div className="space-y-1">
          <h4 className="font-medium text-xs uppercase text-muted-foreground">Content Preview</h4>
          <div className="text-xs bg-muted/30 p-2 rounded max-h-48 overflow-auto whitespace-pre-wrap">
            {page?.content?.slice(0, 2000) || "No content extracted"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Jobs Tab ────────────────────────────────────────────────────────────────

function JobsTab() {
  const queryClient = useQueryClient();

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["scraping-jobs"],
    queryFn: () => ipcInvoke("scraping:list-jobs") as Promise<ScrapingJob[]>,
    refetchInterval: 3000,
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => ipcInvoke("scraping:cancel-job", id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scraping-jobs"] }),
  });

  const pauseMut = useMutation({
    mutationFn: (id: string) => ipcInvoke("scraping:pause-job", id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scraping-jobs"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => ipcInvoke("scraping:delete-job", id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scraping-jobs"] }),
  });

  const resumeMut = useMutation({
    mutationFn: (id: string) => ipcInvoke("scraping:start-job", id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scraping-jobs"] }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="text-lg font-medium">No scraping jobs yet</p>
        <p className="text-sm">Start a scrape from the Scrape tab to create your first job</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 mx-auto">
      {jobs.map((job) => (
        <div key={job.id} className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <StatusBadge status={job.status} />
              <h3 className="font-medium text-sm">{job.name}</h3>
            </div>
            <div className="flex items-center gap-1">
              {job.status === "running" && (
                <button onClick={() => pauseMut.mutate(job.id)} className="p-1.5 hover:bg-muted rounded">
                  <Pause className="w-4 h-4" />
                </button>
              )}
              {(job.status === "paused" || job.status === "pending") && (
                <button onClick={() => resumeMut.mutate(job.id)} className="p-1.5 hover:bg-muted rounded">
                  <Play className="w-4 h-4" />
                </button>
              )}
              {(job.status === "running" || job.status === "paused") && (
                <button onClick={() => cancelMut.mutate(job.id)} className="p-1.5 hover:bg-muted rounded text-red-500">
                  <StopCircle className="w-4 h-4" />
                </button>
              )}
              {(job.status === "completed" || job.status === "failed" || job.status === "cancelled") && (
                <button onClick={() => deleteMut.mutate(job.id)} className="p-1.5 hover:bg-muted rounded text-red-500">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {job.progress.total > 0 && (
            <div className="mb-2">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${((job.progress.completed + job.progress.failed + job.progress.skipped) / job.progress.total) * 100}%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>
                  {job.progress.completed}/{job.progress.total} completed
                  {job.progress.failed > 0 && `, ${job.progress.failed} failed`}
                  {job.progress.skipped > 0 && `, ${job.progress.skipped} skipped`}
                </span>
                {job.progress.currentUrl && (
                  <span className="truncate ml-4 max-w-xs" title={job.progress.currentUrl}>
                    {job.progress.currentUrl}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Stats row */}
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>{job.stats.pagesScraped} pages</span>
            <span>{job.stats.itemsExtracted} items</span>
            <span>{job.stats.mediaDownloaded} media</span>
            <span>{formatBytes(job.stats.bytesDownloaded)}</span>
            {job.stats.durationMs > 0 && <span>{(job.stats.durationMs / 1000).toFixed(1)}s</span>}
          </div>

          {/* Errors */}
          {job.errors.length > 0 && (
            <div className="mt-2 border-t pt-2">
              <details>
                <summary className="text-xs text-red-500 cursor-pointer">
                  {job.errors.length} error(s)
                </summary>
                <div className="mt-1 space-y-1">
                  {job.errors.slice(0, 5).map((err, i) => (
                    <div key={i} className="text-xs text-red-400 truncate">
                      {err.url}: {err.message}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Templates Tab ───────────────────────────────────────────────────────────

function TemplatesTab() {
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["scraping-templates"],
    queryFn: () => ipcInvoke("scraping:templates") as Promise<ScrapingTemplate[]>,
  });

  const categories = [...new Set(templates.map((t) => t.category))];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 mx-auto">
      <p className="text-sm text-muted-foreground">
        {templates.length} built-in templates for common scraping scenarios. Select a template when creating a scrape to auto-configure selectors and field extraction.
      </p>

      {categories.map((cat) => (
        <div key={cat}>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase mb-2">{cat}</h3>
          <div className="grid grid-cols-2 gap-3">
            {templates
              .filter((t) => t.category === cat)
              .map((t) => (
                <div key={t.id} className="border rounded-lg p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="text-primary mt-0.5">
                      <TemplateIcon name={t.icon} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm">{t.name}</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                      {t.fields && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {t.fields.slice(0, 5).map((f) => (
                            <span key={f.id} className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
                              {f.name}
                            </span>
                          ))}
                          {t.fields.length > 5 && (
                            <span className="text-[10px] text-muted-foreground">+{t.fields.length - 5} more</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Utility components ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; icon: React.ReactNode }> = {
    pending: { color: "text-yellow-500", icon: <RefreshCw className="w-3 h-3" /> },
    running: { color: "text-blue-500", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    paused: { color: "text-amber-500", icon: <Pause className="w-3 h-3" /> },
    completed: { color: "text-green-500", icon: <CheckCircle2 className="w-3 h-3" /> },
    failed: { color: "text-red-500", icon: <XCircle className="w-3 h-3" /> },
    cancelled: { color: "text-muted-foreground", icon: <StopCircle className="w-3 h-3" /> },
  };
  const entry = map[status] ?? map.pending;

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${entry.color}`}>
      {entry.icon}
      {status}
    </span>
  );
}

function TemplateIcon({ name }: { name: string }) {
  const icons: Record<string, React.ReactNode> = {
    ShoppingCart: <Grid3X3 className="w-5 h-5" />,
    Newspaper: <FileJson className="w-5 h-5" />,
    Users: <Globe className="w-5 h-5" />,
    Briefcase: <List className="w-5 h-5" />,
    Star: <Sparkles className="w-5 h-5" />,
    GraduationCap: <Bot className="w-5 h-5" />,
    Home: <Globe className="w-5 h-5" />,
    ChefHat: <Tag className="w-5 h-5" />,
    Calendar: <RefreshCw className="w-5 h-5" />,
    Building: <Globe className="w-5 h-5" />,
    MessageSquare: <Search className="w-5 h-5" />,
    Landmark: <Globe className="w-5 h-5" />,
    Trophy: <Sparkles className="w-5 h-5" />,
    DollarSign: <FileJson className="w-5 h-5" />,
    Headphones: <Music className="w-5 h-5" />,
    Rss: <Rss className="w-5 h-5" />,
  };
  return <>{icons[name] ?? <Globe className="w-5 h-5" />}</>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
