import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IpcClient } from "@/ipc/ipc_client";
import { useSettings } from "@/hooks/useSettings";
import { showError, showSuccess } from "@/lib/toast";
import { Folder, Loader2, X } from "lucide-react";

interface AddUserTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded?: () => void;
}

export function AddUserTemplateDialog({ open, onOpenChange, onAdded }: AddUserTemplateDialogProps) {
  const { settings, updateSettings } = useSettings();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [busy, setBusy] = useState(false);

  // Derive a default id from title
  const defaultId = useMemo(() => {
    const base = title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "") || "user-template";
    const existing = new Set((settings?.userTemplates || []).map((t: any) => t.id));
    let id = `user:${base}`;
    let i = 1;
    while (existing.has(id)) {
      id = `user:${base}-${i++}`;
    }
    return id;
  }, [title, settings?.userTemplates]);

  // When a folder is chosen, set default title from folder name
  const handleSelectFolder = async () => {
    try {
      setBusy(true);
      const res = await IpcClient.getInstance().selectAppFolder();
      if (!res.path || !res.name) return;
      setSelectedPath(res.path);
      if (!title) setTitle(res.name);
    } catch (e: any) {
      showError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleClear = () => {
    setSelectedPath(null);
    setTitle("");
    setDescription("");
    setImageUrl("");
  };

  const handleSave = async () => {
    if (!selectedPath || !title.trim()) return;
    try {
      setBusy(true);
      // Append to userTemplates in settings
      const existing = settings?.userTemplates || [];
      const next = [
        ...existing,
        {
          id: defaultId,
          title: title.trim(),
          description: description.trim() || undefined,
          imageUrl: imageUrl.trim() || undefined,
          source: { type: "folder" as const, path: selectedPath },
        },
      ];
      await updateSettings({ userTemplates: next });
      showSuccess("Template added to Hub");
      onOpenChange(false);
      handleClear();
      onAdded?.();
    } catch (e: any) {
      showError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // Reset state when dialog toggles
  useEffect(() => {
    if (!open) {
      handleClear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canSave = Boolean(selectedPath && title.trim() && !busy);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Add template to Hub</DialogTitle>
          <DialogDescription>
            Register an existing project folder as a reusable template. It will appear under Community templates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!selectedPath ? (
            <Button onClick={handleSelectFolder} className="w-full" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Folder className="mr-2 h-4 w-4" />}
              Select Folder
            </Button>
          ) : (
            <div className="rounded-md border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Selected folder:</p>
                  <p className="text-sm text-muted-foreground break-all">{selectedPath}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={handleClear} className="h-8 w-8 p-0" disabled={busy}>
                  <X className="h-4 w-4" />
                  <span className="sr-only">Clear selection</span>
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My Template" disabled={busy} />
          </div>

          <div className="grid gap-2">
            <Label>Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" disabled={busy} />
          </div>

          <div className="grid gap-2">
            <Label>Image URL (optional)</Label>
            <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." disabled={busy} />
          </div>

          <div className="text-xs text-muted-foreground">Template ID preview: <code>{defaultId}</code></div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave} className="bg-indigo-600 hover:bg-indigo-700">
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : "Save to Hub"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
