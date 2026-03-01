import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Loader2,
  ImageIcon,
  Box,
  Camera,
  Layers,
  Sparkles,
  ChevronsUpDown,
  Check,
  Search,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useGenerateImage } from "@/hooks/useGenerateImage";
import { useMediaDataUri } from "@/hooks/useMediaDataUri";
import type { ImageThemeMode, GenerateImageResponse } from "@/ipc/types";

const THEME_MODES: {
  value: ImageThemeMode;
  label: string;
  description: string;
  icon: typeof ImageIcon;
}[] = [
  {
    value: "plain",
    label: "Plain",
    description: "No style applied",
    icon: Sparkles,
  },
  {
    value: "3d-clay",
    label: "3D / Clay",
    description: "Soft, rounded clay aesthetic",
    icon: Box,
  },
  {
    value: "real-photography",
    label: "Photography",
    description: "Photorealistic DSLR quality",
    icon: Camera,
  },
  {
    value: "isometric-illustration",
    label: "Isometric",
    description: "Clean geometric illustrations",
    icon: Layers,
  },
];

function ImageGenerationPlaceholder() {
  return (
    <motion.div
      className="w-full aspect-square max-w-xs mx-auto rounded-lg border-2 border-dashed border-muted-foreground/25 flex flex-col items-center justify-center gap-3 bg-muted/10"
      animate={{ opacity: [0.5, 1, 0.5] }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
    >
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
      >
        <Loader2 className="h-10 w-10 text-primary" />
      </motion.div>
      <p className="text-sm text-muted-foreground font-medium">
        Generating your image...
      </p>
      <p className="text-xs text-muted-foreground/60">
        This may take up to a minute
      </p>
    </motion.div>
  );
}

function GeneratedImagePreview({ result }: { result: GenerateImageResponse }) {
  const dataUri = useMediaDataUri(result.appId, result.fileName);

  return (
    <div className="flex flex-col items-center gap-3">
      {dataUri ? (
        <img
          src={dataUri}
          alt="Generated image"
          className="w-full max-w-sm rounded-lg border shadow-sm"
        />
      ) : (
        <div className="w-full max-w-sm aspect-square rounded-lg border bg-muted/10 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Saved to <span className="font-medium">{result.appName}</span> as{" "}
        <span className="font-mono text-xs">{result.fileName}</span>
      </p>
    </div>
  );
}

function AppSearchSelect({
  apps,
  selectedAppId,
  onSelect,
  disabled,
}: {
  apps: { id: number; name: string }[];
  selectedAppId: number | null;
  onSelect: (appId: number) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredApps = useMemo(() => {
    if (!search.trim()) return apps;
    const q = search.toLowerCase();
    return apps.filter((app) => app.name.toLowerCase().includes(q));
  }, [apps, search]);

  const selectedApp = apps.find((a) => a.id === selectedAppId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={selectedApp ? "" : "text-muted-foreground"}>
          {selectedApp?.name ?? "Select an app..."}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[--anchor-width] p-0" align="start">
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            placeholder="Search apps..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 border-0 shadow-none focus-visible:ring-0 px-0"
          />
        </div>
        <div className="max-h-[200px] overflow-y-auto p-1">
          {filteredApps.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No apps found.
            </p>
          ) : (
            filteredApps.map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => {
                  onSelect(app.id);
                  setOpen(false);
                  setSearch("");
                }}
                className="relative flex w-full cursor-default items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              >
                {app.id === selectedAppId && (
                  <Check className="absolute left-2 h-4 w-4" />
                )}
                {app.name}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ImageGeneratorDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [themeMode, setThemeMode] = useState<ImageThemeMode>("plain");
  const [targetAppId, setTargetAppId] = useState<number | null>(null);
  const [generatedResult, setGeneratedResult] =
    useState<GenerateImageResponse | null>(null);

  const { apps } = useLoadApps();
  const generateImage = useGenerateImage();

  const handleGenerate = () => {
    if (!prompt.trim() || targetAppId === null) return;

    generateImage.mutate(
      {
        prompt: prompt.trim(),
        themeMode,
        targetAppId,
      },
      {
        onSuccess: (result) => {
          setGeneratedResult(result);
        },
      },
    );
  };

  const handleNewGeneration = () => {
    setGeneratedResult(null);
    setPrompt("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setGeneratedResult(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            Generate Image
          </DialogTitle>
          <DialogDescription>
            Describe the image you want to generate and choose a visual style.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Generated Image Preview */}
          {generatedResult && (
            <GeneratedImagePreview result={generatedResult} />
          )}

          {/* Prompt */}
          <div className="space-y-2">
            <Label htmlFor="image-prompt">Prompt</Label>
            <Textarea
              id="image-prompt"
              placeholder="Describe the image you want to create..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={generateImage.isPending}
              className="min-h-[100px] resize-none"
            />
          </div>

          {/* Theme Mode Selector */}
          <div className="space-y-2">
            <Label>Style</Label>
            <div className="grid grid-cols-2 gap-2">
              {THEME_MODES.map((mode) => {
                const Icon = mode.icon;
                const isSelected = themeMode === mode.value;
                return (
                  <button
                    key={mode.value}
                    type="button"
                    disabled={generateImage.isPending}
                    onClick={() => setThemeMode(mode.value)}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/30 hover:bg-muted/50"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <Icon
                      className={`h-5 w-5 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
                    />
                    <div className="min-w-0">
                      <div
                        className={`text-sm font-medium ${isSelected ? "text-primary" : ""}`}
                      >
                        {mode.label}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {mode.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Target App Selector */}
          <div className="space-y-2">
            <Label>Save to App</Label>
            <AppSearchSelect
              apps={apps}
              selectedAppId={targetAppId}
              onSelect={setTargetAppId}
              disabled={generateImage.isPending}
            />
          </div>

          {/* Loading Placeholder */}
          {generateImage.isPending && <ImageGenerationPlaceholder />}
        </div>

        <DialogFooter>
          {generatedResult ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={handleNewGeneration}>Generate Another</Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={generateImage.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={
                  !prompt.trim() ||
                  targetAppId === null ||
                  generateImage.isPending
                }
              >
                {generateImage.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  "Generate"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
