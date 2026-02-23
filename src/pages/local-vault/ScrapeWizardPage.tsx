// =============================================================================
// Scrape Wizard Page — 6-step guided flow from NLP to marketplace-ready
// Steps: Describe → Configure → Preview → Scrape → Review → Package
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Eye,
  Globe,
  Loader2,
  Package,
  Play,
  Search,
  Send,
  Settings2,
  Sparkles,
  Tag,
  Wand2,
  XCircle,
  AlertTriangle,
  FileJson,
  BarChart3,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

interface ScrapingTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  config: Record<string, unknown>;
  fields?: Array<{ id: string; name: string; type: string }>;
}

interface ScrapingJob {
  id: string;
  name: string;
  datasetId?: string;
  status: string;
  progress: { total: number; completed: number; failed: number; skipped: number; currentUrl?: string };
  errors: Array<{ url: string; message: string }>;
  stats: { pagesScraped: number; itemsExtracted: number; bytesDownloaded: number; mediaDownloaded: number; durationMs: number };
}

interface NlpConfig {
  url?: string;
  sourceType?: string;
  mode?: string;
  templateId?: string;
  aiExtraction?: boolean;
  crawl?: boolean;
  crawlDepth?: number;
  crawlMaxPages?: number;
  autoTag?: boolean;
  autoRun?: boolean;
  description?: string;
}

// ── IPC helper ──────────────────────────────────────────────────────────────

async function ipcInvoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return (window as any).electron.ipcRenderer.invoke(channel, ...args);
}

// ── Steps ───────────────────────────────────────────────────────────────────

const STEPS = [
  { id: "describe", label: "Describe", icon: Bot },
  { id: "configure", label: "Configure", icon: Settings2 },
  { id: "preview", label: "Preview", icon: Eye },
  { id: "scrape", label: "Scrape", icon: Play },
  { id: "review", label: "Review", icon: BarChart3 },
  { id: "package", label: "Package", icon: Package },
] as const;

type StepId = (typeof STEPS)[number]["id"];

// ── Main Component ──────────────────────────────────────────────────────────

export default function ScrapeWizardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState<StepId>("describe");
  const stepIndex = STEPS.findIndex((s) => s.id === currentStep);

  // Shared wizard state
  const [nlpQuery, setNlpQuery] = useState("");
  const [config, setConfig] = useState<NlpConfig>({});
  const [url, setUrl] = useState("");
  const [sourceType, setSourceType] = useState<"web" | "rss" | "sitemap">("web");
  const [mode, setMode] = useState<"http" | "playwright" | "hybrid">("hybrid");
  const [templateId, setTemplateId] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [tagEnabled, setTagEnabled] = useState(true);
  const [crawlEnabled, setCrawlEnabled] = useState(false);
  const [crawlMaxPages, setCrawlMaxPages] = useState(20);
  const [datasetName, setDatasetName] = useState("");

  // Scraping state
  const [previewResult, setPreviewResult] = useState<any>(null);
  const [scrapeJob, setScrapeJob] = useState<ScrapingJob | null>(null);

  // Packaging state
  const [packageName, setPackageName] = useState("");
  const [packageDesc, setPackageDesc] = useState("");
  const [license, setLicense] = useState("cc-by-4.0");
  const [pricingModel, setPricingModel] = useState("free");
  const [price, setPrice] = useState(0);
  const [packageTags, setPackageTags] = useState("scraped, web-data");
  const [packageResult, setPackageResult] = useState<any>(null);

  // Init engine
  useEffect(() => {
    ipcInvoke("scraping:init").catch(() => {});
  }, []);

  const goNext = () => {
    const next = STEPS[stepIndex + 1];
    if (next) setCurrentStep(next.id);
  };

  const goPrev = () => {
    const prev = STEPS[stepIndex - 1];
    if (prev) setCurrentStep(prev.id);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate({ to: "/local-vault/web-scraper" })}
            className="p-1 rounded hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Wand2 className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Scrape Wizard</h1>
            <p className="text-sm text-muted-foreground">
              NLP to marketplace-ready in 6 steps
            </p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mt-4">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            const isActive = i === stepIndex;
            const isCompleted = i < stepIndex;
            return (
              <div key={step.id} className="flex items-center">
                {i > 0 && (
                  <div
                    className={`h-0.5 w-8 mx-1 rounded ${
                      isCompleted ? "bg-primary" : "bg-muted"
                    }`}
                  />
                )}
                <button
                  onClick={() => i <= stepIndex && setCurrentStep(step.id)}
                  disabled={i > stepIndex}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isCompleted
                        ? "bg-primary/10 text-primary cursor-pointer"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <Icon className="w-3.5 h-3.5" />
                  )}
                  {step.label}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto">
          {currentStep === "describe" && (
            <DescribeStep
              nlpQuery={nlpQuery}
              setNlpQuery={setNlpQuery}
              onConfigured={(cfg) => {
                setConfig(cfg);
                if (cfg.url) setUrl(cfg.url);
                if (cfg.sourceType) setSourceType(cfg.sourceType as any);
                if (cfg.mode) setMode(cfg.mode as any);
                if (cfg.templateId) setTemplateId(cfg.templateId);
                if (cfg.aiExtraction !== undefined) setAiEnabled(cfg.aiExtraction);
                if (cfg.crawl !== undefined) setCrawlEnabled(cfg.crawl);
                if (cfg.crawlMaxPages !== undefined) setCrawlMaxPages(cfg.crawlMaxPages);
                if (cfg.autoTag !== undefined) setTagEnabled(cfg.autoTag);
                try {
                  const host = new URL(cfg.url ?? "").hostname;
                  setDatasetName(`Scraped: ${host}`);
                  setPackageName(`${host} dataset`);
                } catch {
                  setDatasetName("Scraped Dataset");
                  setPackageName("Scraped Dataset");
                }
                goNext();
              }}
            />
          )}

          {currentStep === "configure" && (
            <ConfigureStep
              url={url}
              setUrl={setUrl}
              sourceType={sourceType}
              setSourceType={setSourceType}
              mode={mode}
              setMode={setMode}
              templateId={templateId}
              setTemplateId={setTemplateId}
              aiEnabled={aiEnabled}
              setAiEnabled={setAiEnabled}
              tagEnabled={tagEnabled}
              setTagEnabled={setTagEnabled}
              crawlEnabled={crawlEnabled}
              setCrawlEnabled={setCrawlEnabled}
              crawlMaxPages={crawlMaxPages}
              setCrawlMaxPages={setCrawlMaxPages}
              datasetName={datasetName}
              setDatasetName={setDatasetName}
              onNext={goNext}
              onPrev={goPrev}
            />
          )}

          {currentStep === "preview" && (
            <PreviewStep
              url={url}
              sourceType={sourceType}
              mode={mode}
              templateId={templateId}
              aiEnabled={aiEnabled}
              tagEnabled={tagEnabled}
              crawlEnabled={crawlEnabled}
              crawlMaxPages={crawlMaxPages}
              previewResult={previewResult}
              setPreviewResult={setPreviewResult}
              onNext={goNext}
              onPrev={goPrev}
            />
          )}

          {currentStep === "scrape" && (
            <ScrapeStep
              url={url}
              sourceType={sourceType}
              mode={mode}
              templateId={templateId}
              aiEnabled={aiEnabled}
              tagEnabled={tagEnabled}
              crawlEnabled={crawlEnabled}
              crawlMaxPages={crawlMaxPages}
              scrapeJob={scrapeJob}
              setScrapeJob={setScrapeJob}
              onNext={goNext}
              onPrev={goPrev}
            />
          )}

          {currentStep === "review" && (
            <ReviewStep
              scrapeJob={scrapeJob}
              onNext={() => {
                setPackageName(datasetName || "Scraped Dataset");
                setPackageDesc(
                  `Dataset scraped from ${url} containing ${scrapeJob?.stats.itemsExtracted ?? 0} items.`,
                );
                goNext();
              }}
              onPrev={goPrev}
            />
          )}

          {currentStep === "package" && (
            <PackageStep
              scrapeJob={scrapeJob}
              packageName={packageName}
              setPackageName={setPackageName}
              packageDesc={packageDesc}
              setPackageDesc={setPackageDesc}
              license={license}
              setLicense={setLicense}
              pricingModel={pricingModel}
              setPricingModel={setPricingModel}
              price={price}
              setPrice={setPrice}
              packageTags={packageTags}
              setPackageTags={setPackageTags}
              packageResult={packageResult}
              setPackageResult={setPackageResult}
              onPrev={goPrev}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 1: Describe ────────────────────────────────────────────────────────

function DescribeStep({
  nlpQuery,
  setNlpQuery,
  onConfigured,
}: {
  nlpQuery: string;
  setNlpQuery: (q: string) => void;
  onConfigured: (cfg: NlpConfig) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!nlpQuery.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = (await ipcInvoke("scraping:nlp-configure", {
        query: nlpQuery,
      })) as NlpConfig;
      onConfigured(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <Bot className="w-12 h-12 mx-auto text-primary" />
        <h2 className="text-2xl font-bold">What do you want to scrape?</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Describe what you want in plain English. The AI will configure the
          scraper for you. Or skip this step and configure manually.
        </p>
      </div>

      <div className="space-y-3">
        <textarea
          value={nlpQuery}
          onChange={(e) => setNlpQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder='e.g. "Scrape all product listings from amazon.com/bestsellers and extract prices, ratings, and titles"&#10;&#10;or: "Crawl the entire docs.example.com site and download all documentation pages"&#10;&#10;or: "Get the latest 50 articles from techcrunch.com RSS feed"'
          className="w-full px-4 py-3 rounded-lg border bg-background text-sm min-h-[120px] resize-none"
          disabled={loading}
        />

        {error && (
          <p className="text-sm text-destructive flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" /> {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={!nlpQuery.trim() || loading}
            className="flex-1 px-4 py-3 rounded-lg bg-primary text-primary-foreground font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Sparkles className="w-5 h-5" />
            )}
            Configure with AI
          </button>
          <button
            onClick={() =>
              onConfigured({ url: "", aiExtraction: true, autoTag: true })
            }
            className="px-4 py-3 rounded-lg border text-sm font-medium hover:bg-muted"
          >
            Skip — Configure Manually
          </button>
        </div>
      </div>

      {/* Quick examples */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
          Quick Examples
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            "Scrape product data from example-shop.com/products with prices and ratings",
            "Crawl all blog posts from blog.example.com and extract article text",
            "Get latest news from https://news.ycombinator.com",
            "Download all recipes from cooking-site.com/recipes with ingredients and steps",
          ].map((ex) => (
            <button
              key={ex}
              onClick={() => setNlpQuery(ex)}
              className="text-left text-xs p-3 rounded-lg border hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            >
              "{ex}"
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Configure ───────────────────────────────────────────────────────

function ConfigureStep({
  url, setUrl,
  sourceType, setSourceType,
  mode, setMode,
  templateId, setTemplateId,
  aiEnabled, setAiEnabled,
  tagEnabled, setTagEnabled,
  crawlEnabled, setCrawlEnabled,
  crawlMaxPages, setCrawlMaxPages,
  datasetName, setDatasetName,
  onNext, onPrev,
}: {
  url: string; setUrl: (v: string) => void;
  sourceType: string; setSourceType: (v: any) => void;
  mode: string; setMode: (v: any) => void;
  templateId: string; setTemplateId: (v: string) => void;
  aiEnabled: boolean; setAiEnabled: (v: boolean) => void;
  tagEnabled: boolean; setTagEnabled: (v: boolean) => void;
  crawlEnabled: boolean; setCrawlEnabled: (v: boolean) => void;
  crawlMaxPages: number; setCrawlMaxPages: (v: number) => void;
  datasetName: string; setDatasetName: (v: string) => void;
  onNext: () => void; onPrev: () => void;
}) {
  const { data: templates = [] } = useQuery({
    queryKey: ["scraping-templates"],
    queryFn: () => ipcInvoke("scraping:templates") as Promise<ScrapingTemplate[]>,
  });

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Settings2 className="w-5 h-5 text-primary" />
        Configure Scraping
      </h2>

      {/* URL */}
      <div className="space-y-1">
        <label className="text-sm font-medium">URL</label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          className="w-full px-4 py-2.5 rounded-lg border bg-background text-sm"
        />
      </div>

      {/* Dataset name */}
      <div className="space-y-1">
        <label className="text-sm font-medium">Dataset Name</label>
        <input
          value={datasetName}
          onChange={(e) => setDatasetName(e.target.value)}
          placeholder="My Scraped Dataset"
          className="w-full px-4 py-2.5 rounded-lg border bg-background text-sm"
        />
      </div>

      {/* Grid controls */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="text-sm font-medium">Source Type</label>
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
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
            onChange={(e) => setMode(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-background mt-1 text-sm"
          >
            <option value="hybrid">Hybrid</option>
            <option value="http">HTTP Only</option>
            <option value="playwright">Playwright</option>
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
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Toggles */}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} className="rounded" />
          <Sparkles className="w-4 h-4 text-amber-500" /> AI Extraction
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={tagEnabled} onChange={(e) => setTagEnabled(e.target.checked)} className="rounded" />
          <Tag className="w-4 h-4 text-blue-500" /> Auto-Tag
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={crawlEnabled} onChange={(e) => setCrawlEnabled(e.target.checked)} className="rounded" />
          <Globe className="w-4 h-4 text-green-500" /> Crawl Site
        </label>
      </div>

      {crawlEnabled && (
        <div className="space-y-1">
          <label className="text-sm font-medium">Max Pages to Crawl</label>
          <input
            type="number"
            value={crawlMaxPages}
            onChange={(e) => setCrawlMaxPages(Number(e.target.value))}
            min={1}
            max={1000}
            className="w-32 px-3 py-2 rounded-lg border bg-background text-sm"
          />
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t">
        <button onClick={onPrev} className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!url}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 disabled:opacity-50"
        >
          Continue <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Preview ─────────────────────────────────────────────────────────

function PreviewStep({
  url, sourceType, mode, templateId, aiEnabled, tagEnabled, crawlEnabled, crawlMaxPages,
  previewResult, setPreviewResult,
  onNext, onPrev,
}: {
  url: string; sourceType: string; mode: string; templateId: string;
  aiEnabled: boolean; tagEnabled: boolean; crawlEnabled: boolean; crawlMaxPages: number;
  previewResult: any; setPreviewResult: (r: any) => void;
  onNext: () => void; onPrev: () => void;
}) {
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
        },
      }) as Promise<any>;
    },
    onSuccess: setPreviewResult,
  });

  useEffect(() => {
    if (!previewResult) {
      previewMut.mutate();
    }
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Eye className="w-5 h-5 text-primary" />
        Preview
      </h2>

      {previewMut.isPending && (
        <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>Fetching preview of {url}...</span>
        </div>
      )}

      {previewMut.isError && (
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 text-sm">
          <p className="font-medium text-destructive flex items-center gap-2">
            <XCircle className="w-4 h-4" /> Preview failed
          </p>
          <p className="text-muted-foreground mt-1">{(previewMut.error as Error).message}</p>
          <button
            onClick={() => previewMut.mutate()}
            className="mt-2 text-xs text-primary hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {previewResult && (
        <div className="space-y-4">
          {/* Page info */}
          <div className="p-4 rounded-lg border bg-muted/20">
            <h3 className="font-medium">{previewResult.page?.title || "Untitled"}</h3>
            <p className="text-xs text-muted-foreground mt-1">{previewResult.url}</p>
            {previewResult.page?.excerpt && (
              <p className="text-sm text-muted-foreground mt-2 line-clamp-3">{previewResult.page.excerpt}</p>
            )}
          </div>

          {/* Extracted fields */}
          {previewResult.extractedFields && Object.keys(previewResult.extractedFields).length > 0 && (
            <div className="p-4 rounded-lg border">
              <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                <FileJson className="w-4 h-4" /> Extracted Fields
              </h3>
              <div className="space-y-1 text-xs font-mono bg-muted/50 p-3 rounded max-h-48 overflow-auto">
                {Object.entries(previewResult.extractedFields).map(([key, val]) => (
                  <div key={key}>
                    <span className="text-primary">{key}</span>: {JSON.stringify(val)?.slice(0, 100)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {previewResult.tagResults && (
            <div className="p-4 rounded-lg border">
              <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                <Tag className="w-4 h-4" /> Auto-Tags
              </h3>
              <div className="flex flex-wrap gap-1">
                {(previewResult.tagResults.keywords ?? []).slice(0, 20).map((kw: string) => (
                  <span key={kw} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs">
                    {kw}
                  </span>
                ))}
                {previewResult.tagResults.language && (
                  <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 text-xs">
                    {previewResult.tagResults.language}
                  </span>
                )}
                {previewResult.tagResults.contentType && (
                  <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 text-xs">
                    {previewResult.tagResults.contentType}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Content preview */}
          <div className="p-4 rounded-lg border">
            <h3 className="text-sm font-medium mb-2">Content Preview</h3>
            <div className="text-xs text-muted-foreground max-h-40 overflow-auto whitespace-pre-wrap bg-muted/30 p-3 rounded">
              {previewResult.page?.content?.slice(0, 2000) || "No content extracted"}
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t">
        <button onClick={onPrev} className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onNext}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2"
        >
          Start Scraping <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Step 4: Scrape ──────────────────────────────────────────────────────────

function ScrapeStep({
  url, sourceType, mode, templateId, aiEnabled, tagEnabled, crawlEnabled, crawlMaxPages,
  scrapeJob, setScrapeJob,
  onNext, onPrev,
}: {
  url: string; sourceType: string; mode: string; templateId: string;
  aiEnabled: boolean; tagEnabled: boolean; crawlEnabled: boolean; crawlMaxPages: number;
  scrapeJob: ScrapingJob | null; setScrapeJob: (j: ScrapingJob | null) => void;
  onNext: () => void; onPrev: () => void;
}) {
  const scrapeMut = useMutation({
    mutationFn: async () => {
      return ipcInvoke("scraping:scrape-url", {
        url,
        templateId: templateId || undefined,
        config: {
          sourceType,
          mode,
          urls: [url],
          aiExtraction: aiEnabled ? { enabled: true, summarize: true } : undefined,
          autoTag: {
            enabled: tagEnabled,
            detectSentiment: true,
            extractEntities: true,
            classifyTopics: true,
            assessQuality: true,
          },
          crawl: crawlEnabled
            ? { enabled: true, maxDepth: 3, maxPages: crawlMaxPages }
            : undefined,
        },
      }) as Promise<ScrapingJob>;
    },
    onSuccess: (job) => setScrapeJob(job),
  });

  useEffect(() => {
    if (!scrapeJob) {
      scrapeMut.mutate();
    }
  }, []);

  const isRunning = scrapeMut.isPending;
  const isDone = scrapeJob?.status === "completed" || scrapeJob?.status === "failed";

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Play className="w-5 h-5 text-primary" />
        Scraping
      </h2>

      {isRunning && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 py-8 justify-center text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <div>
              <p className="font-medium text-foreground">Scraping in progress...</p>
              <p className="text-sm">This may take a few moments depending on the site.</p>
            </div>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary animate-pulse rounded-full" style={{ width: "60%" }} />
          </div>
        </div>
      )}

      {scrapeMut.isError && (
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5">
          <p className="font-medium text-destructive flex items-center gap-2">
            <XCircle className="w-4 h-4" /> Scraping failed
          </p>
          <p className="text-sm text-muted-foreground mt-1">{(scrapeMut.error as Error).message}</p>
          <button
            onClick={() => scrapeMut.mutate()}
            className="mt-2 px-3 py-1 rounded border text-xs hover:bg-muted"
          >
            Retry
          </button>
        </div>
      )}

      {scrapeJob && isDone && (
        <div className="space-y-4">
          <div
            className={`p-4 rounded-lg border ${
              scrapeJob.status === "completed"
                ? "border-green-500/50 bg-green-500/5"
                : "border-destructive/50 bg-destructive/5"
            }`}
          >
            <p className="font-medium flex items-center gap-2">
              {scrapeJob.status === "completed" ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-500" /> Scraping Complete
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-destructive" /> Scraping Failed
                </>
              )}
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Pages Scraped", value: scrapeJob.stats.pagesScraped },
              { label: "Items Extracted", value: scrapeJob.stats.itemsExtracted },
              { label: "Media Downloaded", value: scrapeJob.stats.mediaDownloaded },
              {
                label: "Duration",
                value: `${(scrapeJob.stats.durationMs / 1000).toFixed(1)}s`,
              },
            ].map((stat) => (
              <div key={stat.label} className="p-3 rounded-lg border bg-muted/20 text-center">
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Errors */}
          {scrapeJob.errors.length > 0 && (
            <div className="p-3 rounded-lg border border-amber-500/50 bg-amber-500/5">
              <p className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                {scrapeJob.errors.length} error(s) during scraping
              </p>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                {scrapeJob.errors.slice(0, 3).map((e, i) => (
                  <p key={i}>• {e.url}: {e.message}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t">
        <button onClick={onPrev} className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!isDone || scrapeJob?.status !== "completed"}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 disabled:opacity-50"
        >
          Review Results <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Step 5: Review ──────────────────────────────────────────────────────────

function ReviewStep({
  scrapeJob,
  onNext,
  onPrev,
}: {
  scrapeJob: ScrapingJob | null;
  onNext: () => void;
  onPrev: () => void;
}) {
  if (!scrapeJob) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-primary" />
        Review Results
      </h2>

      <div className="p-4 rounded-lg border bg-muted/20">
        <h3 className="font-medium">{scrapeJob.name}</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Dataset ID: <span className="font-mono">{scrapeJob.datasetId}</span>
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-lg border text-center">
          <p className="text-3xl font-bold text-primary">{scrapeJob.stats.pagesScraped}</p>
          <p className="text-sm text-muted-foreground">Pages Scraped</p>
        </div>
        <div className="p-4 rounded-lg border text-center">
          <p className="text-3xl font-bold text-green-500">{scrapeJob.stats.itemsExtracted}</p>
          <p className="text-sm text-muted-foreground">Items Extracted</p>
        </div>
        <div className="p-4 rounded-lg border text-center">
          <p className="text-3xl font-bold text-blue-500">
            {(scrapeJob.stats.bytesDownloaded / 1024).toFixed(1)} KB
          </p>
          <p className="text-sm text-muted-foreground">Data Downloaded</p>
        </div>
      </div>

      {/* Quality summary */}
      <div className="p-4 rounded-lg border">
        <h3 className="text-sm font-medium mb-3">Pipeline Summary</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <span className="font-medium capitalize">{scrapeJob.status}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Duration</span>
            <span className="font-medium">
              {(scrapeJob.stats.durationMs / 1000).toFixed(1)}s
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Media Items</span>
            <span className="font-medium">{scrapeJob.stats.mediaDownloaded}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Errors</span>
            <span className={`font-medium ${scrapeJob.errors.length > 0 ? "text-amber-500" : "text-green-500"}`}>
              {scrapeJob.errors.length}
            </span>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-lg border border-primary/30 bg-primary/5">
        <p className="text-sm">
          <strong>Ready to package!</strong> The scraped data will be promoted to your Local Vault,
          packaged with integrity hashes, and prepared for marketplace listing.
        </p>
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t">
        <button onClick={onPrev} className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onNext}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-purple-500 text-white text-sm font-medium flex items-center gap-2"
        >
          <Package className="w-4 h-4" /> Package for Marketplace
        </button>
      </div>
    </div>
  );
}

// ── Step 6: Package ─────────────────────────────────────────────────────────

function PackageStep({
  scrapeJob,
  packageName, setPackageName,
  packageDesc, setPackageDesc,
  license, setLicense,
  pricingModel, setPricingModel,
  price, setPrice,
  packageTags, setPackageTags,
  packageResult, setPackageResult,
  onPrev,
}: {
  scrapeJob: ScrapingJob | null;
  packageName: string; setPackageName: (v: string) => void;
  packageDesc: string; setPackageDesc: (v: string) => void;
  license: string; setLicense: (v: string) => void;
  pricingModel: string; setPricingModel: (v: string) => void;
  price: number; setPrice: (v: number) => void;
  packageTags: string; setPackageTags: (v: string) => void;
  packageResult: any; setPackageResult: (r: any) => void;
  onPrev: () => void;
}) {
  const navigate = useNavigate();

  // Step 1: Promote to vault
  const promoteMut = useMutation({
    mutationFn: async () => {
      if (!scrapeJob?.datasetId) throw new Error("No dataset to promote");
      return ipcInvoke("local-vault:import:dataset-items", {
        datasetId: scrapeJob.datasetId,
        markReady: true,
        tags: packageTags.split(",").map((t) => t.trim()).filter(Boolean),
      }) as Promise<any>;
    },
  });

  // Step 2: Create package
  const packageMut = useMutation({
    mutationFn: async (vaultAssetIds: string[]) => {
      // Create package manifest
      const manifest = (await ipcInvoke("local-vault:package:create", {
        name: packageName,
        version: "1.0.0",
        description: packageDesc,
        assetIds: vaultAssetIds,
      })) as any;

      // Create policy
      const policy = (await ipcInvoke("local-vault:policy:create", {
        manifestId: manifest.id,
        licenseTiers: [
          {
            tier: "standard",
            enabled: true,
            price: pricingModel !== "free" ? price : 0,
            currency: "USD",
            description: `${license} — ${pricingModel} access`,
          },
        ],
        allowedUses: ["training", "research", "commercial"],
        restrictions: [],
        pricingModel,
        priceAmount: pricingModel !== "free" ? price : undefined,
        priceCurrency: "USD",
      })) as any;

      // Create publish bundle
      const bundle = (await ipcInvoke("local-vault:publish:create-bundle", {
        manifestId: manifest.id,
        policyId: policy.id,
        listing: {
          name: packageName,
          description: packageDesc,
          category: "datasets",
          tags: packageTags.split(",").map((t) => t.trim()).filter(Boolean),
          license,
          pricingModel,
          price: pricingModel !== "free" ? price : undefined,
          currency: "USD",
        },
        publisherWallet: "local-user",
      })) as any;

      return { manifest, policy, bundle };
    },
  });

  const handlePackage = async () => {
    try {
      const promoteResult = await promoteMut.mutateAsync();
      const result = await packageMut.mutateAsync(promoteResult.assetIds);
      setPackageResult(result);
    } catch {
      // Errors handled by mutation states
    }
  };

  const isProcessing = promoteMut.isPending || packageMut.isPending;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Package className="w-5 h-5 text-primary" />
        Package for Marketplace
      </h2>

      {!packageResult ? (
        <>
          {/* Package config */}
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Package Name</label>
              <input
                value={packageName}
                onChange={(e) => setPackageName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border bg-background text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={packageDesc}
                onChange={(e) => setPackageDesc(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border bg-background text-sm min-h-[80px] resize-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium">License</label>
                <select
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-background mt-1 text-sm"
                >
                  <option value="cc-by-4.0">CC BY 4.0</option>
                  <option value="cc-by-sa-4.0">CC BY-SA 4.0</option>
                  <option value="cc0">CC0 (Public Domain)</option>
                  <option value="mit">MIT</option>
                  <option value="apache-2.0">Apache 2.0</option>
                  <option value="proprietary">Proprietary</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Pricing</label>
                <select
                  value={pricingModel}
                  onChange={(e) => setPricingModel(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-background mt-1 text-sm"
                >
                  <option value="free">Free</option>
                  <option value="one-time">One-time Purchase</option>
                  <option value="subscription">Subscription</option>
                  <option value="pay-per-use">Pay per Use</option>
                </select>
              </div>
              {pricingModel !== "free" && (
                <div>
                  <label className="text-sm font-medium">Price (USD)</label>
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(Number(e.target.value))}
                    min={0}
                    step={0.01}
                    className="w-full px-3 py-2 rounded-lg border bg-background mt-1 text-sm"
                  />
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Tags (comma-separated)</label>
              <input
                value={packageTags}
                onChange={(e) => setPackageTags(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border bg-background text-sm"
              />
            </div>
          </div>

          {/* Error display */}
          {(promoteMut.isError || packageMut.isError) && (
            <div className="p-3 rounded-lg border border-destructive/50 bg-destructive/5 text-sm">
              <p className="text-destructive font-medium">
                {promoteMut.isError
                  ? `Vault promotion failed: ${(promoteMut.error as Error).message}`
                  : `Packaging failed: ${(packageMut.error as Error).message}`}
              </p>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between pt-4 border-t">
            <button onClick={onPrev} className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={handlePackage}
              disabled={!packageName || isProcessing}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-purple-500 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {promoteMut.isPending ? "Promoting to Vault..." : "Creating Package..."}
                </>
              ) : (
                <>
                  <Package className="w-4 h-4" /> Create Package & Publish
                </>
              )}
            </button>
          </div>
        </>
      ) : (
        /* Success state */
        <div className="space-y-6 text-center">
          <div className="py-8">
            <CheckCircle2 className="w-16 h-16 mx-auto text-green-500" />
            <h3 className="text-2xl font-bold mt-4">Marketplace Ready!</h3>
            <p className="text-muted-foreground mt-2 max-w-md mx-auto">
              Your dataset has been scraped, tagged, promoted to the vault, packaged, and is now ready for the marketplace.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4 text-left">
            <div className="p-4 rounded-lg border">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Package</p>
              <p className="font-mono text-xs mt-1 truncate">{packageResult.manifest?.id}</p>
            </div>
            <div className="p-4 rounded-lg border">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Policy</p>
              <p className="font-mono text-xs mt-1 truncate">{packageResult.policy?.id}</p>
            </div>
            <div className="p-4 rounded-lg border">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Bundle</p>
              <p className="font-mono text-xs mt-1 truncate">{packageResult.bundle?.id}</p>
            </div>
          </div>

          <div className="flex gap-3 justify-center pt-4">
            <button
              onClick={() => navigate({ to: "/local-vault/packaging" })}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
            >
              View in Packaging
            </button>
            <button
              onClick={() => navigate({ to: "/local-vault/web-scraper" })}
              className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted"
            >
              Back to Scraper
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
