import React, { useState } from "react";
import { useSetAtom } from "jotai";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { planAnnotationsAtom, type PlanAnnotation } from "@/atoms/planAtoms";

interface CommentCardProps {
  annotation: PlanAnnotation;
  chatId: number;
}

export const CommentCard: React.FC<CommentCardProps> = ({
  annotation,
  chatId,
}) => {
  const setAnnotations = useSetAtom(planAnnotationsAtom);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(annotation.comment);

  const handleDelete = () => {
    setAnnotations((prev) => {
      const next = new Map(prev);
      const list = next.get(chatId) ?? [];
      next.set(
        chatId,
        list.filter((a) => a.id !== annotation.id),
      );
      return next;
    });
  };

  const handleSave = () => {
    if (!editedText.trim()) return;
    setAnnotations((prev) => {
      const next = new Map(prev);
      const list = (next.get(chatId) ?? []).map((a) =>
        a.id === annotation.id ? { ...a, comment: editedText.trim() } : a,
      );
      next.set(chatId, list);
      return next;
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedText(annotation.comment);
    setIsEditing(false);
  };

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between">
        <blockquote className="text-xs text-muted-foreground border-l-2 border-muted-foreground/30 pl-2 italic line-clamp-3 flex-1">
          {annotation.selectedText}
        </blockquote>
        <div className="flex gap-1 ml-2 shrink-0">
          <button
            onClick={() => setIsEditing(true)}
            className="p-1 rounded hover:bg-muted"
          >
            <Pencil size={12} className="text-muted-foreground" />
          </button>
          <button onClick={handleDelete} className="p-1 rounded hover:bg-muted">
            <Trash2 size={12} className="text-muted-foreground" />
          </button>
        </div>
      </div>
      {isEditing ? (
        <div className="space-y-2">
          <textarea
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            className="w-full text-sm min-h-[60px] rounded-md border bg-background px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex gap-1 justify-end">
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm">{annotation.comment}</p>
      )}
    </div>
  );
};
