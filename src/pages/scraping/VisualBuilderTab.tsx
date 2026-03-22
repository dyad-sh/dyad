import { useState } from "react";
import {
  MousePointer2,
  Plus,
  Trash2,
  Play,
  Loader2,
  GripVertical,
  Hash,
  Layers,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { showError, showSuccess } from "@/lib/toast";
import { useCreateScrapingJob, useRunScrapingJob } from "@/hooks/use_scraping";
import { fadeUpVariant, staggerItem } from "./constants";

export function VisualBuilderTab() {
  const [targetUrl, setTargetUrl] = useState("");
  const [fields, setFields] = useState<{ name: string; selector: string; type: string }[]>([
    { name: "", selector: "", type: "text" },
  ]);
  const createJob = useCreateScrapingJob();
  const runJob = useRunScrapingJob();

  const addField = () => {
    setFields([...fields, { name: "", selector: "", type: "text" }]);
  };

  const updateField = (index: number, key: string, value: string) => {
    const updated = [...fields];
    (updated[index] as any)[key] = value;
    setFields(updated);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const handleBuild = async () => {
    if (!targetUrl.trim()) return;
    const validFields = fields.filter((f) => f.name && f.selector);
    if (validFields.length === 0) {
      showError("Add at least one field with a name and selector");
      return;
    }

    try {
      const result = await createJob.mutateAsync({
        name: `Visual: ${new URL(targetUrl).hostname}`,
        config: {
          sourceType: "url",
          url: targetUrl,
          mode: "hybrid",
          fields: validFields.map((f) => ({
            name: f.name,
            selector: f.selector,
            type: f.type,
            required: false,
          })),
          output: { format: "json" },
        },
      });
      await runJob.mutateAsync(result.jobId);
      showSuccess("Job started");
    } catch (err: any) {
      showError(err.message);
    }
  };

  return (
    <motion.div {...fadeUpVariant} className="space-y-6">
      <Card className="overflow-hidden border-border/50 shadow-sm">
        <div className="h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500" />
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-blue-500/20">
              <MousePointer2 className="h-4 w-4 text-blue-500" />
            </div>
            Visual Extraction Builder
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Define CSS selectors to extract structured data from a page
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Target URL */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Target URL</Label>
            <Input
              placeholder="https://example.com/products"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              className="mt-1.5 h-11"
            />
          </div>

          {/* Field list */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <Label className="text-xs font-medium text-muted-foreground">
                  Extraction Fields
                </Label>
                <Badge variant="secondary" className="text-xs h-5">
                  {fields.length}
                </Badge>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={addField}
                className="h-8 gap-1.5 border-dashed border-blue-500/30 text-blue-500 hover:bg-blue-500/5 hover:border-blue-500/50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Field
              </Button>
            </div>

            <AnimatePresence initial={false}>
              {fields.map((field, i) => (
                <motion.div
                  key={i}
                  {...staggerItem}
                  layout
                  transition={{ duration: 0.2 }}
                  className="group relative flex gap-2 items-start rounded-xl border border-border/50 bg-muted/20 p-3 transition-all duration-200 hover:border-blue-500/30 hover:bg-muted/40"
                >
                  {/* Row number + grip */}
                  <div className="flex flex-col items-center gap-1 pt-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors cursor-grab" />
                    <Badge variant="outline" className="h-5 w-5 p-0 flex items-center justify-center text-[10px] font-mono text-muted-foreground">
                      {i + 1}
                    </Badge>
                  </div>

                  {/* Fields */}
                  <div className="flex-1 grid grid-cols-[1fr_2fr_auto] gap-2">
                    <Input
                      placeholder="Field name"
                      value={field.name}
                      onChange={(e) => updateField(i, "name", e.target.value)}
                      className="h-9 text-sm"
                    />
                    <Input
                      placeholder="CSS selector (e.g. .price, h1, [data-id])"
                      value={field.selector}
                      onChange={(e) => updateField(i, "selector", e.target.value)}
                      className="h-9 text-sm font-mono"
                    />
                    <Select
                      value={field.type}
                      onValueChange={(v) => updateField(i, "type", v)}
                    >
                      <SelectTrigger className="w-28 h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="html">HTML</SelectItem>
                        <SelectItem value="attribute">Attribute</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="url">URL</SelectItem>
                        <SelectItem value="image">Image</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Delete */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeField(i)}
                    disabled={fields.length === 1}
                    className="h-9 w-9 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Empty field hint */}
            {fields.length === 1 && !fields[0].name && !fields[0].selector && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 rounded-lg border border-dashed border-blue-500/20 bg-blue-500/5 p-3 text-sm text-blue-500/80"
              >
                <Hash className="h-4 w-4 shrink-0" />
                <span>
                  Name your field (e.g. "title"), then enter a CSS selector (e.g. "h1.product-title")
                </span>
              </motion.div>
            )}
          </div>

          {/* CTA */}
          <Button
            onClick={handleBuild}
            disabled={createJob.isPending || runJob.isPending}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg shadow-blue-500/20 border-0 text-white"
          >
            {createJob.isPending || runJob.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <Play className="h-4 w-4 mr-1.5" />
            )}
            Run Extraction
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
