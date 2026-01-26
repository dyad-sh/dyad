import React from "react";
import { FileText, Sheet, Presentation, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "@tanstack/react-router";

interface JoyDocumentProps {
  node?: {
    properties?: {
      type?: string;
      name?: string;
      id?: string;
      description?: string;
    };
  };
  children?: React.ReactNode;
}

export const JoyDocument: React.FC<JoyDocumentProps> = ({ node }) => {
  const navigate = useNavigate();
  const type = node?.properties?.type || "document";
  const name = node?.properties?.name || "Untitled";
  const id = node?.properties?.id;
  const description = node?.properties?.description;

  const handleClick = () => {
    // Navigate to documents page, optionally with the document ID to highlight it
    if (id) {
      navigate({ to: "/documents", search: { highlight: id } });
    } else {
      navigate({ to: "/documents" });
    }
  };

  const getIcon = () => {
    switch (type) {
      case "spreadsheet":
        return <Sheet className="h-5 w-5 text-green-600 dark:text-green-400" />;
      case "presentation":
        return <Presentation className="h-5 w-5 text-orange-600 dark:text-orange-400" />;
      default:
        return <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />;
    }
  };

  const getTypeLabel = () => {
    switch (type) {
      case "spreadsheet":
        return "Spreadsheet";
      case "presentation":
        return "Presentation";
      default:
        return "Document";
    }
  };

  const getBgColor = () => {
    switch (type) {
      case "spreadsheet":
        return "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800";
      case "presentation":
        return "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800";
      default:
        return "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800";
    }
  };

  return (
    <div
      className={cn(
        "my-3 rounded-lg border p-4 cursor-pointer transition-all hover:shadow-md",
        getBgColor()
      )}
      onClick={handleClick}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {getIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {getTypeLabel()} Created
            </span>
          </div>
          <h4 className="font-semibold text-foreground mt-1 truncate">
            {name}
          </h4>
          {description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
              {description}
            </p>
          )}
          <div className="flex items-center gap-1 mt-2 text-sm text-primary hover:underline">
            <span>Open in Libre Studio</span>
            <ExternalLink className="h-3 w-3" />
          </div>
        </div>
      </div>
    </div>
  );
};
