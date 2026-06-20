import React from "react";
import { MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { CommentCard } from "./CommentCard";
import type { PlanAnnotation } from "@/atoms/planAtoms";

interface CommentsFloatingButtonProps {
  chatId: number;
  annotations: PlanAnnotation[];
  onSendComments: () => void;
  isSending: boolean;
}

export const CommentsFloatingButton: React.FC<CommentsFloatingButtonProps> = ({
  chatId,
  annotations,
  onSendComments,
  isSending,
}) => {
  if (annotations.length === 0) return null;

  return (
    <div className="sticky top-3 float-right z-10 mr-1">
      <Popover>
        <PopoverTrigger
          aria-label="View comments"
          className="relative rounded-full w-9 h-9 flex items-center justify-center bg-muted/80 text-muted-foreground border shadow-sm hover:bg-muted transition-colors cursor-pointer"
        >
          <MessageSquare size={16} />
          <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[10px] rounded-full min-w-4 h-4 flex items-center justify-center font-medium px-1">
            {annotations.length}
          </span>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="end"
          sideOffset={8}
          className="w-80 p-0"
        >
          <div className="flex flex-col max-h-[400px]">
            <div className="flex items-center gap-2 p-3 border-b">
              <MessageSquare size={16} className="text-muted-foreground" />
              <span className="text-sm font-medium">
                Comments ({annotations.length})
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
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
                {isSending ? "Sending\u2026" : "Send Comments"}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
