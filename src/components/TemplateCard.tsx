import React, { useState } from "react";
import { Check, Github } from "lucide-react";
import { ipc } from "@/ipc/types";
import { useSettings } from "@/hooks/useSettings";
import { CommunityCodeConsentDialog } from "./CommunityCodeConsentDialog";
import type { Template } from "@/shared/templates";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { showWarning } from "@/lib/toast";

interface TemplateCardProps {
  template: Template;
  isSelected: boolean;
  onSelect: (templateId: string) => void;
  onCreateApp: () => void;
}

function TemplateBadge({
  template,
  isSelected,
}: {
  template: Template;
  isSelected: boolean;
}) {
  if (template.isExperimental) {
    return (
      <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
        Beta
      </span>
    );
  }
  if (template.isOfficial) {
    return (
      <span
        className={cn(
          "rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          isSelected
            ? "bg-primary/20 text-primary"
            : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        )}
      >
        Official
      </span>
    );
  }
  return (
    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      Community
    </span>
  );
}

export const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  isSelected,
  onSelect,
  onCreateApp,
}) => {
  const { settings, updateSettings } = useSettings();
  const [showConsentDialog, setShowConsentDialog] = useState(false);

  const handleCardClick = () => {
    if (!template.isOfficial && !settings?.acceptedCommunityCode) {
      setShowConsentDialog(true);
      return;
    }

    if (template.requiresNeon && !settings?.neon?.accessToken) {
      showWarning("Please connect your Neon account to use this template.");
      return;
    }

    onSelect(template.id);
  };

  const handleConsentAccept = () => {
    updateSettings({ acceptedCommunityCode: true });
    onSelect(template.id);
    setShowConsentDialog(false);
  };

  const handleGithubClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (template.githubUrl) {
      ipc.system.openExternalUrl(template.githubUrl);
    }
  };

  return (
    <>
      <article
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCardClick();
          }
        }}
        data-testid={`template-card-${template.id}`}
        className={cn(
          "group flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border bg-card text-left",
          "transition-[border-color,box-shadow,transform] duration-200",
          "hover:border-primary/35 hover:shadow-md",
          isSelected
            ? "border-primary/60 shadow-[0_0_0_1px_rgba(var(--primary),0.2)] ring-1 ring-primary/40"
            : "border-border/70",
        )}
      >
        <div className="relative aspect-[16/10] shrink-0 overflow-hidden bg-muted/50">
          <img
            src={template.imageUrl}
            alt=""
            className={cn(
              "h-full w-full object-cover object-top transition-transform duration-300",
              "group-hover:scale-[1.03]",
              isSelected && "opacity-90",
            )}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />

          <div className="absolute left-2 top-2">
            <TemplateBadge template={template} isSelected={isSelected} />
          </div>

          {isSelected && (
            <div className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
              <Check className="size-3.5" strokeWidth={3} />
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 p-3">
          <h3
            className={cn(
              "line-clamp-1 text-sm font-semibold leading-tight",
              isSelected ? "text-primary" : "text-foreground",
            )}
          >
            {template.title}
          </h3>
          <p className="line-clamp-2 min-h-[2.25rem] text-xs leading-relaxed text-muted-foreground">
            {template.description}
          </p>

          <div className="mt-auto flex items-center gap-2 pt-1">
            {template.githubUrl ? (
              <button
                type="button"
                onClick={handleGithubClick}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="View on GitHub"
              >
                <Github className="size-3.5" />
                <span className="hidden sm:inline">GitHub</span>
              </button>
            ) : (
              <span />
            )}

            {isSelected ? (
              <Button
                type="button"
                size="sm"
                className="ml-auto h-7 flex-1 text-xs sm:flex-none sm:px-3"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateApp();
                }}
              >
                Create App
              </Button>
            ) : (
              <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100">
                Select
              </span>
            )}
          </div>
        </div>
      </article>

      <CommunityCodeConsentDialog
        isOpen={showConsentDialog}
        onAccept={handleConsentAccept}
        onCancel={() => setShowConsentDialog(false)}
      />
    </>
  );
};
