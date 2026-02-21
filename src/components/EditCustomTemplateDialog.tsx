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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Save, Edit2 } from "lucide-react";
import type { CustomTemplate } from "@/ipc/types";

interface EditCustomTemplateDialogProps {
  template: CustomTemplate;
  onUpdateTemplate: (params: {
    id: number;
    name?: string;
    description?: string;
    githubUrl?: string;
    imageUrl?: string;
  }) => Promise<any>;
}

export function EditCustomTemplateDialog({
  template,
  onUpdateTemplate,
}: EditCustomTemplateDialogProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: template.name,
    description: template.description || "",
    githubUrl: template.githubUrl,
    imageUrl: template.imageUrl || "",
  });

  useEffect(() => {
    if (open) {
      setDraft({
        name: template.name,
        description: template.description || "",
        githubUrl: template.githubUrl,
        imageUrl: template.imageUrl || "",
      });
    }
  }, [open, template]);

  const onSave = async () => {
    if (!draft.name.trim() || !draft.githubUrl.trim()) return;

    await onUpdateTemplate({
      id: template.id,
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      githubUrl: draft.githubUrl.trim(),
      imageUrl: draft.imageUrl.trim() || undefined,
    });

    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button size="icon" variant="ghost">
                  <Edit2 className="h-4 w-4" />
                </Button>
              }
            />
          }
        />
        <TooltipContent>
          <p>Edit template</p>
        </TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Custom Template</DialogTitle>
          <DialogDescription>
            Update your custom template settings.
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
          <Button variant="outline" onClick={() => setOpen(false)}>
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
