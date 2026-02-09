import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { TemplateCard } from "./TemplateCard";
import { useTemplates } from "@/hooks/useTemplates";
import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_TEMPLATE_ID } from "@/shared/templates";

interface SelectTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (templateId: string) => void;
}

export function SelectTemplateDialog({
  open,
  onOpenChange,
  onConfirm,
}: SelectTemplateDialogProps) {
  const { templates } = useTemplates();
  const { settings, updateSettings } = useSettings();
  const [selectedId, setSelectedId] = useState<string>(
    settings?.selectedTemplateId ?? DEFAULT_TEMPLATE_ID,
  );
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedId(settings?.selectedTemplateId ?? DEFAULT_TEMPLATE_ID);
      setDontShowAgain(false);
    }
  }, [open, settings?.selectedTemplateId]);

  // Build list: official templates + currently selected template if non-official
  const officialTemplates = (templates ?? []).filter((t) => t.isOfficial);
  const currentTemplateId = settings?.selectedTemplateId;
  const currentIsInOfficialList = officialTemplates.some(
    (t) => t.id === currentTemplateId,
  );
  const currentNonOfficialTemplate =
    !currentIsInOfficialList && currentTemplateId
      ? (templates ?? []).find((t) => t.id === currentTemplateId)
      : null;

  const displayTemplates = currentNonOfficialTemplate
    ? [currentNonOfficialTemplate, ...officialTemplates]
    : officialTemplates;

  const handleConfirm = async () => {
    const updates: { selectedTemplateId: string; promptForTemplate?: boolean } =
      { selectedTemplateId: selectedId };
    if (dontShowAgain) {
      updates.promptForTemplate = false;
    }
    await updateSettings(updates);
    onConfirm(selectedId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Select a Template</DialogTitle>
          <DialogDescription>
            Choose a template for your new app. We're only showing official
            templates here. Go to the Hub tab for community templates.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 py-4">
          {displayTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              isSelected={selectedId === template.id}
              onSelect={setSelectedId}
              compact
            />
          ))}
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="dont-show-again"
            checked={dontShowAgain}
            onCheckedChange={(checked) => setDontShowAgain(checked === true)}
          />
          <Label
            htmlFor="dont-show-again"
            className="text-sm text-muted-foreground"
          >
            Don't show me this again
          </Label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
