import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Stage, Layer, Image as KonvaImage, Line } from "react-konva";
import type Konva from "konva";
import { IpcClient } from "@/ipc/ipc_client";
import type { ImageStudioImage, ImageStudioProvider, ImageStudioProviderModel } from "@/ipc/ipc_types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Image,
  Wand2,
  Trash2,
  Download,
  FolderOpen,
  MoreVertical,
  Eraser,
  MousePointer2,
  Paintbrush,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
  Sparkles,
  Copy,
  ZoomIn,
  ArrowUpCircle,
  Shuffle,
  Search,
  ImagePlus,
  SlidersHorizontal,
  Info,
  Undo2,
  Redo2,
  Maximize2,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type CanvasTool = "select" | "mask" | "erase";
type GalleryView = "grid" | "list";

interface MaskLine {
  points: number[];
  erase: boolean;
}

const ASPECT_PRESETS = [
  { label: "1:1", icon: "■", width: 1024, height: 1024 },
  { label: "16:9", icon: "▬", width: 1792, height: 1024 },
  { label: "9:16", icon: "▮", width: 1024, height: 1792 },
  { label: "4:3", icon: "▭", width: 1024, height: 768 },
  { label: "3:4", icon: "▯", width: 768, height: 1024 },
  { label: "3:2", icon: "▬", width: 1024, height: 683 },
  { label: "2:3", icon: "▮", width: 683, height: 1024 },
] as const;

const SAMPLER_OPTIONS = [
  "euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2s_ancestral",
  "dpmpp_sde", "ddim", "uni_pc",
] as const;

const PROMPT_TEMPLATES = [
  { label: "Cinematic Photo", prompt: "cinematic photo, 35mm, film grain, dramatic lighting, shallow depth of field" },
  { label: "Digital Art", prompt: "digital art, highly detailed, vibrant colors, smooth gradients, concept art" },
  { label: "Oil Painting", prompt: "oil painting on canvas, rich brushstrokes, classical composition, gallery lighting" },
  { label: "Anime Style", prompt: "anime style, clean lines, vibrant cel shading, detailed background" },
  { label: "Photorealistic", prompt: "photorealistic, 8k ultra HD, DSLR, studio lighting, sharp focus" },
  { label: "Watercolor", prompt: "watercolor painting, soft washes, delicate details, paper texture" },
  { label: "3D Render", prompt: "3D render, octane render, volumetric lighting, subsurface scattering" },
  { label: "Pixel Art", prompt: "pixel art, retro style, limited palette, clean pixels" },
] as const;

const PROVIDER_LABELS: Record<string, string> = {
  openai: "DALL-E",
  google: "Imagen",
  stabilityai: "Stability AI",
  replicate: "Replicate",
  fal: "Fal.ai",
  runway: "Runway",
  comfyui: "ComfyUI",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function GeneratePanel({
  onGenerate,
  isGenerating,
  onReusePrompt,
}: {
  onGenerate: (params: {
    provider: string;
    model: string;
    prompt: string;
    negativePrompt?: string;
    width: number;
    height: number;
    style?: string;
    seed?: string;
    batchCount?: number;
    referenceImageBase64?: string;
    strength?: number;
    steps?: number;
    cfgScale?: number;
    sampler?: string;
  }) => void;
  isGenerating: boolean;
  onReusePrompt?: string;
}) {
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [aspectIdx, setAspectIdx] = useState(0);
  const [style, setStyle] = useState("");
  const [seed, setSeed] = useState("");
  const [batchCount, setBatchCount] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // img2img state
  const [img2imgEnabled, setImg2imgEnabled] = useState(false);
  const [referenceImageBase64, setReferenceImageBase64] = useState("");
  const [strength, setStrength] = useState(0.7);

  // ComfyUI advanced
  const [steps, setSteps] = useState(20);
  const [cfgScale, setCfgScale] = useState(7);
  const [sampler, setSampler] = useState("euler");

  // Prompt enhance
  const [isEnhancing, setIsEnhancing] = useState(false);

  const { data: providers = [] } = useQuery<ImageStudioProvider[]>({
    queryKey: ["image-studio", "providers"],
    queryFn: () => IpcClient.getInstance().getAvailableImageProviders(),
    staleTime: 30_000,
  });

  const selectedProvider = providers.find((p) => p.id === provider);
  const availableModels: ImageStudioProviderModel[] = selectedProvider?.models ?? [];
  const selectedModel = availableModels.find((m) => m.id === model);
  const supportsImg2Img = selectedModel?.supportsImg2Img ?? false;
  const supportsNegativePrompt = selectedModel?.supportsNegativePrompt ?? false;
  const isComfyUI = provider === "comfyui";

  // Apply reuse prompt from gallery
  useEffect(() => {
    if (onReusePrompt) setPrompt(onReusePrompt);
  }, [onReusePrompt]);

  function handleProviderChange(value: string) {
    setProvider(value);
    const models = providers.find((p) => p.id === value)?.models ?? [];
    setModel(models[0]?.id ?? "");
  }

  function handleReferenceImageDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file?.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      setReferenceImageBase64(reader.result as string);
      setImg2imgEnabled(true);
    };
    reader.readAsDataURL(file);
  }

  function handleReferenceImagePick() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        setReferenceImageBase64(reader.result as string);
        setImg2imgEnabled(true);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  async function handleEnhancePrompt() {
    if (!prompt.trim()) {
      toast.error("Enter a prompt to enhance");
      return;
    }
    setIsEnhancing(true);
    try {
      const enhanced = await IpcClient.getInstance().enhanceImagePrompt(prompt.trim());
      setPrompt(enhanced);
      toast.success("Prompt enhanced");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to enhance prompt");
    } finally {
      setIsEnhancing(false);
    }
  }

  function handleSubmit() {
    if (!prompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }
    if (!provider) {
      toast.error("Please select a provider");
      return;
    }
    const aspect = ASPECT_PRESETS[aspectIdx];
    onGenerate({
      provider,
      model: model || availableModels[0]?.id || "",
      prompt: prompt.trim(),
      negativePrompt: negativePrompt.trim() || undefined,
      width: aspect.width,
      height: aspect.height,
      style: style || undefined,
      seed: seed.trim() || undefined,
      batchCount: batchCount > 1 ? batchCount : undefined,
      referenceImageBase64: img2imgEnabled && referenceImageBase64 ? referenceImageBase64 : undefined,
      strength: img2imgEnabled ? strength : undefined,
      steps: isComfyUI ? steps : undefined,
      cfgScale: isComfyUI ? cfgScale : undefined,
      sampler: isComfyUI ? sampler : undefined,
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex flex-col gap-3 w-80 shrink-0 border-r p-4 overflow-y-auto" onKeyDown={handleKeyDown}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Wand2 className="w-4 h-4 text-violet-500" />
        Generate Image
      </div>

      {/* Provider */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Provider</Label>
        {providers.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No image providers configured. Add API keys in Settings.
          </p>
        ) : (
          <Select value={provider} onValueChange={handleProviderChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select provider…" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Model */}
      {availableModels.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Model</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select model…" />
            </SelectTrigger>
            <SelectContent>
              {availableModels.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  <div className="flex items-center gap-2">
                    <span>{m.label}</span>
                    {m.supportsImg2Img && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0">img2img</Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Prompt */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Prompt</Label>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[10px] text-violet-500 hover:text-violet-400"
                  disabled={isEnhancing || !prompt.trim()}
                  onClick={handleEnhancePrompt}
                >
                  {isEnhancing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3 mr-1" />
                      Enhance
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Use AI to improve your prompt</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Textarea
          placeholder="Describe the image you want to generate…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="text-xs min-h-[80px] resize-none"
        />
        {/* Prompt templates */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-6 text-[10px] w-fit">
              <Copy className="w-3 h-3 mr-1" />
              Templates
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {PROMPT_TEMPLATES.map((t) => (
              <DropdownMenuItem
                key={t.label}
                className="text-xs"
                onClick={() => setPrompt((prev) => prev ? `${prev}, ${t.prompt}` : t.prompt)}
              >
                {t.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Aspect Ratio */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Aspect Ratio</Label>
        <div className="flex gap-1 flex-wrap">
          {ASPECT_PRESETS.map((a, i) => (
            <Button
              key={a.label}
              variant={aspectIdx === i ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-[10px] font-mono"
              onClick={() => setAspectIdx(i)}
            >
              {a.label}
            </Button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {ASPECT_PRESETS[aspectIdx].width} × {ASPECT_PRESETS[aspectIdx].height}
        </p>
      </div>

      {/* Batch count */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Batch Count</Label>
        <div className="flex gap-1">
          {[1, 2, 3, 4].map((n) => (
            <Button
              key={n}
              variant={batchCount === n ? "secondary" : "ghost"}
              size="sm"
              className="h-7 w-7 p-0 text-xs"
              onClick={() => setBatchCount(n)}
            >
              {n}
            </Button>
          ))}
        </div>
      </div>

      {/* img2img */}
      {supportsImg2Img && (
        <div className="flex flex-col gap-2 border rounded-md p-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs flex items-center gap-1">
              <ImagePlus className="w-3 h-3" />
              Image-to-Image
            </Label>
            <Switch checked={img2imgEnabled} onCheckedChange={setImg2imgEnabled} />
          </div>
          {img2imgEnabled && (
            <>
              {referenceImageBase64 ? (
                <div className="relative group">
                  <img
                    src={referenceImageBase64}
                    alt="Reference"
                    className="w-full aspect-square object-cover rounded-md border"
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    className="absolute top-1 right-1 h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setReferenceImageBase64("")}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <div
                  className="border-2 border-dashed rounded-md p-4 text-center cursor-pointer hover:border-violet-500/50 transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleReferenceImageDrop}
                  onClick={handleReferenceImagePick}
                >
                  <ImagePlus className="w-6 h-6 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground">
                    Drop or click to add reference image
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px]">Strength</Label>
                  <span className="text-[10px] text-muted-foreground">{strength.toFixed(2)}</span>
                </div>
                <Slider
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={[strength]}
                  onValueChange={([v]) => setStrength(v)}
                  className="h-3"
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* Advanced */}
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        <SlidersHorizontal className="w-3 h-3" />
        {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Advanced options
      </button>

      {showAdvanced && (
        <div className="flex flex-col gap-3 pl-1 border-l-2 border-violet-500/20">
          {supportsNegativePrompt && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Negative Prompt</Label>
              <Textarea
                placeholder="What to avoid…"
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                className="text-xs min-h-[50px] resize-none"
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Style (OpenAI)</Label>
            <Select value={style || "__none__"} onValueChange={(v) => setStyle(v === "__none__" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs">Default</SelectItem>
                <SelectItem value="vivid" className="text-xs">Vivid</SelectItem>
                <SelectItem value="natural" className="text-xs">Natural</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Seed</Label>
            <Input
              placeholder="Optional seed…"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          {/* ComfyUI controls */}
          {isComfyUI && (
            <>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Steps</Label>
                  <span className="text-[10px] text-muted-foreground">{steps}</span>
                </div>
                <Slider
                  min={1}
                  max={100}
                  step={1}
                  value={[steps]}
                  onValueChange={([v]) => setSteps(v)}
                  className="h-3"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">CFG Scale</Label>
                  <span className="text-[10px] text-muted-foreground">{cfgScale}</span>
                </div>
                <Slider
                  min={1}
                  max={30}
                  step={0.5}
                  value={[cfgScale]}
                  onValueChange={([v]) => setCfgScale(v)}
                  className="h-3"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Sampler</Label>
                <Select value={sampler} onValueChange={setSampler}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SAMPLER_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s} className="text-xs">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
      )}

      <Button
        onClick={handleSubmit}
        disabled={isGenerating || !provider || !prompt.trim()}
        className="w-full mt-auto"
        size="sm"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Generating{batchCount > 1 ? ` ${batchCount} images` : ""}…
          </>
        ) : (
          <>
            <Wand2 className="w-4 h-4 mr-2" />
            Generate{batchCount > 1 ? ` (×${batchCount})` : ""}
          </>
        )}
      </Button>
      <p className="text-[10px] text-muted-foreground text-center">
        Ctrl+Enter to generate
      </p>
    </div>
  );
}

// ── Gallery ────────────────────────────────────────────────────────────────────

function Gallery({
  images,
  selectedId,
  onSelect,
  onDelete,
  onSaveToDisk,
  onOpenInFolder,
  onReusePrompt,
  onUpscale,
  onVariations,
  isDeleting,
  searchQuery,
  onSearchChange,
  providerFilter,
  onProviderFilterChange,
  availableProviders,
}: {
  images: ImageStudioImage[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onSaveToDisk: (id: number) => void;
  onOpenInFolder: (id: number) => void;
  onReusePrompt: (prompt: string) => void;
  onUpscale: (id: number) => void;
  onVariations: (id: number) => void;
  isDeleting: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  providerFilter: string;
  onProviderFilterChange: (v: string) => void;
  availableProviders: ImageStudioProvider[];
}) {
  const [infoImageId, setInfoImageId] = useState<number | null>(null);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Search & Filter bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-background/95">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            placeholder="Search images…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-0.5 top-1/2 -translate-y-1/2 h-5 w-5 p-0"
              onClick={() => onSearchChange("")}
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
        <Select value={providerFilter} onValueChange={onProviderFilterChange}>
          <SelectTrigger className="h-7 w-32 text-xs">
            <SelectValue placeholder="All providers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All providers</SelectItem>
            {availableProviders.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {images.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground p-6">
          <Image className="w-12 h-12" />
          <p className="text-sm font-medium">
            {searchQuery ? "No matching images" : "No images generated yet"}
          </p>
          <p className="text-xs text-center max-w-xs">
            {searchQuery
              ? "Try a different search term or clear the filter"
              : "Use the panel on the left to generate your first image. Try the prompt templates for inspiration!"}
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1 h-full">
          <div className="p-4 grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {images.map((img) => (
              <div
                key={img.id}
                className={`group relative rounded-lg border-2 overflow-hidden cursor-pointer transition-all ${
                  selectedId === img.id
                    ? "border-violet-500 shadow-lg shadow-violet-500/20"
                    : "border-border hover:border-violet-500/50"
                }`}
                onClick={() => onSelect(img.id)}
              >
                <ImageThumbnail imageId={img.id} />

                <div className="p-2 bg-background/95 border-t">
                  <p className="text-xs line-clamp-2 text-foreground leading-tight">
                    {img.prompt}
                  </p>
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        {providerLabel(img.provider)}
                      </Badge>
                      {img.model && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0 max-w-[80px] truncate">
                          {img.model}
                        </Badge>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="w-3 h-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="text-xs">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelect(img.id); }}>
                          <Paintbrush className="w-3 h-3 mr-2" />
                          Open in Editor
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onReusePrompt(img.prompt); }}>
                          <Copy className="w-3 h-3 mr-2" />
                          Reuse Prompt
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setInfoImageId(img.id); }}>
                          <Info className="w-3 h-3 mr-2" />
                          Image Info
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onUpscale(img.id); }}>
                          <ArrowUpCircle className="w-3 h-3 mr-2" />
                          Upscale
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onVariations(img.id); }}>
                          <Shuffle className="w-3 h-3 mr-2" />
                          Generate Variations
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSaveToDisk(img.id); }}>
                          <Download className="w-3 h-3 mr-2" />
                          Save to Disk
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onOpenInFolder(img.id); }}>
                          <FolderOpen className="w-3 h-3 mr-2" />
                          Show in Folder
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-red-500"
                          disabled={isDeleting}
                          onClick={(e) => { e.stopPropagation(); onDelete(img.id); }}
                        >
                          <Trash2 className="w-3 h-3 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Image Info Dialog */}
      {infoImageId && (
        <ImageInfoPanel
          imageId={infoImageId}
          images={images}
          onClose={() => setInfoImageId(null)}
        />
      )}
    </div>
  );
}

function ImageThumbnail({ imageId }: { imageId: number }) {
  const { data: src, isLoading } = useQuery({
    queryKey: ["image-studio", "thumb", imageId],
    queryFn: () => IpcClient.getInstance().readImageAsBase64(imageId),
    staleTime: Infinity,
  });

  if (isLoading) {
    return (
      <div className="aspect-square flex items-center justify-center bg-muted">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className="aspect-square w-full object-cover"
      draggable={false}
    />
  );
}

function ImageInfoPanel({
  imageId,
  images,
  onClose,
}: {
  imageId: number;
  images: ImageStudioImage[];
  onClose: () => void;
}) {
  const img = images.find((i) => i.id === imageId);
  if (!img) return null;

  const metadata = (img.metadata ?? {}) as Record<string, unknown>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background border rounded-lg shadow-xl max-w-md w-full p-4 space-y-3 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Image Details</h3>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
            <X className="w-3 h-3" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="text-muted-foreground">Provider</div>
          <div>{providerLabel(img.provider)}</div>
          <div className="text-muted-foreground">Model</div>
          <div>{img.model}</div>
          <div className="text-muted-foreground">Size</div>
          <div>{img.width} × {img.height}</div>
          {img.seed && (
            <>
              <div className="text-muted-foreground">Seed</div>
              <div className="font-mono">{img.seed}</div>
            </>
          )}
          {img.style && (
            <>
              <div className="text-muted-foreground">Style</div>
              <div>{img.style}</div>
            </>
          )}
          {metadata.steps != null && (
            <>
              <div className="text-muted-foreground">Steps</div>
              <div>{String(metadata.steps)}</div>
            </>
          )}
          {metadata.cfgScale != null && (
            <>
              <div className="text-muted-foreground">CFG Scale</div>
              <div>{String(metadata.cfgScale)}</div>
            </>
          )}
          {metadata.sampler != null && (
            <>
              <div className="text-muted-foreground">Sampler</div>
              <div>{String(metadata.sampler)}</div>
            </>
          )}
          {metadata.batchIndex != null && (
            <>
              <div className="text-muted-foreground">Batch Index</div>
              <div>{String(metadata.batchIndex)}</div>
            </>
          )}
          {metadata.hasReferenceImage === true && (
            <>
              <div className="text-muted-foreground">img2img</div>
              <div>Yes (strength: {String(metadata.strength ?? "N/A")})</div>
            </>
          )}
        </div>
        <div className="border-t pt-2">
          <div className="text-xs text-muted-foreground mb-1">Prompt</div>
          <p className="text-xs whitespace-pre-wrap">{img.prompt}</p>
        </div>
        {img.negativePrompt && (
          <div className="border-t pt-2">
            <div className="text-xs text-muted-foreground mb-1">Negative Prompt</div>
            <p className="text-xs whitespace-pre-wrap">{img.negativePrompt}</p>
          </div>
        )}
        <div className="text-[10px] text-muted-foreground">
          Created: {new Date(img.createdAt).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

// ── Canvas Editor ──────────────────────────────────────────────────────────────

function CanvasEditor({
  imageId,
  onClose,
}: {
  imageId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const stageRef = useRef<Konva.Stage>(null);
  const imageNodeRef = useRef<Konva.Image>(null);

  const [tool, setTool] = useState<CanvasTool>("select");
  const [maskLines, setMaskLines] = useState<MaskLine[]>([]);
  const [undoStack, setUndoStack] = useState<MaskLine[][]>([]);
  const [redoStack, setRedoStack] = useState<MaskLine[][]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [aiPrompt, setAiPrompt] = useState("");
  const [canvasImage, setCanvasImage] = useState<HTMLImageElement | null>(null);

  const CANVAS_SIZE = 512;

  const { data: src } = useQuery({
    queryKey: ["image-studio", "thumb", imageId],
    queryFn: () => IpcClient.getInstance().readImageAsBase64(imageId),
    staleTime: Infinity,
  });

  // Load image for Konva
  useEffect(() => {
    if (!src) return;
    const img = new window.Image();
    img.src = src;
    img.onload = () => {
      setCanvasImage(img);
    };
  }, [src]);

  // Cache after brightness/contrast changes
  useEffect(() => {
    const node = imageNodeRef.current;
    if (!node) return;
    node.cache();
    node.getLayer()?.batchDraw();
  }, [brightness, contrast, canvasImage]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function pushUndo() {
    setUndoStack((prev) => [...prev, maskLines]);
    setRedoStack([]);
  }

  function handleUndo() {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((r) => [...r, maskLines]);
      setMaskLines(last);
      return prev.slice(0, -1);
    });
  }

  function handleRedo() {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setUndoStack((u) => [...u, maskLines]);
      setMaskLines(last);
      return prev.slice(0, -1);
    });
  }

  const editMutation = useMutation({
    mutationFn: (params: { maskBase64: string; prompt: string; provider: string; model: string }) =>
      IpcClient.getInstance().editImage({ imageId, ...params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image-studio", "list"] });
      toast.success("AI edit applied — new image added to gallery");
      setMaskLines([]);
      setUndoStack([]);
      setRedoStack([]);
      setAiPrompt("");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (tool === "select") return;
    pushUndo();
    setIsDrawing(true);
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    setMaskLines((prev) => [
      ...prev,
      { points: [pos.x, pos.y], erase: tool === "erase" },
    ]);
  }

  function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!isDrawing) return;
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    setMaskLines((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      const updated = { ...last, points: [...last.points, pos.x, pos.y] };
      return [...prev.slice(0, -1), updated];
    });
  }

  function handleMouseUp() {
    setIsDrawing(false);
  }

  function clearMask() {
    if (maskLines.length > 0) pushUndo();
    setMaskLines([]);
  }

  function getMaskBase64(): string {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.fillStyle = "white";
    maskLines.forEach((line) => {
      if (line.erase) return;
      ctx.beginPath();
      for (let i = 0; i < line.points.length - 1; i += 2) {
        if (i === 0) ctx.moveTo(line.points[i], line.points[i + 1]);
        else ctx.lineTo(line.points[i], line.points[i + 1]);
      }
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.stroke();
    });
    return canvas.toDataURL("image/png");
  }

  function handleApplyAIEdit() {
    if (!aiPrompt.trim()) {
      toast.error("Enter a prompt for the AI edit");
      return;
    }
    if (maskLines.filter((l) => !l.erase).length === 0) {
      toast.error("Paint a mask over the area you want to edit");
      return;
    }
    const maskBase64 = getMaskBase64();
    editMutation.mutate({
      maskBase64,
      prompt: aiPrompt.trim(),
      provider: "openai",
      model: "dall-e-2",
    });
  }

  // Dynamic filter list for Konva
  const filters: ((imageData: ImageData) => void)[] = [];
  if (brightness !== 0 || contrast !== 0) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const KonvaLib = require("konva");
    if (brightness !== 0) filters.push(KonvaLib.Filters.Brighten);
    if (contrast !== 0) filters.push(KonvaLib.Filters.Contrast);
  }

  return (
    <div className="flex flex-col w-80 shrink-0 border-l bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-medium">Canvas Editor</span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="w-3 h-3" />
        </Button>
      </div>

      {/* Canvas */}
      <div className="flex items-center justify-center bg-muted/30 p-2">
        {canvasImage ? (
          <Stage
            ref={stageRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className="cursor-crosshair"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            <Layer>
              <KonvaImage
                ref={imageNodeRef}
                image={canvasImage}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                filters={filters}
                brightness={brightness / 100}
                contrast={contrast / 100}
              />
            </Layer>
            <Layer>
              {maskLines.map((line, i) => (
                <Line
                  key={i}
                  points={line.points}
                  stroke={line.erase ? "black" : "rgba(139, 92, 246, 0.6)"}
                  strokeWidth={brushSize}
                  lineCap="round"
                  lineJoin="round"
                  globalCompositeOperation={line.erase ? "destination-out" : "source-over"}
                />
              ))}
            </Layer>
          </Stage>
        ) : (
          <div className="w-[512px] h-[512px] flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b">
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={tool === "select" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setTool("select")}
              >
                <MousePointer2 className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p className="text-xs">Select (V)</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={tool === "mask" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setTool("mask")}
              >
                <Paintbrush className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p className="text-xs">Paint mask (B)</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={tool === "erase" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setTool("erase")}
              >
                <Eraser className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p className="text-xs">Erase mask (E)</p></TooltipContent>
          </Tooltip>

          <div className="w-px h-5 bg-border mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={undoStack.length === 0}
                onClick={handleUndo}
              >
                <Undo2 className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p className="text-xs">Undo (Ctrl+Z)</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={redoStack.length === 0}
                onClick={handleRedo}
              >
                <Redo2 className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p className="text-xs">Redo (Ctrl+Y)</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="flex-1" />
        {maskLines.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearMask}>
            Clear mask
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-4 p-3">
          {/* Brush Size */}
          {(tool === "mask" || tool === "erase") && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Brush Size</Label>
                <span className="text-xs text-muted-foreground">{brushSize}px</span>
              </div>
              <Slider
                min={2}
                max={80}
                step={1}
                value={[brushSize]}
                onValueChange={([v]) => setBrushSize(v)}
                className="h-3"
              />
            </div>
          )}

          {/* Adjustments */}
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium">Adjustments</p>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Brightness</Label>
                <span className="text-xs text-muted-foreground">{brightness}</span>
              </div>
              <Slider
                min={-100}
                max={100}
                step={1}
                value={[brightness]}
                onValueChange={([v]) => setBrightness(v)}
                className="h-3"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Contrast</Label>
                <span className="text-xs text-muted-foreground">{contrast}</span>
              </div>
              <Slider
                min={-100}
                max={100}
                step={1}
                value={[contrast]}
                onValueChange={([v]) => setContrast(v)}
                className="h-3"
              />
            </div>
          </div>

          {/* AI Edit */}
          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="text-xs font-medium">AI Edit (Inpainting)</p>
            <p className="text-[11px] text-muted-foreground">
              Paint a mask over the area to change, then describe the replacement.
            </p>
            <Textarea
              placeholder="Replace the sky with a sunset…"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              className="text-xs min-h-[60px] resize-none"
            />
            <Button
              size="sm"
              onClick={handleApplyAIEdit}
              disabled={editMutation.isPending}
              className="w-full"
            >
              {editMutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                  Applying…
                </>
              ) : (
                <>
                  <Wand2 className="w-3 h-3 mr-2" />
                  Apply AI Edit
                </>
              )}
            </Button>
          </div>

          {/* Export */}
          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="text-xs font-medium">Export</p>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => IpcClient.getInstance().saveImageToDisk(imageId).then((r) => {
                if (r.saved) toast.success("Image saved");
              })}
            >
              <Download className="w-3 h-3 mr-2" />
              Save to Disk
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => IpcClient.getInstance().openImageInFolder(imageId)}
            >
              <FolderOpen className="w-3 h-3 mr-2" />
              Show in Folder
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ImageStudioTab() {
  const queryClient = useQueryClient();
  const [selectedImageId, setSelectedImageId] = useState<number | null>(null);
  const [reusePrompt, setReusePrompt] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const { data: providers = [] } = useQuery<ImageStudioProvider[]>({
    queryKey: ["image-studio", "providers"],
    queryFn: () => IpcClient.getInstance().getAvailableImageProviders(),
    staleTime: 30_000,
  });

  const { data: images = [] } = useQuery<ImageStudioImage[]>({
    queryKey: ["image-studio", "list", debouncedSearch, providerFilter],
    queryFn: () =>
      IpcClient.getInstance().listImages({
        limit: 200,
        search: debouncedSearch || undefined,
        provider: providerFilter !== "all" ? providerFilter : undefined,
      }),
    staleTime: 10_000,
  });

  const generateMutation = useMutation({
    mutationFn: (params: Parameters<typeof IpcClient.prototype.generateImage>[0]) =>
      IpcClient.getInstance().generateImage(params),
    onSuccess: (newImages) => {
      queryClient.invalidateQueries({ queryKey: ["image-studio", "list"] });
      if (newImages.length === 1) {
        toast.success("Image generated!");
        setSelectedImageId(newImages[0].id);
      } else {
        toast.success(`${newImages.length} images generated!`);
        setSelectedImageId(newImages[0].id);
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || "Image generation failed");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => IpcClient.getInstance().deleteImage(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["image-studio", "list"] });
      queryClient.removeQueries({ queryKey: ["image-studio", "thumb", id] });
      if (selectedImageId === id) setSelectedImageId(null);
      toast.success("Image deleted");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const upscaleMutation = useMutation({
    mutationFn: (params: { imageId: number; provider: string }) =>
      IpcClient.getInstance().upscaleImage(params),
    onSuccess: (newImage) => {
      queryClient.invalidateQueries({ queryKey: ["image-studio", "list"] });
      toast.success("Image upscaled!");
      setSelectedImageId(newImage.id);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Upscale failed");
    },
  });

  const variationsMutation = useMutation({
    mutationFn: (params: { imageId: number; count?: number }) =>
      IpcClient.getInstance().generateVariations(params),
    onSuccess: (newImages) => {
      queryClient.invalidateQueries({ queryKey: ["image-studio", "list"] });
      toast.success(`${newImages.length} variation${newImages.length > 1 ? "s" : ""} generated!`);
      if (newImages[0]) setSelectedImageId(newImages[0].id);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Variations failed");
    },
  });

  function handleSaveToDisk(id: number) {
    IpcClient.getInstance()
      .saveImageToDisk(id)
      .then((r) => {
        if (r.saved) toast.success("Image saved to disk");
      })
      .catch((err: Error) => toast.error(err.message));
  }

  function handleOpenInFolder(id: number) {
    IpcClient.getInstance().openImageInFolder(id).catch((err: Error) => toast.error(err.message));
  }

  function handleUpscale(id: number) {
    // Find the image's provider to determine upscale backend
    const img = images.find((i) => i.id === id);
    const imgProvider = img?.provider ?? "fal";
    const provider = providers.find((p) => p.id === imgProvider);
    const upscaleProvider = provider?.supportsUpscale ? imgProvider : "fal";
    upscaleMutation.mutate({ imageId: id, provider: upscaleProvider });
  }

  function handleVariations(id: number) {
    variationsMutation.mutate({ imageId: id, count: 2 });
  }

  const isAnyOperationPending =
    generateMutation.isPending || upscaleMutation.isPending || variationsMutation.isPending;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Generate Panel */}
      <GeneratePanel
        onGenerate={(params) => generateMutation.mutate(params)}
        isGenerating={generateMutation.isPending}
        onReusePrompt={reusePrompt}
      />

      {/* Gallery */}
      <div className="flex flex-1 overflow-hidden">
        <Gallery
          images={images}
          selectedId={selectedImageId}
          onSelect={setSelectedImageId}
          onDelete={(id) => deleteMutation.mutate(id)}
          onSaveToDisk={handleSaveToDisk}
          onOpenInFolder={handleOpenInFolder}
          onReusePrompt={setReusePrompt}
          onUpscale={handleUpscale}
          onVariations={handleVariations}
          isDeleting={deleteMutation.isPending}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          providerFilter={providerFilter}
          onProviderFilterChange={setProviderFilter}
          availableProviders={providers}
        />
      </div>

      {/* Status bar for background operations */}
      {isAnyOperationPending && (
        <div className="absolute bottom-0 left-0 right-0 bg-violet-500/10 border-t border-violet-500/30 px-4 py-1.5 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin text-violet-500" />
          <span className="text-xs text-violet-500">
            {generateMutation.isPending && "Generating images…"}
            {upscaleMutation.isPending && "Upscaling image…"}
            {variationsMutation.isPending && "Generating variations…"}
          </span>
        </div>
      )}

      {/* Canvas Editor — only when image is selected */}
      {selectedImageId !== null && (
        <CanvasEditor
          imageId={selectedImageId}
          onClose={() => setSelectedImageId(null)}
        />
      )}
    </div>
  );
}
