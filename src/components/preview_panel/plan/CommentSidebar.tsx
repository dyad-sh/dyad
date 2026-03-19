import React, { useState } from "react";
import { ChevronLeft, ChevronRight, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommentCard } from "./CommentCard";
import type { PlanAnnotation } from "@/atoms/planAtoms";

interface CommentSidebarProps {
  chatId: number;
  annotations: PlanAnnotation[];
  onSendComments: () => void;
  isSending: boolean;
}

export const CommentSidebar: React.FC<CommentSidebarProps> = ({
  chatId,
  annotations,
  onSendComments,
  isSending,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="border-l flex flex-col items-center py-3 px-1 bg-muted/30 shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          className="p-1.5 rounded-md hover:bg-muted transition-colors"
          title="Expand comments"
        >
          <ChevronLeft size={16} className="text-muted-foreground" />
        </button>
        <div className="mt-2 flex flex-col items-center gap-1">
          <MessageSquare size={14} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-medium">
            {annotations.length}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-72 border-l flex flex-col bg-muted/30 shrink-0">
      <div className="flex items-center justify-between p-3 pb-2">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">
            Comments ({annotations.length})
          </span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 rounded-md hover:bg-muted transition-colors"
          title="Collapse comments"
        >
          <ChevronRight size={16} className="text-muted-foreground" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 pt-0 space-y-3">
        {annotations.map((annotation) => (
          <CommentCard
            key={annotation.id}
            annotation={annotation}
            chatId={chatId}
          />
        ))}
      </div>
      <div className="border-t p-3">
        <Button
          onClick={onSendComments}
          disabled={isSending}
          className="w-full"
          size="sm"
        >
          <Send size={14} className="mr-2" />
          Send Comments
        </Button>
      </div>
    </div>
  );
};
