import { useState, useEffect, useRef } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Save, Edit2, Loader2 } from "lucide-react";
import { showError } from "@/lib/toast";
import { toast } from "sonner";
import type { CustomTheme } from "@/ipc/types";
import { useTranslation } from "react-i18next";

interface EditThemeDialogProps {
  theme: CustomTheme;
  onUpdateTheme: (params: {
    id: number;
    name: string;
    description?: string;
    prompt: string;
  }) => Promise<void>;
  trigger?: React.ReactNode;
}

export function EditThemeDialog({
  theme,
  onUpdateTheme,
  trigger,
}: EditThemeDialogProps) {
  const { t } = useTranslation("home");
  const { t: tc } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    prompt: "",
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea function
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      const currentHeight = textarea.style.height;
      textarea.style.height = "auto";
      const scrollHeight = textarea.scrollHeight;
      const maxHeight = window.innerHeight * 0.5;
      const minHeight = 150;
      const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);

      if (`${newHeight}px` !== currentHeight) {
        textarea.style.height = `${newHeight}px`;
      }
    }
  };

  // Initialize draft with theme data
  useEffect(() => {
    if (open) {
      setDraft({
        name: theme.name,
        description: theme.description || "",
        prompt: theme.prompt,
      });
    }
  }, [open, theme]);

  // Auto-resize textarea when content changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [draft.prompt]);

  // Trigger resize when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(adjustTextareaHeight, 0);
    }
  }, [open]);

  const handleSave = async () => {
    if (!draft.name.trim() || !draft.prompt.trim()) return;

    setIsSaving(true);
    try {
      await onUpdateTheme({
        id: theme.id,
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        prompt: draft.prompt.trim(),
      });
      toast.success(t("editTheme.themeUpdated"));
      setOpen(false);
    } catch (error) {
      showError(
        t("editTheme.failedUpdateTheme", {
          error: error instanceof Error ? error.message : tc("unknownError"),
        }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft({
      name: theme.name,
      description: theme.description || "",
      prompt: theme.prompt,
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <DialogTrigger
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
          data-testid="edit-theme-button"
          title={t("editTheme.title")}
        >
          <Edit2 className="h-4 w-4" />
        </DialogTrigger>
      )}
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("editTheme.title")}</DialogTitle>
          <DialogDescription>{t("editTheme.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div className="space-y-2">
            <label htmlFor="edit-theme-name" className="text-sm font-medium">
              {t("editTheme.themeName")}
            </label>
            <Input
              id="edit-theme-name"
              placeholder={t("editTheme.themeNamePlaceholder")}
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="edit-theme-description"
              className="text-sm font-medium"
            >
              {t("editTheme.descriptionOptional")}
            </label>
            <Input
              id="edit-theme-description"
              placeholder={t("editTheme.descriptionPlaceholder")}
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="edit-theme-prompt" className="text-sm font-medium">
              {t("editTheme.themePrompt")}
            </label>
            <Textarea
              id="edit-theme-prompt"
              ref={textareaRef}
              placeholder={t("editTheme.themePromptPlaceholder")}
              value={draft.prompt}
              onChange={(e) => {
                setDraft((d) => ({ ...d, prompt: e.target.value }));
                requestAnimationFrame(adjustTextareaHeight);
              }}
              className="resize-none overflow-y-auto font-mono text-sm"
              style={{ minHeight: "150px" }}
            />
          </div>
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
            {tc("cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !draft.name.trim() || !draft.prompt.trim()}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {tc("saving")}
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" /> {tc("save")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
