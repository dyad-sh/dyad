import React, { useEffect, useState } from "react";
import { useSetAtom } from "jotai";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import {
  planAnnotationsAtom,
  removePlanAnnotation,
  updatePlanAnnotation,
  type PlanAnnotation,
} from "@/atoms/planAtoms";

interface CommentCardProps {
  annotation: PlanAnnotation;
  chatId: number;
}

export const CommentCard: React.FC<CommentCardProps> = ({
  annotation,
  chatId,
}) => {
  const { t } = useTranslation("home");
  const { t: tc } = useTranslation("common");
  const setAnnotations = useSetAtom(planAnnotationsAtom);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(annotation.comment);

  useEffect(() => {
    if (!isEditing) {
      setEditedText(annotation.comment);
    }
  }, [annotation.comment, isEditing]);

  const handleDelete = () => {
    setAnnotations((prev) => removePlanAnnotation(prev, chatId, annotation.id));
  };

  const handleSave = () => {
    if (!editedText.trim()) return;
    setAnnotations((prev) =>
      updatePlanAnnotation(prev, chatId, annotation.id, editedText.trim()),
    );
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
            type="button"
            onClick={() => setIsEditing(true)}
            aria-label={t("preview.planComments.edit")}
            className="p-1 rounded hover:bg-muted"
          >
            <Pencil size={12} className="text-muted-foreground" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            aria-label={t("preview.planComments.delete")}
            className="p-1 rounded hover:bg-muted"
          >
            <Trash2 size={12} className="text-muted-foreground" />
          </button>
        </div>
      </div>
      {isEditing ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave();
              if (e.key === "Escape") handleCancel();
            }}
            className="w-full text-sm min-h-[60px] rounded-md border bg-background px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex gap-1 justify-end">
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              {t("preview.planComments.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!editedText.trim()}
            >
              {tc("save")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm">{annotation.comment}</p>
      )}
    </div>
  );
};
