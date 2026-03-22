import { useState } from "react";
import { Layout, Play, Trash2, Loader2, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { showError, showSuccess } from "@/lib/toast";
import {
  useScrapingTemplates,
  useDeleteTemplate,
  useCreateScrapingJob,
  useRunScrapingJob,
} from "@/hooks/use_scraping";
import { fadeUpVariant, staggerItem, getCategoryGradient } from "./constants";

export function TemplatesTab() {
  const { data: templates = [] } = useScrapingTemplates();
  const deleteTemplate = useDeleteTemplate();
  const createJob = useCreateScrapingJob();
  const runJob = useRunScrapingJob();
  const [url, setUrl] = useState("");

  const handleUseTemplate = async (template: any) => {
    if (!url.trim()) {
      showError("Enter a URL first");
      return;
    }
    try {
      const result = await createJob.mutateAsync({
        name: `${template.name}: ${new URL(url).hostname}`,
        config: { ...template.config, url },
        templateId: template.id,
      });
      await runJob.mutateAsync(result.jobId);
      showSuccess("Job started with template");
    } catch (err: any) {
      showError(err.message);
    }
  };

  return (
    <motion.div {...fadeUpVariant} className="space-y-6">
      {/* Target URL input */}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Label className="text-xs font-medium text-muted-foreground">
            Target URL (select a template below to apply)
          </Label>
          <Input
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="mt-1.5 h-11"
          />
        </div>
        {url.trim() && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
            <Badge variant="outline" className="h-11 px-3 flex items-center gap-1 text-emerald-500 border-emerald-500/20">
              URL ready — pick a template
            </Badge>
          </motion.div>
        )}
      </div>

      {/* Template grid */}
      <AnimatePresence initial={false}>
        {templates.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-16 text-muted-foreground"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/5 border border-amber-500/10 mb-4">
              <Layout className="h-8 w-8 text-amber-500/30" />
            </div>
            <p className="font-medium text-foreground/60">No templates yet</p>
            <p className="text-sm mt-1">Save a job configuration as a reusable template</p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((t: any) => (
              <motion.div key={t.id} {...staggerItem} layout>
                <Card className="group relative overflow-hidden border-border/50 transition-all duration-300 hover:shadow-xl hover:shadow-violet-500/5 hover:border-violet-500/30 hover:scale-[1.02]">
                  {/* Category gradient strip */}
                  <div className={`h-1.5 bg-gradient-to-r ${getCategoryGradient(t.category)}`} />
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 min-w-0 flex-1 mr-2">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-amber-500 shrink-0" />
                          <p className="font-semibold truncate">{t.name}</p>
                        </div>
                        {t.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">{t.description}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {t.category && (
                        <Badge
                          variant="outline"
                          className={`text-xs bg-gradient-to-r ${getCategoryGradient(t.category)} bg-clip-text text-transparent border-border/50`}
                        >
                          {t.category}
                        </Badge>
                      )}
                      {t.usageCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          Used {t.usageCount}×
                        </span>
                      )}
                    </div>

                    {/* Hover action buttons */}
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleUseTemplate(t)}
                        disabled={!url.trim() || createJob.isPending}
                        className="flex-1 h-8 text-xs opacity-70 group-hover:opacity-100 transition-opacity"
                      >
                        {createJob.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Play className="h-3.5 w-3.5 mr-1" />
                        )}
                        Use Template
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteTemplate.mutate(t.id)}
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
