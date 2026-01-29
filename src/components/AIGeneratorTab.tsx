import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, X, Sparkles, Lock, Link } from "lucide-react";
import {
  useGenerateThemePrompt,
  useGenerateThemeFromUrl,
} from "@/hooks/useCustomThemes";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { toast } from "sonner";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { AiAccessBanner } from "./ProBanner";
import type {
  ThemeGenerationMode,
  ThemeGenerationModel,
  ThemeInputSource,
} from "@/ipc/types";

// Image upload constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per image (raw file size)
const MAX_IMAGES = 5;

// Default model for AI theme generation
const DEFAULT_THEME_GENERATION_MODEL: ThemeGenerationModel = "gemini-3-pro";

// Image stored with file path (for IPC) and blob URL (for preview)
interface ThemeImage {
  path: string; // File path in temp directory
  preview: string; // Blob URL for displaying thumbnail
}

interface AIGeneratorTabProps {
  aiName: string;
  setAiName: (name: string) => void;
  aiDescription: string;
  setAiDescription: (desc: string) => void;
  aiGeneratedPrompt: string;
  setAiGeneratedPrompt: (prompt: string) => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
  isDialogOpen: boolean;
}

export function AIGeneratorTab({
  aiName,
  setAiName,
  aiDescription,
  setAiDescription,
  aiGeneratedPrompt,
  setAiGeneratedPrompt,
  onSave,
  isSaving,
  isDialogOpen,
}: AIGeneratorTabProps) {
  const [aiImages, setAiImages] = useState<ThemeImage[]>([]);
  const [aiKeywords, setAiKeywords] = useState("");
  const [aiGenerationMode, setAiGenerationMode] =
    useState<ThemeGenerationMode>("inspired");
  const [aiSelectedModel, setAiSelectedModel] = useState<ThemeGenerationModel>(
    DEFAULT_THEME_GENERATION_MODEL,
  );
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track if dialog is open to prevent orphaned uploads from adding images after close
  const isDialogOpenRef = useRef(isDialogOpen);

  // URL-based generation state
  const [inputSource, setInputSource] = useState<ThemeInputSource>("images");
  const [websiteUrl, setWebsiteUrl] = useState("");

  const generatePromptMutation = useGenerateThemePrompt();
  const generateFromUrlMutation = useGenerateThemeFromUrl();
  const isGenerating =
    generatePromptMutation.isPending || generateFromUrlMutation.isPending;
  const { userBudget } = useUserBudgetInfo();

  // Cleanup function to revoke blob URLs and delete temp files
  const cleanupImages = useCallback(
    async (images: ThemeImage[], showErrors = false) => {
      // Revoke blob URLs to free memory
      images.forEach((img) => {
        URL.revokeObjectURL(img.preview);
      });

      // Delete temp files via IPC
      const paths = images.map((img) => img.path);
      if (paths.length > 0) {
        try {
          await ipc.template.cleanupThemeImages({ paths });
        } catch {
          if (showErrors) {
            showError("Failed to cleanup temporary image files");
          }
        }
      }
    },
    [],
  );

  // Keep ref in sync with isDialogOpen prop
  useEffect(() => {
    isDialogOpenRef.current = isDialogOpen;
  }, [isDialogOpen]);

  // Keep a ref to current images for cleanup without causing effect re-runs
  const aiImagesRef = useRef<ThemeImage[]>([]);
  useEffect(() => {
    aiImagesRef.current = aiImages;
  }, [aiImages]);

  // Cleanup images and reset state when dialog closes
  useEffect(() => {
    if (!isDialogOpen) {
      // Use ref to get current images to avoid dependency on aiImages
      const imagesToCleanup = aiImagesRef.current;
      if (imagesToCleanup.length > 0) {
        cleanupImages(imagesToCleanup);
        setAiImages([]);
      }
      setAiKeywords("");
      setAiGenerationMode("inspired");
      setAiSelectedModel(DEFAULT_THEME_GENERATION_MODEL);
      setInputSource("images");
      setWebsiteUrl("");
    }
  }, [isDialogOpen, cleanupImages]);

  const handleImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      const availableSlots = MAX_IMAGES - aiImages.length;
      if (availableSlots <= 0) {
        showError(`Maximum ${MAX_IMAGES} images allowed`);
        return;
      }

      const filesToProcess = Array.from(files).slice(0, availableSlots);
      const skippedCount = files.length - filesToProcess.length;

      if (skippedCount > 0) {
        showError(
          `Only ${availableSlots} image${availableSlots === 1 ? "" : "s"} can be added. ${skippedCount} file${skippedCount === 1 ? " was" : "s were"} skipped.`,
        );
      }

      setIsUploading(true);

      try {
        const newImages: ThemeImage[] = [];

        for (const file of filesToProcess) {
          // Validate file type
          if (!file.type.startsWith("image/")) {
            showError(
              `Please upload only image files. "${file.name}" is not a valid image.`,
            );
            continue;
          }

          // Validate file size (raw file size)
          if (file.size > MAX_FILE_SIZE) {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
            showError(`File "${file.name}" exceeds 10MB limit (${sizeMB}MB)`);
            continue;
          }

          try {
            // Read file as base64 for upload
            const base64Data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = () => reject(new Error("Failed to read file"));
              reader.onload = () => {
                const base64 = reader.result as string;
                const data = base64.split(",")[1];
                if (!data) {
                  reject(new Error("Failed to extract image data"));
                  return;
                }
                resolve(data);
              };
              reader.readAsDataURL(file);
            });

            // Save to temp file via IPC
            const result = await ipc.template.saveThemeImage({
              data: base64Data,
              filename: file.name,
            });

            // Create blob URL for preview (much more memory efficient than base64 in DOM)
            const preview = URL.createObjectURL(file);

            newImages.push({
              path: result.path,
              preview,
            });
          } catch (err) {
            showError(
              `Error processing "${file.name}": ${err instanceof Error ? err.message : "Unknown error"}`,
            );
          }
        }

        if (newImages.length > 0) {
          // Check if dialog was closed while upload was in progress
          if (!isDialogOpenRef.current) {
            // Dialog closed - cleanup orphaned images immediately
            await cleanupImages(newImages);
            return;
          }

          setAiImages((prev) => {
            // Double-check limit in case of race conditions
            const remaining = MAX_IMAGES - prev.length;
            return [...prev, ...newImages.slice(0, remaining)];
          });
        }
      } finally {
        setIsUploading(false);
        // Reset input
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [aiImages.length, cleanupImages],
  );

  const handleRemoveImage = useCallback(
    async (index: number) => {
      const imageToRemove = aiImages[index];
      if (imageToRemove) {
        // Cleanup the removed image - show errors since this is a user action
        await cleanupImages([imageToRemove], true);
      }
      setAiImages((prev) => prev.filter((_, i) => i !== index));
    },
    [aiImages, cleanupImages],
  );

  const handleGenerate = useCallback(async () => {
    if (inputSource === "images") {
      // Image-based generation
      if (aiImages.length === 0) {
        showError("Please upload at least one image");
        return;
      }

      try {
        const result = await generatePromptMutation.mutateAsync({
          imagePaths: aiImages.map((img) => img.path),
          keywords: aiKeywords,
          generationMode: aiGenerationMode,
          model: aiSelectedModel,
        });
        setAiGeneratedPrompt(result.prompt);
        toast.success("Theme prompt generated successfully");
      } catch (error) {
        showError(
          `Failed to generate theme: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    } else {
      // URL-based generation
      if (!websiteUrl.trim()) {
        showError("Please enter a website URL");
        return;
      }

      try {
        const result = await generateFromUrlMutation.mutateAsync({
          url: websiteUrl,
          keywords: aiKeywords,
          generationMode: aiGenerationMode,
          model: aiSelectedModel,
        });

        setAiGeneratedPrompt(result.prompt);
        toast.success("Theme prompt generated from website");
      } catch (error) {
        showError(
          `Failed to generate theme: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  }, [
    inputSource,
    aiImages,
    websiteUrl,
    aiKeywords,
    aiGenerationMode,
    aiSelectedModel,
    generatePromptMutation,
    generateFromUrlMutation,
    setAiGeneratedPrompt,
  ]);

  // Show Pro-only locked state for non-Pro users
  if (!userBudget) {
    return (
      <div className="space-y-4 mt-4">
        <div className="flex flex-col items-center justify-center py-8 px-4 border-2 border-dashed border-muted-foreground/25 rounded-lg bg-muted/10">
          <Lock className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-center mb-2">
            AI Theme Generator
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Upload screenshots and let AI generate a custom theme prompt
            tailored to your design style.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-2">
            Pro-only feature
          </p>
        </div>
        <AiAccessBanner />
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="space-y-2">
        <Label htmlFor="ai-name">Theme Name</Label>
        <Input
          id="ai-name"
          placeholder="My AI-Generated Theme"
          value={aiName}
          onChange={(e) => setAiName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ai-description">Description (optional)</Label>
        <Input
          id="ai-description"
          placeholder="A brief description of your theme"
          value={aiDescription}
          onChange={(e) => setAiDescription(e.target.value)}
        />
      </div>

      {/* Input Source Toggle */}
      <div className="space-y-3">
        <Label>Reference Source</Label>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setInputSource("images")}
            className={`flex flex-col items-center rounded-lg border p-3 text-center transition-colors ${
              inputSource === "images"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
          >
            <Upload className="h-5 w-5 mb-1" />
            <span className="font-medium text-sm">Upload Images</span>
            <span className="text-xs text-muted-foreground mt-1">
              Use screenshots from your device
            </span>
          </button>
          <button
            type="button"
            onClick={() => setInputSource("url")}
            className={`flex flex-col items-center rounded-lg border p-3 text-center transition-colors ${
              inputSource === "url"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
          >
            <Link className="h-5 w-5 mb-1" />
            <span className="font-medium text-sm">Website URL</span>
            <span className="text-xs text-muted-foreground mt-1">
              Extract design from a live website
            </span>
          </button>
        </div>
      </div>

      {/* Image Upload Section - only shown when inputSource is "images" */}
      {inputSource === "images" && (
        <div className="space-y-2">
          <Label>Reference Images</Label>
          <div
            className={`border-2 border-dashed border-muted-foreground/25 rounded-lg p-4 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors ${isUploading ? "opacity-50 pointer-events-none" : ""}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImageUpload}
              disabled={isUploading}
            />
            {isUploading ? (
              <Loader2 className="h-8 w-8 mx-auto text-muted-foreground mb-2 animate-spin" />
            ) : (
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            )}
            <p className="text-sm text-muted-foreground">
              {isUploading ? "Uploading..." : "Click to upload images"}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Upload UI screenshots to inspire your theme
            </p>
          </div>

          {/* Image counter */}
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {aiImages.length} / {MAX_IMAGES} images
            {aiImages.length >= MAX_IMAGES && (
              <span className="text-destructive ml-2">• Maximum reached</span>
            )}
          </p>

          {/* Image Preview */}
          {aiImages.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {aiImages.map((img, index) => (
                <div key={img.path} className="relative group">
                  <img
                    src={img.preview}
                    alt={`Upload ${index + 1}`}
                    className="h-16 w-16 object-cover rounded-md border"
                  />
                  <button
                    onClick={() => handleRemoveImage(index)}
                    className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* URL Input Section - only shown when inputSource is "url" */}
      {inputSource === "url" && (
        <div className="space-y-2">
          <Label htmlFor="website-url">Website URL</Label>
          <Input
            id="website-url"
            type="url"
            placeholder="https://example.com"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            disabled={isGenerating}
          />
          <p className="text-xs text-muted-foreground">
            Enter a website URL to extract its design system
          </p>
        </div>
      )}

      {/* Keywords Input */}
      <div className="space-y-2">
        <Label htmlFor="ai-keywords">Keywords (optional)</Label>
        <Input
          id="ai-keywords"
          placeholder="modern, minimal, dark mode, glassmorphism..."
          value={aiKeywords}
          onChange={(e) => setAiKeywords(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Add keywords or reference designs to guide the generation
        </p>
      </div>

      {/* Generation Mode Selection */}
      <div className="space-y-3">
        <Label>Generation Mode</Label>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setAiGenerationMode("inspired")}
            className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
              aiGenerationMode === "inspired"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
          >
            <span className="font-medium">Inspired</span>
            <span className="text-xs text-muted-foreground mt-1">
              Extracts an abstract, reusable design system. Does not replicate
              the original UI.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setAiGenerationMode("high-fidelity")}
            className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
              aiGenerationMode === "high-fidelity"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
          >
            <span className="font-medium">High Fidelity</span>
            <span className="text-xs text-muted-foreground mt-1">
              Recreates the visual system from the image as closely as possible.
            </span>
          </button>
        </div>
      </div>

      {/* Model Selection */}
      <div className="space-y-3">
        <Label>Model Selection</Label>
        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setAiSelectedModel("gemini-3-pro")}
            className={`flex flex-col items-center rounded-lg border p-3 text-center transition-colors ${
              aiSelectedModel === "gemini-3-pro"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
          >
            <span className="font-medium text-sm">Gemini 3 Pro</span>
            <span className="text-xs text-muted-foreground mt-1">
              Most capable
            </span>
          </button>
          <button
            type="button"
            onClick={() => setAiSelectedModel("claude-opus-4.5")}
            className={`flex flex-col items-center rounded-lg border p-3 text-center transition-colors ${
              aiSelectedModel === "claude-opus-4.5"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
          >
            <span className="font-medium text-sm">Claude Opus 4.5</span>
            <span className="text-xs text-muted-foreground mt-1">
              Creative & detailed
            </span>
          </button>
          <button
            type="button"
            onClick={() => setAiSelectedModel("gpt-5.2")}
            className={`flex flex-col items-center rounded-lg border p-3 text-center transition-colors ${
              aiSelectedModel === "gpt-5.2"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/50"
            }`}
          >
            <span className="font-medium text-sm">GPT 5.2</span>
            <span className="text-xs text-muted-foreground mt-1">
              Latest OpenAI
            </span>
          </button>
        </div>
      </div>

      {/* Generate Button */}
      <Button
        onClick={handleGenerate}
        disabled={
          isGenerating ||
          (inputSource === "images" && aiImages.length === 0) ||
          (inputSource === "url" && !websiteUrl.trim())
        }
        variant="secondary"
        className="w-full"
      >
        {isGenerating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {inputSource === "url"
              ? "Generating from website..."
              : "Generating prompt..."}
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" />
            Generate Theme Prompt
          </>
        )}
      </Button>

      {/* Generated Prompt Display */}
      <div className="space-y-2">
        <Label htmlFor="ai-prompt">Generated Prompt</Label>
        {aiGeneratedPrompt ? (
          <Textarea
            id="ai-prompt"
            className="min-h-[200px] font-mono text-sm"
            value={aiGeneratedPrompt}
            onChange={(e) => setAiGeneratedPrompt(e.target.value)}
            placeholder="Generated prompt will appear here..."
          />
        ) : (
          <div className="min-h-[100px] border rounded-md p-4 flex items-center justify-center text-muted-foreground text-sm text-center">
            No prompt generated yet.{" "}
            {inputSource === "images"
              ? 'Upload images and click "Generate" to create a theme prompt.'
              : 'Enter a website URL and click "Generate" to extract a theme.'}
          </div>
        )}
      </div>

      {/* Save Button - only show when prompt is generated */}
      {aiGeneratedPrompt && (
        <Button
          onClick={onSave}
          disabled={isSaving || !aiName.trim()}
          className="w-full"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            "Save Theme"
          )}
        </Button>
      )}
    </div>
  );
}
