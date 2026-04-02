import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { VideoStudioVideo, VideoStudioProvider } from "@/ipc/ipc_types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Video,
  Wand2,
  Loader2,
  Search,
  X,
  Download,
  FolderOpen,
  Trash2,
  MoreVertical,
  Copy,
  Info,
  ImagePlus,
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Play,
  Pause,
  Maximize2,
  Clock,
  Film,
  Clapperboard,
  RotateCcw,
  FastForward,
  Layers,
} from "lucide-react";

// ── Constants ──────────────────────────────────────────────────────────────────

const ASPECT_PRESETS = [
  { label: "16:9", width: 1280, height: 720 },
  { label: "9:16", width: 720, height: 1280 },
  { label: "1:1", width: 1024, height: 1024 },
  { label: "4:3", width: 1024, height: 768 },
  { label: "21:9", width: 1344, height: 576 },
];

const DURATION_PRESETS = [
  { label: "3s", value: 3 },
  { label: "5s", value: 5 },
  { label: "8s", value: 8 },
  { label: "10s", value: 10 },
];

const VIDEO_PROMPT_TEMPLATES = [
  {
    label: "Cinematic Landscape",
    prompt:
      "Cinematic aerial shot of a breathtaking mountain landscape at golden hour, smooth drone movement, volumetric fog, lens flare, 4K",
  },
  {
    label: "Product Showcase",
    prompt:
      "Elegant product reveal, smooth 360-degree rotation on a minimalist surface, soft studio lighting, reflections, shallow depth of field",
  },
  {
    label: "Abstract Motion",
    prompt:
      "Abstract fluid motion, vibrant colors flowing and merging, macro lens perspective, soft bokeh background, smooth slow motion",
  },
  {
    label: "City Timelapse",
    prompt:
      "Hyper-lapse of a modern city skyline transitioning from day to night, streaking car lights, clouds moving rapidly, dramatic lighting",
  },
  {
    label: "Character Animation",
    prompt:
      "A character walks through a lush forest, sunlight filtering through the canopy, gentle breeze moving leaves, tracking shot, cinematic color grading",
  },
  {
    label: "Underwater Scene",
    prompt:
      "Slow underwater camera glides through a coral reef, sunbeams penetrating the water, schools of colorful fish, gentle caustic light patterns",
  },
];

const SOURCE_TYPES = [
  { id: "text-to-video", label: "Text to Video", icon: Clapperboard },
  { id: "image-to-video", label: "Image to Video", icon: ImagePlus },
  { id: "extend", label: "Extend Video", icon: FastForward },
];

// ── Helper Hooks ───────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ── VideoThumbnail ─────────────────────────────────────────────────────────────

function VideoThumbnail({ videoId }: { videoId: number }) {
  const { data: thumb, isLoading } = useQuery({
    queryKey: ["video-studio", "thumb", videoId],
    queryFn: () => IpcClient.getInstance().readVideoThumbnail(videoId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="aspect-video bg-muted flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (thumb) {
    return (
      <div className="aspect-video bg-muted overflow-hidden relative">
        <img src={thumb} className="w-full h-full object-cover" alt="" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
          <Play className="w-8 h-8 text-white drop-shadow-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="aspect-video bg-muted flex items-center justify-center relative">
      <Film className="w-6 h-6 text-muted-foreground" />
      <div className="absolute inset-0 flex items-center justify-center bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity">
        <Play className="w-8 h-8 text-white drop-shadow-lg" />
      </div>
    </div>
  );
}

// ── VideoPlayer Panel ──────────────────────────────────────────────────────────

function VideoPlayer({
  videoId,
  video,
  onClose,
  onSaveToDisk,
  onExtractFrames,
}: {
  videoId: number;
  video: VideoStudioVideo | undefined;
  onClose: () => void;
  onSaveToDisk: (id: number) => void;
  onExtractFrames: (id: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);

  const { data: videoDataUrl, isLoading } = useQuery({
    queryKey: ["video-studio", "video", videoId],
    queryFn: () => IpcClient.getInstance().readVideo(videoId),
    staleTime: 60_000,
  });

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play();
      setIsPlaying(true);
    } else {
      el.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const el = videoRef.current;
    if (el) setCurrentTime(el.currentTime);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const el = videoRef.current;
    if (el) setTotalDuration(el.duration);
  }, []);

  const handleSeek = useCallback((value: number[]) => {
    const el = videoRef.current;
    if (el) {
      el.currentTime = value[0];
      setCurrentTime(value[0]);
    }
  }, []);

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col w-96 shrink-0 border-l overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-medium flex items-center gap-1.5">
          <Play className="w-3.5 h-3.5 text-violet-500" />
          Video Preview
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={onClose}
        >
          <X className="w-3 h-3" />
        </Button>
      </div>

      {/* Video */}
      <div className="bg-black flex items-center justify-center min-h-[200px]">
        {isLoading ? (
          <Loader2 className="w-8 h-8 animate-spin text-white/60" />
        ) : videoDataUrl ? (
          <video
            ref={videoRef}
            src={videoDataUrl}
            className="max-w-full max-h-[300px]"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={() => setIsPlaying(false)}
            loop={false}
            playsInline
          />
        ) : (
          <p className="text-white/60 text-xs">Failed to load video</p>
        )}
      </div>

      {/* Controls */}
      {videoDataUrl && (
        <div className="flex flex-col gap-2 px-3 py-2 border-b">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={togglePlay}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
            </Button>
            <Slider
              min={0}
              max={totalDuration || 1}
              step={0.01}
              value={[currentTime]}
              onValueChange={handleSeek}
              className="flex-1"
            />
            <span className="text-[10px] text-muted-foreground font-mono w-16 text-right">
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => {
                      const el = videoRef.current;
                      if (el) {
                        el.currentTime = 0;
                        setCurrentTime(0);
                      }
                    }}
                  >
                    <RotateCcw className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Restart</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => onSaveToDisk(videoId)}
            >
              <Download className="w-3 h-3 mr-1" />
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => onExtractFrames(videoId)}
            >
              <Layers className="w-3 h-3 mr-1" />
              Frames
            </Button>
          </div>
        </div>
      )}

      {/* Metadata */}
      {video && (
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-3 p-3">
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Prompt</p>
              <p className="text-xs">{video.prompt}</p>
            </div>
            {video.negativePrompt && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">
                  Negative Prompt
                </p>
                <p className="text-xs text-muted-foreground">
                  {video.negativePrompt}
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground">Provider</p>
                <Badge variant="outline" className="text-[10px] mt-0.5">
                  {video.provider}
                </Badge>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Model</p>
                <Badge variant="secondary" className="text-[10px] mt-0.5">
                  {video.model}
                </Badge>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Resolution</p>
                <p className="text-xs font-mono">
                  {video.width}×{video.height}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Duration</p>
                <p className="text-xs font-mono">{video.duration}s</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">FPS</p>
                <p className="text-xs font-mono">{video.fps}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Format</p>
                <p className="text-xs font-mono">{video.format}</p>
              </div>
              {video.seed && (
                <div>
                  <p className="text-[10px] text-muted-foreground">Seed</p>
                  <p className="text-xs font-mono">{video.seed}</p>
                </div>
              )}
              {video.style && (
                <div>
                  <p className="text-[10px] text-muted-foreground">Style</p>
                  <p className="text-xs">{video.style}</p>
                </div>
              )}
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Source</p>
              <Badge variant="outline" className="text-[10px] mt-0.5">
                {video.sourceType ?? "text-to-video"}
              </Badge>
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ── GeneratePanel ──────────────────────────────────────────────────────────────

function GeneratePanel({
  providers,
  isGenerating,
  onGenerate,
}: {
  providers: VideoStudioProvider[];
  isGenerating: boolean;
  onGenerate: (params: Record<string, unknown>) => void;
}) {
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [aspectIdx, setAspectIdx] = useState(0);
  const [durationIdx, setDurationIdx] = useState(1); // default 5s
  const [fps, setFps] = useState(24);
  const [seed, setSeed] = useState("");
  const [style, setStyle] = useState("");
  const [sourceType, setSourceType] = useState("text-to-video");
  const [referenceImageBase64, setReferenceImageBase64] = useState("");
  const [referenceVideoId, setReferenceVideoId] = useState<number | null>(null);
  const [strength, setStrength] = useState(0.75);
  const [motionAmount, setMotionAmount] = useState(127);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedProvider = providers.find((p) => p.id === provider);
  const availableModels = selectedProvider?.models ?? [];
  const selectedModel = availableModels.find((m) => m.id === model);

  const supportsImg2Video = selectedModel?.supportsImg2Video ?? false;
  const supportsVideoExtend = selectedModel?.supportsVideoExtend ?? false;
  const maxDuration = selectedModel?.maxDurationSeconds ?? 10;

  // Reset model when provider changes
  const handleProviderChange = useCallback(
    (v: string) => {
      setProvider(v);
      const prov = providers.find((p) => p.id === v);
      if (prov?.models.length) {
        setModel(prov.models[0].id);
      } else {
        setModel("");
      }
    },
    [providers],
  );

  // Auto-select first provider
  useEffect(() => {
    if (providers.length > 0 && !provider) {
      handleProviderChange(providers[0].id);
    }
  }, [providers, provider, handleProviderChange]);

  const handleEnhancePrompt = useCallback(async () => {
    if (!prompt.trim()) return;
    setIsEnhancing(true);
    try {
      const enhanced = await IpcClient.getInstance().enhanceVideoPrompt(prompt);
      setPrompt(enhanced);
      toast.success("Prompt enhanced");
    } catch (err) {
      toast.error(`Failed to enhance prompt: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsEnhancing(false);
    }
  }, [prompt]);

  const handleReferenceImagePick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        setReferenceImageBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [],
  );

  const handleReferenceImageDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file || !file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        setReferenceImageBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    if (!prompt.trim() || !provider) return;
    const aspect = ASPECT_PRESETS[aspectIdx];
    const dur = DURATION_PRESETS[durationIdx];
    onGenerate({
      provider,
      model,
      prompt: prompt.trim(),
      negativePrompt: negativePrompt.trim() || undefined,
      width: aspect.width,
      height: aspect.height,
      duration: Math.min(dur.value, maxDuration),
      fps,
      seed: seed || undefined,
      style: style || undefined,
      sourceType,
      referenceImageBase64:
        sourceType === "image-to-video" ? referenceImageBase64 || undefined : undefined,
      referenceVideoId:
        sourceType === "extend" ? referenceVideoId ?? undefined : undefined,
      strength: sourceType === "image-to-video" ? strength : undefined,
      motionAmount,
    });
  }, [
    prompt,
    negativePrompt,
    provider,
    model,
    aspectIdx,
    durationIdx,
    fps,
    seed,
    style,
    sourceType,
    referenceImageBase64,
    referenceVideoId,
    strength,
    motionAmount,
    maxDuration,
    onGenerate,
  ]);

  // Keyboard shortcut
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  // Filtered source types based on model capabilities
  const filteredSourceTypes = SOURCE_TYPES.filter((st) => {
    if (st.id === "image-to-video") return supportsImg2Video;
    if (st.id === "extend") return supportsVideoExtend;
    return true;
  });

  return (
    <div
      className="flex flex-col gap-3 w-80 shrink-0 border-r p-4 overflow-y-auto"
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Clapperboard className="w-4 h-4 text-violet-500" />
        Generate Video
      </div>

      {/* Source Type */}
      {filteredSourceTypes.length > 1 && (
        <div className="flex gap-1 flex-wrap">
          {filteredSourceTypes.map((st) => (
            <Button
              key={st.id}
              variant={sourceType === st.id ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-[10px]"
              onClick={() => setSourceType(st.id)}
            >
              <st.icon className="w-3 h-3 mr-1" />
              {st.label}
            </Button>
          ))}
        </div>
      )}

      {/* Provider */}
      {providers.length === 0 ? (
        <div className="text-xs text-muted-foreground p-2 border border-dashed rounded-md text-center">
          No video providers configured. Add API keys in Settings.
        </div>
      ) : (
        <Select value={provider} onValueChange={handleProviderChange}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select provider" />
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

      {/* Model */}
      {availableModels.length > 1 && (
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            {availableModels.map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                {m.label}
                {m.maxDurationSeconds && (
                  <span className="ml-1 text-muted-foreground">
                    (up to {m.maxDurationSeconds}s)
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Prompt */}
      <div className="flex flex-col gap-1.5">
        <Textarea
          placeholder="Describe the video you want to generate..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="text-xs min-h-[80px] resize-none"
        />
        <div className="flex items-center gap-1 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-1.5"
              >
                <Copy className="w-3 h-3 mr-1" />
                Templates
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-xs">
              {VIDEO_PROMPT_TEMPLATES.map((t) => (
                <DropdownMenuItem
                  key={t.label}
                  className="text-xs"
                  onClick={() =>
                    setPrompt((prev) =>
                      prev ? `${prev}\n${t.prompt}` : t.prompt,
                    )
                  }
                >
                  {t.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] px-1.5"
            onClick={handleEnhancePrompt}
            disabled={isEnhancing || !prompt.trim()}
          >
            {isEnhancing ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3 mr-1" />
            )}
            Enhance
          </Button>
        </div>
      </div>

      {/* Reference Image (Image-to-Video) */}
      {sourceType === "image-to-video" && supportsImg2Video && (
        <div className="flex flex-col gap-2 border rounded-md p-2">
          <Label className="text-xs flex items-center gap-1">
            <ImagePlus className="w-3 h-3" />
            Reference Image
          </Label>
          {referenceImageBase64 ? (
            <div className="relative group/ref">
              <img
                src={referenceImageBase64}
                className="w-full aspect-video object-cover rounded-md"
                alt="Reference"
              />
              <Button
                variant="destructive"
                size="sm"
                className="absolute top-1 right-1 h-5 w-5 p-0 opacity-0 group-hover/ref:opacity-100 transition-opacity"
                onClick={() => setReferenceImageBase64("")}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <div
              className="border-2 border-dashed rounded-md p-4 text-center cursor-pointer hover:border-violet-500/50 transition-colors"
              onDrop={handleReferenceImageDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={handleReferenceImagePick}
            >
              <ImagePlus className="w-6 h-6 mx-auto text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground mt-1">
                Drop or click to add reference image
              </p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <div className="flex flex-col gap-1">
            <Label className="text-[10px]">
              Strength: {strength.toFixed(2)}
            </Label>
            <Slider
              min={0.1}
              max={1}
              step={0.05}
              value={[strength]}
              onValueChange={([v]) => setStrength(v)}
            />
          </div>
        </div>
      )}

      {/* Aspect Ratio */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-[10px] text-muted-foreground">
          Aspect Ratio
        </Label>
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
      </div>

      {/* Duration */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Duration
        </Label>
        <div className="flex gap-1">
          {DURATION_PRESETS.filter((d) => d.value <= maxDuration).map(
            (d, i) => (
              <Button
                key={d.label}
                variant={durationIdx === i ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 text-[10px] font-mono"
                onClick={() => setDurationIdx(i)}
              >
                {d.label}
              </Button>
            ),
          )}
        </div>
      </div>

      {/* Advanced */}
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        <SlidersHorizontal className="w-3 h-3" />
        {showAdvanced ? (
          <ChevronUp className="w-3 h-3" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
        Advanced options
      </button>

      {showAdvanced && (
        <div className="flex flex-col gap-3 pl-1 border-l-2 border-violet-500/20">
          {/* Negative Prompt */}
          <div className="flex flex-col gap-1">
            <Label className="text-[10px]">Negative Prompt</Label>
            <Textarea
              placeholder="What to avoid in the video..."
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              className="text-xs min-h-[50px] resize-none"
            />
          </div>

          {/* FPS */}
          <div className="flex flex-col gap-1">
            <Label className="text-[10px]">
              FPS: {fps}
            </Label>
            <Slider
              min={8}
              max={30}
              step={1}
              value={[fps]}
              onValueChange={([v]) => setFps(v)}
            />
          </div>

          {/* Motion Amount */}
          <div className="flex flex-col gap-1">
            <Label className="text-[10px]">
              Motion Amount: {motionAmount}
            </Label>
            <Slider
              min={1}
              max={255}
              step={1}
              value={[motionAmount]}
              onValueChange={([v]) => setMotionAmount(v)}
            />
          </div>

          {/* Style */}
          <div className="flex flex-col gap-1">
            <Label className="text-[10px]">Style</Label>
            <Input
              placeholder="e.g. cinematic, anime, realistic..."
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="h-7 text-xs"
            />
          </div>

          {/* Seed */}
          <div className="flex flex-col gap-1">
            <Label className="text-[10px]">Seed (optional)</Label>
            <Input
              placeholder="Random"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="h-7 text-xs font-mono"
            />
          </div>
        </div>
      )}

      {/* Submit */}
      <Button
        onClick={handleSubmit}
        disabled={isGenerating || !provider || !prompt.trim()}
        className="w-full mt-auto"
        size="sm"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Generating video…
          </>
        ) : (
          <>
            <Wand2 className="w-4 h-4 mr-2" />
            Generate Video
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
  videos,
  selectedId,
  onSelect,
  onDelete,
  onSaveToDisk,
  onOpenInFolder,
  onReusePrompt,
  searchQuery,
  onSearchChange,
  providerFilter,
  onProviderFilterChange,
  availableProviders,
}: {
  videos: VideoStudioVideo[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onSaveToDisk: (id: number) => void;
  onOpenInFolder: (id: number) => void;
  onReusePrompt: (prompt: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  providerFilter: string;
  onProviderFilterChange: (p: string) => void;
  availableProviders: VideoStudioProvider[];
}) {
  const [infoVideoId, setInfoVideoId] = useState<number | null>(null);
  const infoVideo = infoVideoId
    ? videos.find((v) => v.id === infoVideoId)
    : null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Search & Filter Bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-background/95">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search videos…"
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
            <SelectItem value="all" className="text-xs">
              All providers
            </SelectItem>
            {availableProviders.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground">
          <Video className="w-12 h-12" />
          <p className="text-sm font-medium">
            {searchQuery
              ? "No matching videos"
              : "No videos generated yet"}
          </p>
          <p className="text-xs max-w-[200px] text-center">
            {searchQuery
              ? "Try a different search term"
              : "Configure a provider and enter a prompt to get started"}
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-4 grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {videos.map((vid) => (
              <div
                key={vid.id}
                className={`group relative rounded-lg border-2 overflow-hidden cursor-pointer transition-all ${
                  selectedId === vid.id
                    ? "border-violet-500 shadow-lg shadow-violet-500/20"
                    : "border-border hover:border-violet-500/50"
                }`}
                onClick={() => onSelect(vid.id)}
              >
                <VideoThumbnail videoId={vid.id} />

                {/* Duration badge */}
                <div className="absolute top-2 right-2">
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-black/60 text-white border-0"
                  >
                    <Clock className="w-2.5 h-2.5 mr-0.5" />
                    {vid.duration}s
                  </Badge>
                </div>

                <div className="p-2 bg-background/95 border-t">
                  <p className="text-xs line-clamp-2">{vid.prompt}</p>
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px]">
                        {vid.provider}
                      </Badge>
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
                        <DropdownMenuItem onClick={() => onSelect(vid.id)}>
                          <Play className="w-3 h-3 mr-2" />
                          Play
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onReusePrompt(vid.prompt)}
                        >
                          <Copy className="w-3 h-3 mr-2" />
                          Reuse Prompt
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setInfoVideoId(vid.id)}
                        >
                          <Info className="w-3 h-3 mr-2" />
                          Video Info
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onSaveToDisk(vid.id)}>
                          <Download className="w-3 h-3 mr-2" />
                          Save to Disk
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onOpenInFolder(vid.id)}
                        >
                          <FolderOpen className="w-3 h-3 mr-2" />
                          Show in Folder
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-red-500"
                          onClick={() => onDelete(vid.id)}
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

      {/* Info Dialog */}
      {infoVideo && (
        <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-8">
          <div className="bg-background rounded-lg shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Video Information</h3>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setInfoVideoId(null)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
            <div className="flex flex-col gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Prompt:</span>
                <p>{infoVideo.prompt}</p>
              </div>
              {infoVideo.negativePrompt && (
                <div>
                  <span className="text-muted-foreground">
                    Negative Prompt:
                  </span>
                  <p>{infoVideo.negativePrompt}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground">Provider:</span>{" "}
                  {infoVideo.provider}
                </div>
                <div>
                  <span className="text-muted-foreground">Model:</span>{" "}
                  {infoVideo.model}
                </div>
                <div>
                  <span className="text-muted-foreground">Resolution:</span>{" "}
                  {infoVideo.width}×{infoVideo.height}
                </div>
                <div>
                  <span className="text-muted-foreground">Duration:</span>{" "}
                  {infoVideo.duration}s
                </div>
                <div>
                  <span className="text-muted-foreground">FPS:</span>{" "}
                  {infoVideo.fps}
                </div>
                <div>
                  <span className="text-muted-foreground">Format:</span>{" "}
                  {infoVideo.format}
                </div>
                {infoVideo.seed && (
                  <div>
                    <span className="text-muted-foreground">Seed:</span>{" "}
                    {infoVideo.seed}
                  </div>
                )}
                {infoVideo.style && (
                  <div>
                    <span className="text-muted-foreground">Style:</span>{" "}
                    {infoVideo.style}
                  </div>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">Source:</span>{" "}
                {infoVideo.sourceType ?? "text-to-video"}
              </div>
              <div>
                <span className="text-muted-foreground">Created:</span>{" "}
                {infoVideo.createdAt
                  ? new Date(infoVideo.createdAt).toLocaleString()
                  : "—"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function VideoStudioTab() {
  const queryClient = useQueryClient();
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const debouncedSearch = useDebounce(searchQuery, 300);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: providers = [] } = useQuery<VideoStudioProvider[]>({
    queryKey: ["video-studio", "providers"],
    queryFn: () => IpcClient.getInstance().getAvailableVideoProviders(),
    staleTime: 30_000,
  });

  const { data: videos = [] } = useQuery<VideoStudioVideo[]>({
    queryKey: ["video-studio", "list", debouncedSearch, providerFilter],
    queryFn: () =>
      IpcClient.getInstance().listVideos({
        limit: 200,
        search: debouncedSearch || undefined,
        provider: providerFilter !== "all" ? providerFilter : undefined,
      }),
    staleTime: 10_000,
  });

  const selectedVideo = selectedVideoId
    ? videos.find((v) => v.id === selectedVideoId)
    : undefined;

  // ── Mutations ────────────────────────────────────────────────────────────

  const generateMutation = useMutation({
    mutationFn: (params: Record<string, unknown>) =>
      IpcClient.getInstance().generateVideo(
        params as Parameters<typeof IpcClient.prototype.generateVideo>[0],
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["video-studio", "list"] });
      setSelectedVideoId(result.id);
      toast.success("Video generated successfully");
    },
    onError: (err: Error) => {
      toast.error(`Generation failed: ${err.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => IpcClient.getInstance().deleteVideo(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["video-studio", "list"] });
      if (selectedVideoId === id) setSelectedVideoId(null);
      toast.success("Video deleted");
    },
    onError: (err: Error) => {
      toast.error(`Delete failed: ${err.message}`);
    },
  });

  // ── Callbacks ────────────────────────────────────────────────────────────

  const handleSaveToDisk = useCallback(async (id: number) => {
    try {
      const result = await IpcClient.getInstance().saveVideoToDisk(id);
      if (result.saved) toast.success("Video saved to disk");
    } catch (err) {
      toast.error(
        `Save failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  }, []);

  const handleOpenInFolder = useCallback(async (id: number) => {
    try {
      await IpcClient.getInstance().openVideoInFolder(id);
    } catch (err) {
      toast.error(
        `Open failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  }, []);

  const handleExtractFrames = useCallback(async (id: number) => {
    try {
      const result = await IpcClient.getInstance().extractVideoFrames({
        videoId: id,
        count: 4,
      });
      toast.success(
        `Frame data ready (${result.requestedFrames} frames from ${result.duration}s video)`,
      );
    } catch (err) {
      toast.error(
        `Frame extraction failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  }, []);

  const [promptOverride, setPromptOverride] = useState("");
  const handleReusePrompt = useCallback((prompt: string) => {
    setPromptOverride(prompt);
    toast.success("Prompt copied to generator");
  }, []);

  return (
    <div className="flex h-full overflow-hidden relative">
      {/* Generate Panel */}
      <GeneratePanel
        providers={providers}
        isGenerating={generateMutation.isPending}
        onGenerate={(params) => generateMutation.mutate(params)}
      />

      {/* Gallery */}
      <div className="flex flex-1 overflow-hidden">
        <Gallery
          videos={videos}
          selectedId={selectedVideoId}
          onSelect={setSelectedVideoId}
          onDelete={(id) => deleteMutation.mutate(id)}
          onSaveToDisk={handleSaveToDisk}
          onOpenInFolder={handleOpenInFolder}
          onReusePrompt={handleReusePrompt}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          providerFilter={providerFilter}
          onProviderFilterChange={setProviderFilter}
          availableProviders={providers}
        />
      </div>

      {/* Video Player — right panel */}
      {selectedVideoId !== null && (
        <VideoPlayer
          videoId={selectedVideoId}
          video={selectedVideo}
          onClose={() => setSelectedVideoId(null)}
          onSaveToDisk={handleSaveToDisk}
          onExtractFrames={handleExtractFrames}
        />
      )}
    </div>
  );
}
