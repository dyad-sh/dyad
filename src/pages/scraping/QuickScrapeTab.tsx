import { useState } from "react";
import {
  Search,
  Copy,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Gauge,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { showError, showSuccess } from "@/lib/toast";
import { useQuickScrape, useProbeUrl } from "@/hooks/use_scraping";
import { ENGINE_VISUALS, fadeUpVariant } from "./constants";

export function QuickScrapeTab() {
  const [url, setUrl] = useState("");
  const [engine, setEngine] = useState<string>("auto");
  const quickScrape = useQuickScrape();
  const probe = useProbeUrl(url.length > 10 ? url : undefined);

  const handleScrape = () => {
    if (!url.trim()) return;
    quickScrape.mutate(
      { url: url.trim(), engine: engine === "auto" ? undefined : engine },
      {
        onSuccess: () => showSuccess("Scrape complete"),
        onError: (err) => showError(`Scrape failed: ${err.message}`),
      },
    );
  };

  return (
    <motion.div {...fadeUpVariant} className="space-y-6">
      {/* Main input card */}
      <Card className="overflow-hidden border-border/50 shadow-sm">
        <div className="h-1 bg-gradient-to-r from-rose-500 via-orange-500 to-amber-500" />
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500/20 to-orange-500/20 border border-rose-500/20">
              <Search className="h-4 w-4 text-rose-500" />
            </div>
            Quick Scrape
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter a URL to instantly extract content with automatic engine selection
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* URL input + button */}
          <div className="flex gap-2">
            <Input
              placeholder="https://example.com/article"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleScrape()}
              className="flex-1 h-11"
            />
            <Button
              onClick={handleScrape}
              disabled={!url.trim() || quickScrape.isPending}
              className="h-11 px-6 bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-700 hover:to-orange-700 shadow-lg shadow-rose-500/20 border-0 text-white"
            >
              {quickScrape.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Search className="h-4 w-4 mr-1.5" />
              )}
              Scrape
            </Button>
          </div>

          {/* Engine picker — visual pills */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Engine</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(ENGINE_VISUALS).map(([key, ev]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setEngine(key)}
                  className={`group relative flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm transition-all duration-200 cursor-pointer ${
                    engine === key
                      ? `border-border bg-gradient-to-br ${ev.gradient} shadow-md ${ev.shadow} scale-[1.02]`
                      : "border-border/50 bg-background hover:border-border hover:bg-muted/50"
                  }`}
                >
                  <span className={engine === key ? ev.iconColor : "text-muted-foreground transition-colors group-hover:text-foreground"}>
                    {ev.icon}
                  </span>
                  <span className={engine === key ? "font-medium" : "text-muted-foreground group-hover:text-foreground transition-colors"}>
                    {ev.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Probe results — animated */}
          <AnimatePresence>
            {probe.data && (
              <motion.div
                initial={{ opacity: 0, y: 10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -5, height: 0 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              >
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/30 p-3">
                  <Badge
                    variant="outline"
                    className={`${ENGINE_VISUALS[probe.data.recommendedEngine]?.iconColor ?? "text-foreground"} border-current/20 bg-current/5`}
                  >
                    {ENGINE_VISUALS[probe.data.recommendedEngine]?.icon}
                    <span className="ml-1">{probe.data.recommendedEngine}</span>
                  </Badge>

                  <div className="flex items-center gap-1 text-xs">
                    <Gauge className="h-3 w-3" />
                    <span className={probe.data.responseTimeMs < 500 ? "text-emerald-500" : probe.data.responseTimeMs < 2000 ? "text-amber-500" : "text-red-500"}>
                      {probe.data.responseTimeMs}ms
                    </span>
                  </div>

                  {probe.data.hasCloudflare && (
                    <Badge variant="outline" className="text-orange-500 border-orange-500/20 bg-orange-500/5 text-xs">
                      <ShieldAlert className="h-3 w-3 mr-1" />
                      Cloudflare
                    </Badge>
                  )}

                  {probe.data.hasBotProtection && (
                    <Badge variant="outline" className="text-red-500 border-red-500/20 bg-red-500/5 text-xs">
                      <ShieldAlert className="h-3 w-3 mr-1" />
                      Bot Protection
                    </Badge>
                  )}

                  {!probe.data.hasCloudflare && !probe.data.hasBotProtection && (
                    <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/5 text-xs">
                      <ShieldCheck className="h-3 w-3 mr-1" />
                      No Protection
                    </Badge>
                  )}

                  <span className="text-xs text-muted-foreground ml-auto">
                    {probe.data.confidence.toFixed(0)}% confidence
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Loading skeleton */}
      <AnimatePresence>
        {quickScrape.isPending && !quickScrape.data && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <Card className="overflow-hidden border-border/50">
              <CardContent className="p-6 space-y-4">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-32 w-full" />
                <div className="flex gap-2">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-6 w-16" />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      <AnimatePresence>
        {quickScrape.data && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
          >
            <Card className="overflow-hidden border-border/50 shadow-sm">
              <div className="h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500" />
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    </div>
                    <CardTitle className="text-base">Results</CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs font-mono">
                      {quickScrape.data.engine}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {quickScrape.data.durationMs}ms
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 hover:bg-muted"
                      onClick={() => {
                        navigator.clipboard.writeText(quickScrape.data.markdown);
                        showSuccess("Copied to clipboard");
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {quickScrape.data.title && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Title</p>
                    <p className="font-semibold text-base">{quickScrape.data.title}</p>
                  </div>
                )}
                <Separator className="opacity-50" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Content</p>
                  <ScrollArea className="h-80">
                    <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg bg-muted/30 p-4 border border-border/50">
                      <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
                        {quickScrape.data.markdown || quickScrape.data.text || "No content extracted"}
                      </pre>
                    </div>
                  </ScrollArea>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error state */}
      <AnimatePresence>
        {quickScrape.isError && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-600 dark:text-red-400 text-sm">Scrape Failed</p>
                <p className="text-sm text-red-500/80 mt-0.5">{quickScrape.error?.message}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
