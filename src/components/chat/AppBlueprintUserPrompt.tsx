import React, { useState } from "react";
import { MessageSquare, ChevronDown, ChevronUp, Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";

interface AppBlueprintUserPromptProps {
  prompt: string;
  attachments: string[];
}

const PROMPT_PREVIEW_LIMIT = 200;

export const AppBlueprintUserPrompt: React.FC<AppBlueprintUserPromptProps> = ({
  prompt,
  attachments,
}) => {
  const { t } = useTranslation("chat");
  const [isExpanded, setIsExpanded] = useState(false);
  const isLong = prompt.length > PROMPT_PREVIEW_LIMIT;
  let displayText = prompt;

  if (!isExpanded && isLong) {
    displayText = `${prompt.slice(0, PROMPT_PREVIEW_LIMIT)}...`;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <MessageSquare
          size={14}
          className="text-muted-foreground mt-0.5 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground/80 whitespace-pre-wrap break-words">
            {displayText}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-primary hover:text-primary/80 mt-1 flex items-center gap-0.5"
            >
              {isExpanded ? (
                <>
                  {t("showLess")} <ChevronUp size={12} />
                </>
              ) : (
                <>
                  {t("showMore")} <ChevronDown size={12} />
                </>
              )}
            </button>
          )}
        </div>
      </div>
      {attachments.length > 0 && (
        <div className="flex items-center gap-1.5 pl-5">
          <Paperclip size={12} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {t(
              attachments.length === 1 ? "attachment_one" : "attachment_other",
              { count: attachments.length },
            )}
          </span>
          <div className="flex gap-1 flex-wrap">
            {attachments.map((attachment) => {
              const fileName = attachment.split(/[/\\]/).pop() || attachment;
              return (
                <span
                  key={attachment}
                  className="text-xs bg-muted/50 text-muted-foreground px-1.5 py-0.5 rounded"
                  title={attachment}
                >
                  {fileName}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
