import { useState, useCallback, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Upload, X, Sparkles, PenLine } from "lucide-react";
import {
  useCreateCustomTheme,
  useGenerateThemePrompt,
} from "@/hooks/useCustomThemes";
import { toast } from "sonner";
import type { ThemeGenerationMode } from "@/ipc/ipc_types";

// Image upload constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per image (raw file size)
const MAX_IMAGES = 5;

interface CustomThemeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appId?: number; // optional - undefined for global themes
  onThemeCreated?: (themeId: number) => void; // callback when theme is created
}

export function CustomThemeDialog({
  open,
  onOpenChange,
  appId,
  onThemeCreated,
}: CustomThemeDialogProps) {
  const [activeTab, setActiveTab] = useState<"manual" | "ai">("manual");

  // Manual tab state
  const [manualName, setManualName] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualPrompt, setManualPrompt] = useState("");

  // AI tab state
  const [aiName, setAiName] = useState("");
  const [aiDescription, setAiDescription] = useState("");
  const [aiImages, setAiImages] = useState<string[]>([]);
  const [aiKeywords, setAiKeywords] = useState("");
  const [aiGenerationMode, setAiGenerationMode] =
    useState<ThemeGenerationMode>("inspired");
  const [aiGeneratedPrompt, setAiGeneratedPrompt] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createThemeMutation = useCreateCustomTheme();
  const generatePromptMutation = useGenerateThemePrompt();

  const resetForm = useCallback(() => {
    setManualName("");
    setManualDescription("");
    setManualPrompt("");
    setAiName("");
    setAiDescription("");
    setAiImages([]);
    setAiKeywords("");
    setAiGenerationMode("inspired");
    setAiGeneratedPrompt("");
    setActiveTab("manual");
  }, []);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open, resetForm]);

  const handleClose = useCallback(() => {
    resetForm();
    onOpenChange(false);
  }, [onOpenChange, resetForm]);

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      Array.from(files).forEach((file) => {
        // Check image count limit first
        if (aiImages.length >= MAX_IMAGES) {
          toast.error(`Maximum ${MAX_IMAGES} images allowed`);
          return;
        }

        // Validate file type
        if (!file.type.startsWith("image/")) {
          toast.error(
            `Please upload only image files. "${file.name}" is not a valid image.`,
          );
          return;
        }

        // Validate file size (raw file size)
        if (file.size > MAX_FILE_SIZE) {
          const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
          toast.error(`File "${file.name}" exceeds 10MB limit (${sizeMB}MB)`);
          return;
        }

        const reader = new FileReader();

        reader.onerror = () => {
          toast.error(`Failed to read file "${file.name}". Please try again.`);
        };

        reader.onload = () => {
          try {
            const base64 = reader.result as string;
            if (!base64 || typeof base64 !== "string") {
              throw new Error("Invalid file data");
            }

            const base64Data = base64.split(",")[1];
            if (!base64Data) {
              throw new Error("Failed to extract image data");
            }

            setAiImages((prev) => [...prev, base64Data]);
          } catch (err) {
            toast.error(
              `Error processing "${file.name}": ${err instanceof Error ? err.message : "Unknown error"}`,
            );
          }
        };

        reader.readAsDataURL(file);
      });

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [aiImages.length],
  );

  const handleRemoveImage = useCallback((index: number) => {
    setAiImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (aiImages.length === 0) {
      toast.error("Please upload at least one image");
      return;
    }

    try {
      const result = await generatePromptMutation.mutateAsync({
        images: aiImages,
        keywords: aiKeywords,
        generationMode: aiGenerationMode,
      });
      setAiGeneratedPrompt(result.prompt);
      toast.success("Theme prompt generated successfully");
    } catch (error) {
      toast.error(
        `Failed to generate theme: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [aiImages, aiKeywords, aiGenerationMode, generatePromptMutation]);

  const handleSaveManual = useCallback(async () => {
    if (!manualName.trim()) {
      toast.error("Please enter a theme name");
      return;
    }
    if (!manualPrompt.trim()) {
      toast.error("Please enter a theme prompt");
      return;
    }

    try {
      const createdTheme = await createThemeMutation.mutateAsync({
        appId,
        name: manualName.trim(),
        description: manualDescription.trim() || undefined,
        prompt: manualPrompt.trim(),
      });
      toast.success("Custom theme created successfully");
      onThemeCreated?.(createdTheme.id);
      handleClose();
    } catch (error) {
      toast.error(
        `Failed to create theme: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [
    appId,
    manualName,
    manualDescription,
    manualPrompt,
    createThemeMutation,
    onThemeCreated,
    handleClose,
  ]);

  const handleSaveAI = useCallback(async () => {
    if (!aiName.trim()) {
      toast.error("Please enter a theme name");
      return;
    }
    if (!aiGeneratedPrompt.trim()) {
      toast.error("Please generate a prompt first");
      return;
    }

    try {
      const createdTheme = await createThemeMutation.mutateAsync({
        appId,
        name: aiName.trim(),
        description: aiDescription.trim() || undefined,
        prompt: aiGeneratedPrompt.trim(),
      });
      toast.success("Custom theme created successfully");
      onThemeCreated?.(createdTheme.id);
      handleClose();
    } catch (error) {
      toast.error(
        `Failed to create theme: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [
    appId,
    aiName,
    aiDescription,
    aiGeneratedPrompt,
    createThemeMutation,
    onThemeCreated,
    handleClose,
  ]);

  const isSaving = createThemeMutation.isPending;
  const isGenerating = generatePromptMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Custom Theme</DialogTitle>
          <DialogDescription>
            Create a custom theme using manual configuration or AI-powered
            generation.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "manual" | "ai")}
          className="mt-4"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual" className="flex items-center gap-2">
              <PenLine className="h-4 w-4" />
              Manual Configuration
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              AI-Powered Generator
            </TabsTrigger>
          </TabsList>

          {/* Manual Configuration Tab */}
          <TabsContent value="manual" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="manual-name">Theme Name</Label>
              <Input
                id="manual-name"
                placeholder="My Custom Theme"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="manual-description">Description (optional)</Label>
              <Input
                id="manual-description"
                placeholder="A brief description of your theme"
                value={manualDescription}
                onChange={(e) => setManualDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="manual-prompt">Theme Prompt</Label>
              <Textarea
                id="manual-prompt"
                placeholder="Enter your theme system prompt..."
                className="min-h-[200px] font-mono text-sm"
                value={manualPrompt}
                onChange={(e) => setManualPrompt(e.target.value)}
              />
            </div>

            <Button
              onClick={handleSaveManual}
              disabled={isSaving || !manualName.trim() || !manualPrompt.trim()}
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
          </TabsContent>

          {/* AI-Powered Generator Tab */}
          <TabsContent value="ai" className="space-y-4 mt-4">
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

            {/* Image Upload Section */}
            <div className="space-y-2">
              <Label>Reference Images</Label>
              <div
                className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-4 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleImageUpload}
                />
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  Click to upload images or drag and drop
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Upload UI screenshots to inspire your theme
                </p>
              </div>

              {/* Image counter */}
              <p className="text-xs text-muted-foreground mt-2 text-center">
                {aiImages.length} / {MAX_IMAGES} images
                {aiImages.length >= MAX_IMAGES && (
                  <span className="text-destructive ml-2">
                    • Maximum reached
                  </span>
                )}
              </p>

              {/* Image Preview */}
              {aiImages.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {aiImages.map((img, index) => (
                    <div key={index} className="relative group">
                      <img
                        src={`data:image/png;base64,${img}`}
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
                    Extracts an abstract, reusable design system. Does not
                    replicate the original UI.
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
                    Recreates the visual system from the image as closely as
                    possible.
                  </span>
                </button>
              </div>
            </div>

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || aiImages.length === 0}
              variant="secondary"
              className="w-full"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating prompt...
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
                <div className="min-h-[100px] border rounded-md p-4 flex items-center justify-center text-muted-foreground text-sm">
                  No prompt generated yet. Upload images and click "Generate" to
                  create a theme prompt.
                </div>
              )}
            </div>

            {/* Save Button - only show when prompt is generated */}
            {aiGeneratedPrompt && (
              <Button
                onClick={handleSaveAI}
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
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
