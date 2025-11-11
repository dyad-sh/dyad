import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, Save, Edit2 } from "lucide-react";

interface CreateOrEditPromptDialogProps {
  mode: "create" | "edit";
  prompt?: {
    id: number;
    title: string;
    description: string | null;
    content: string;
  };
  onCreatePrompt?: (prompt: {
    title: string;
    description?: string;
    content: string;
  }) => Promise<any>;
  onUpdatePrompt?: (prompt: {
    id: number;
    title: string;
    description?: string;
    content: string;
  }) => Promise<any>;
  trigger?: React.ReactNode;
  prefillData?: {
    title: string;
    description: string;
    content: string;
  };
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateOrEditPromptDialog({
  mode,
  prompt,
  onCreatePrompt,
  onUpdatePrompt,
  trigger,
  prefillData,
  isOpen,
  onOpenChange,
}: CreateOrEditPromptDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;

  const [draft, setDraft] = useState({
    title: "",
    description: "",
    content: "",
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea function
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Store current height to avoid flicker
      const currentHeight = textarea.style.height;
      textarea.style.height = "auto";
      const scrollHeight = textarea.scrollHeight;
      const maxHeight = window.innerHeight * 0.6 - 100; // 60vh in pixels
      const minHeight = 150; // 150px minimum
      const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);

      // Only update if height actually changed to reduce reflows
      if (`${newHeight}px` !== currentHeight) {
        textarea.style.height = `${newHeight}px`;
      }
    }
  };

  // Initialize draft with prompt data when editing or prefill data
  useEffect(() => {
    if (mode === "edit" && prompt) {
      setDraft({
        title: prompt.title,
        description: prompt.description || "",
        content: prompt.content,
      });
    } else if (prefillData) {
      setDraft({
        title: prefillData.title,
        description: prefillData.description,
        content: prefillData.content,
      });
    } else {
      setDraft({ title: "", description: "", content: "" });
    }
  }, [mode, prompt, prefillData, open]);

  // Auto-resize textarea when content changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [draft.content]);

  // Trigger resize when dialog opens
  useEffect(() => {
    if (open) {
      // Small delay to ensure the dialog is fully rendered
      setTimeout(adjustTextareaHeight, 0);
    }
  }, [open]);

  const resetDraft = () => {
    if (mode === "edit" && prompt) {
      setDraft({
        title: prompt.title,
        description: prompt.description || "",
        content: prompt.content,
      });
    } else if (prefillData) {
      setDraft({
        title: prefillData.title,
        description: prefillData.description,
        content: prefillData.content,
      });
    } else {
      setDraft({ title: "", description: "", content: "" });
    }
  };

  const onSave = async () => {
    if (!draft.title.trim() || !draft.content.trim()) return;

    if (mode === "create" && onCreatePrompt) {
      await onCreatePrompt({
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        content: draft.content,
      });
    } else if (mode === "edit" && onUpdatePrompt && prompt) {
      await onUpdatePrompt({
        id: prompt.id,
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        content: draft.content,
      });
    }

    setOpen(false);
  };

  const handleCancel = () => {
    resetDraft();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : mode === "create" ? (
        <DialogTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" /> New Prompt
          </Button>
        </DialogTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                data-testid="edit-prompt-button"
              >
                <Edit2 className="h-4 w-4" />
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>Edit prompt</p>
          </TooltipContent>
        </Tooltip>
      )}
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create New Prompt" : "Edit Prompt"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create a new prompt template for your library."
              : "Edit your prompt template."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="Title"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
          <Input
            placeholder="Description (optional)"
            value={draft.description}
            onChange={(e) =>
              setDraft((d) => ({ ...d, description: e.target.value }))
            }
          />
          <Textarea
            ref={textareaRef}
            placeholder="Content"
            value={draft.content}
            onChange={(e) => {
              setDraft((d) => ({ ...d, content: e.target.value }));
              // Use requestAnimationFrame for smoother updates
              requestAnimationFrame(adjustTextareaHeight);
            }}
            className="resize-none overflow-y-auto"
            style={{ minHeight: "150px" }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={!draft.title.trim() || !draft.content.trim()}
          >
            <Save className="mr-2 h-4 w-4" /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Backward compatibility wrapper for create mode
export function CreatePromptDialog({
  onCreatePrompt,
  prefillData,
  isOpen,
  onOpenChange,
}: {
  onCreatePrompt: (prompt: {
    title: string;
    description?: string;
    content: string;
  }) => Promise<any>;
  prefillData?: {
    title: string;
    description: string;
    content: string;
  };
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <CreateOrEditPromptDialog
      mode="create"
      onCreatePrompt={onCreatePrompt}
      prefillData={prefillData}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    />
  );
}
