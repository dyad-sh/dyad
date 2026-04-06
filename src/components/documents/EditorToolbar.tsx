import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  Save,
  Undo,
  Redo,
  Sparkles,
  ArrowLeft,
} from "lucide-react";

interface EditorToolbarProps {
  docType: "document" | "spreadsheet" | "presentation";
  saving: boolean;
  aiPanelOpen: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onSave: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onBold?: () => void;
  onItalic?: () => void;
  onUnderline?: () => void;
  onAlignLeft?: () => void;
  onAlignCenter?: () => void;
  onAlignRight?: () => void;
  onBulletList?: () => void;
  onNumberedList?: () => void;
  onToggleAiPanel: () => void;
  onBack: () => void;
  docName: string;
}

export function EditorToolbar({
  docType,
  saving,
  aiPanelOpen,
  canUndo,
  canRedo,
  onSave,
  onUndo,
  onRedo,
  onBold,
  onItalic,
  onUnderline,
  onAlignLeft,
  onAlignCenter,
  onAlignRight,
  onBulletList,
  onNumberedList,
  onToggleAiPanel,
  onBack,
  docName,
}: EditorToolbarProps) {
  const isDocument = docType === "document";

  return (
    <div className="flex h-12 items-center gap-1 border-b bg-background/95 backdrop-blur px-3 shrink-0">
      {/* Back */}
      <Button variant="ghost" size="sm" onClick={onBack} className="mr-1 gap-1.5">
        <ArrowLeft className="size-4" />
        <span className="text-sm font-medium max-w-[160px] truncate">{docName}</span>
      </Button>

      <Separator orientation="vertical" className="h-5" />

      {/* History */}
      <Button variant="ghost" size="icon" onClick={onUndo} disabled={!canUndo} title="Undo">
        <Undo className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={onRedo} disabled={!canRedo} title="Redo">
        <Redo className="size-4" />
      </Button>

      {isDocument && (
        <>
          <Separator orientation="vertical" className="h-5" />

          {/* Text formatting */}
          <Button variant="ghost" size="icon" onClick={onBold} title="Bold">
            <Bold className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onItalic} title="Italic">
            <Italic className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onUnderline} title="Underline">
            <Underline className="size-4" />
          </Button>

          <Separator orientation="vertical" className="h-5" />

          {/* Alignment */}
          <Button variant="ghost" size="icon" onClick={onAlignLeft} title="Align left">
            <AlignLeft className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onAlignCenter} title="Center">
            <AlignCenter className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onAlignRight} title="Align right">
            <AlignRight className="size-4" />
          </Button>

          <Separator orientation="vertical" className="h-5" />

          {/* Lists */}
          <Button variant="ghost" size="icon" onClick={onBulletList} title="Bullet list">
            <List className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onNumberedList} title="Numbered list">
            <ListOrdered className="size-4" />
          </Button>
        </>
      )}

      <div className="flex-1" />

      {/* Save */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onSave}
        disabled={saving}
        className="gap-1.5"
      >
        <Save className="size-4" />
        {saving ? "Saving…" : "Save"}
      </Button>

      {/* AI Panel toggle */}
      <Button
        variant={aiPanelOpen ? "default" : "outline"}
        size="sm"
        onClick={onToggleAiPanel}
        className={cn("gap-1.5", aiPanelOpen && "shadow-sm shadow-primary/20")}
      >
        <Sparkles className="size-4" />
        AI Assist
      </Button>
    </div>
  );
}
