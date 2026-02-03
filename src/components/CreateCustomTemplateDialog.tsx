import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Save } from "lucide-react";

interface CreateCustomTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateTemplate: (params: {
    name: string;
    description?: string;
    githubUrl: string;
    imageUrl?: string;
  }) => Promise<any>;
}

export function CreateCustomTemplateDialog({
  open,
  onOpenChange,
  onCreateTemplate,
}: CreateCustomTemplateDialogProps) {
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    githubUrl: "",
    imageUrl: "",
  });

  useEffect(() => {
    if (!open) {
      setDraft({ name: "", description: "", githubUrl: "", imageUrl: "" });
    }
  }, [open]);

  const onSave = async () => {
    if (!draft.name.trim() || !draft.githubUrl.trim()) return;

    await onCreateTemplate({
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      githubUrl: draft.githubUrl.trim(),
      imageUrl: draft.imageUrl.trim() || undefined,
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="mr-2 h-4 w-4" /> New Template
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Custom Template</DialogTitle>
          <DialogDescription>
            Add a custom template from a GitHub repository.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="Template name"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
          <Input
            placeholder="Description (optional)"
            value={draft.description}
            onChange={(e) =>
              setDraft((d) => ({ ...d, description: e.target.value }))
            }
          />
          <Input
            placeholder="GitHub URL (required)"
            value={draft.githubUrl}
            onChange={(e) =>
              setDraft((d) => ({ ...d, githubUrl: e.target.value }))
            }
          />
          <Input
            placeholder="Image URL (optional)"
            value={draft.imageUrl}
            onChange={(e) =>
              setDraft((d) => ({ ...d, imageUrl: e.target.value }))
            }
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={!draft.name.trim() || !draft.githubUrl.trim()}
          >
            <Save className="mr-2 h-4 w-4" /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
