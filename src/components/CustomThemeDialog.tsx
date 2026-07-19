import { useState, useCallback } from "react";
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
import { Loader2, Sparkles, PenLine } from "lucide-react";
import { useCreateCustomTheme } from "@/hooks/useCustomThemes";
import { showError } from "@/lib/toast";
import { toast } from "sonner";
import { AIGeneratorTab } from "./AIGeneratorTab";
import { useTranslation } from "react-i18next";

interface CustomThemeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onThemeCreated?: (themeId: number) => void; // callback when theme is created
}

export function CustomThemeDialog({
  open,
  onOpenChange,
  onThemeCreated,
}: CustomThemeDialogProps) {
  const { t } = useTranslation("home");
  const { t: tc } = useTranslation("common");
  const [activeTab, setActiveTab] = useState<"manual" | "ai">("ai");

  // Manual tab state
  const [manualName, setManualName] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualPrompt, setManualPrompt] = useState("");

  // AI tab state (shared with AIGeneratorTab)
  const [aiName, setAiName] = useState("");
  const [aiDescription, setAiDescription] = useState("");
  const [aiGeneratedPrompt, setAiGeneratedPrompt] = useState("");

  const createThemeMutation = useCreateCustomTheme();

  const resetForm = useCallback(() => {
    setManualName("");
    setManualDescription("");
    setManualPrompt("");
    setAiName("");
    setAiDescription("");
    setAiGeneratedPrompt("");
    setActiveTab("ai");
  }, []);

  const handleClose = useCallback(async () => {
    resetForm();
    onOpenChange(false);
  }, [onOpenChange, resetForm]);

  const handleSave = useCallback(async () => {
    const isManual = activeTab === "manual";
    const name = isManual ? manualName : aiName;
    const description = isManual ? manualDescription : aiDescription;
    const prompt = isManual ? manualPrompt : aiGeneratedPrompt;

    if (!name.trim()) {
      showError(t("customTheme.enterThemeName"));
      return;
    }
    if (!prompt.trim()) {
      showError(
        isManual
          ? t("customTheme.enterThemePrompt")
          : t("customTheme.generatePromptFirst"),
      );
      return;
    }

    try {
      const createdTheme = await createThemeMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        prompt: prompt.trim(),
      });
      toast.success(t("customTheme.themeCreated"));
      onThemeCreated?.(createdTheme.id);
      await handleClose();
    } catch (error) {
      showError(
        t("customTheme.failedCreateTheme", {
          error: error instanceof Error ? error.message : tc("unknownError"),
        }),
      );
    }
  }, [
    activeTab,
    manualName,
    manualDescription,
    manualPrompt,
    aiName,
    aiDescription,
    aiGeneratedPrompt,
    createThemeMutation,
    onThemeCreated,
    handleClose,
    t,
  ]);

  const isSaving = createThemeMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("customTheme.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("customTheme.createDescription")}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "manual" | "ai")}
          className="mt-4"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="ai" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              {t("customTheme.aiPoweredGenerator")}
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex items-center gap-2">
              <PenLine className="h-4 w-4" />
              {t("customTheme.manualConfiguration")}
            </TabsTrigger>
          </TabsList>

          {/* AI-Powered Generator Tab */}
          <TabsContent value="ai">
            <AIGeneratorTab
              aiName={aiName}
              setAiName={setAiName}
              aiDescription={aiDescription}
              setAiDescription={setAiDescription}
              aiGeneratedPrompt={aiGeneratedPrompt}
              setAiGeneratedPrompt={setAiGeneratedPrompt}
              onSave={handleSave}
              isSaving={isSaving}
              isDialogOpen={open}
            />
          </TabsContent>

          {/* Manual Configuration Tab */}
          <TabsContent value="manual" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="manual-name">{t("customTheme.themeName")}</Label>
              <Input
                id="manual-name"
                placeholder={t("customTheme.themeNamePlaceholder")}
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="manual-description">
                {t("customTheme.descriptionOptional")}
              </Label>
              <Input
                id="manual-description"
                placeholder={t("customTheme.descriptionPlaceholder")}
                value={manualDescription}
                onChange={(e) => setManualDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="manual-prompt">
                {t("customTheme.themePrompt")}
              </Label>
              <Textarea
                id="manual-prompt"
                placeholder={t("customTheme.themePromptPlaceholder")}
                className="min-h-[200px] font-mono text-sm"
                value={manualPrompt}
                onChange={(e) => setManualPrompt(e.target.value)}
              />
            </div>

            <Button
              onClick={handleSave}
              disabled={isSaving || !manualName.trim() || !manualPrompt.trim()}
              className="w-full"
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {tc("saving")}
                </>
              ) : (
                t("customTheme.saveTheme")
              )}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
