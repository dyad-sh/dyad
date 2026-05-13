import { useState, useEffect } from "react";
import {
  ImageIcon,
  Box,
  Camera,
  Layers,
  Sparkles,
  Lock,
  Loader2,
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
import { useLoadApps } from "@/hooks/useLoadApps";
import { useGenerateImage } from "@/hooks/useGenerateImage";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { AiAccessBanner } from "./ProBanner";
import { AppSearchSelect } from "./AppSearchSelect";
import type { ImageThemeMode } from "@/ipc/types";

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

export function ImageGeneratorDialog({
  open,
  onOpenChange,
  defaultAppId,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultAppId?: number;
  source?: "chat" | "media-library";
}) {
  const [prompt, setPrompt] = useState("");
  const [themeMode, setThemeMode] = useState<ImageThemeMode>("plain");
  const [targetAppId, setTargetAppId] = useState<number | null>(null);

  const { apps } = useLoadApps();
  const generateImage = useGenerateImage();
  const { userBudget, isLoadingUserBudget: isBudgetLoading } =
    useUserBudgetInfo();

  // Sync defaultAppId only when dialog opens (not while already open)
  useEffect(() => {
    if (open && defaultAppId != null) {
      setTargetAppId(defaultAppId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const effectiveTargetAppId =
    targetAppId ?? (apps.length === 1 ? apps[0].id : null);

  const handleGenerate = () => {
    if (!prompt.trim() || effectiveTargetAppId === null) return;

    const targetApp = apps.find((a) => a.id === effectiveTargetAppId);
    if (!targetApp) return;

    generateImage.mutate({
      requestId: crypto.randomUUID(),
      prompt: prompt.trim(),
      themeMode,
      targetAppId: effectiveTargetAppId,
      targetAppName: targetApp.name,
      source,
    });

    // Auto-close dialog immediately after starting generation
    handleOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setPrompt("");
      setThemeMode("plain");
      setTargetAppId(null);
      generateImage.reset();
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
          {isBudgetLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !userBudget ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center py-8 px-4 border-2 border-dashed border-muted-foreground/25 rounded-lg bg-muted/10">
                <Lock className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold text-center mb-2">
                  AI Image Generator
                </h3>
                <p className="text-sm text-muted-foreground text-center max-w-md">
                  Generate custom images using AI to use in your apps.
                </p>
                <p className="text-xs text-muted-foreground/70 mt-2">
                  Pro-only feature
                </p>
              </div>
              <AiAccessBanner />
            </div>
          ) : (
            <>
              {/* Prompt */}
              <div className="space-y-2">
                <Label htmlFor="image-prompt">Prompt</Label>
                <Textarea
                  id="image-prompt"
                  placeholder="Describe the image you want to create..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
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
                        aria-pressed={isSelected}
                        onClick={() => setThemeMode(mode.value)}
                        className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/30 hover:bg-muted/50"
                        }`}
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
                  selectedAppId={effectiveTargetAppId}
                  onSelect={setTargetAppId}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            {!prompt.trim() || effectiveTargetAppId === null ? (
              <p className="text-xs text-muted-foreground">
                {!prompt.trim() && effectiveTargetAppId === null
                  ? "Enter a prompt and select an app"
                  : !prompt.trim()
                    ? "Enter a prompt to generate"
                    : "Select an app to save to"}
              </p>
            ) : null}
            <Button
              onClick={handleGenerate}
              disabled={!prompt.trim() || effectiveTargetAppId === null}
            >
              Generate
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
