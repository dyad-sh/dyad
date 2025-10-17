import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IpcClient } from "@/ipc/ipc_client";
import { showError, showSuccess } from "@/lib/toast";
import { Folder, Image } from "lucide-react";
import type { Template } from "@/shared/templates";

interface EditCustomTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: Template | null;
  onTemplateEdited?: () => void;
}

export const EditCustomTemplateDialog: React.FC<
  EditCustomTemplateDialogProps
> = ({ open, onOpenChange, template, onTemplateEdited }) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Update state when template changes
  useEffect(() => {
    if (template) {
      setTitle(template.title);
      setDescription(template.description);
      setFolderPath(template.folderPath || "");
      setImageUrl(template.imageUrl || "");
    }
  }, [template]);

  const handleSelectFolder = async () => {
    const ipcClient = IpcClient.getInstance();
    const path = await ipcClient.selectFolder();
    if (path) {
      setFolderPath(path);
    }
  };

  const handleSelectImage = async () => {
    const ipcClient = IpcClient.getInstance();
    const path = await ipcClient.selectImage();
    if (path) {
      setImageUrl(path);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!template || !title.trim() || !description.trim() || !folderPath) {
      showError("Please fill in all fields and select a folder");
      return;
    }

    setIsSubmitting(true);
    try {
      const ipcClient = IpcClient.getInstance();
      const result = await ipcClient.editCustomTemplate({
        templateId: template.id,
        title: title.trim(),
        description: description.trim(),
        folderPath,
        imageUrl: imageUrl || undefined,
      });

      if (result.success) {
        showSuccess("Template updated successfully!");
        onOpenChange(false);
        onTemplateEdited?.();
      } else {
        showError(result.error || "Failed to update template");
      }
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Failed to update template",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Custom Template</DialogTitle>
          <DialogDescription>
            Update the details of your custom template.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Template Name</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., My React Template"
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this template includes..."
              rows={3}
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="folderPath">Template Folder</Label>
            <div className="flex gap-2">
              <Input
                id="folderPath"
                value={folderPath}
                readOnly
                placeholder="Select a folder..."
                className="flex-1"
              />
              <Button
                type="button"
                onClick={handleSelectFolder}
                variant="outline"
                disabled={isSubmitting}
              >
                <Folder className="h-4 w-4 mr-2" />
                Browse
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="imageUrl">Template Image (Optional)</Label>
            <div className="flex gap-2">
              <Input
                id="imageUrl"
                value={imageUrl}
                readOnly
                placeholder="Select an image or leave empty for auto-generated..."
                className="flex-1"
              />
              <Button
                type="button"
                onClick={handleSelectImage}
                variant="outline"
                disabled={isSubmitting}
              >
                <Image className="h-4 w-4 mr-2" />
                Browse
              </Button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              If not provided, a text-based placeholder will be generated using
              the template name.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
