import React, { useState } from "react";
import { ArrowLeft, Trash2, Edit3 } from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import { useSettings } from "@/hooks/useSettings";
import { CommunityCodeConsentDialog } from "./CommunityCodeConsentDialog";
import type { Template } from "@/shared/templates";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { showWarning, showSuccess, showError } from "@/lib/toast";
import { generateTemplatePlaceholder } from "@/lib/template-placeholder";

interface TemplateCardProps {
  template: Template;
  isSelected: boolean;
  onSelect: (templateId: string) => void;
  onCreateApp: () => void;
  onTemplateDeleted?: () => void;
  onTemplateEdit?: (template: Template) => void;
}

export const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  isSelected,
  onSelect,
  onCreateApp,
  onTemplateDeleted,
  onTemplateEdit,
}) => {
  const { settings, updateSettings } = useSettings();
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Get the image URL, using placeholder if not provided for custom templates
  const getImageUrl = () => {
    if (template.imageUrl) {
      return template.imageUrl;
    }
    if (template.isCustom) {
      return generateTemplatePlaceholder(template.title);
    }
    return template.imageUrl;
  };

  const handleCardClick = () => {
    // If it's a community template (not official and not custom) and user hasn't accepted community code yet, show dialog
    if (
      !template.isOfficial &&
      !template.isCustom &&
      !settings?.acceptedCommunityCode
    ) {
      setShowConsentDialog(true);
      return;
    }

    if (template.requiresNeon && !settings?.neon?.accessToken) {
      showWarning("Please connect your Neon account to use this template.");
      return;
    }

    // Otherwise, proceed with selection
    onSelect(template.id);
  };

  const handleConsentAccept = () => {
    // Update settings to accept community code
    updateSettings({ acceptedCommunityCode: true });

    // Select the template
    onSelect(template.id);

    // Close dialog
    setShowConsentDialog(false);
  };

  const handleConsentCancel = () => {
    // Just close dialog, don't update settings or select template
    setShowConsentDialog(false);
  };

  const handleGithubClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (template.githubUrl) {
      IpcClient.getInstance().openExternalUrl(template.githubUrl);
    }
  };

  const handleDeleteCustomTemplate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!template.isCustom) return;

    if (
      !confirm(
        `Are you sure you want to delete "${template.title}"? This action cannot be undone.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      const result = await IpcClient.getInstance().deleteCustomTemplate(
        template.id,
      );
      if (result.success) {
        showSuccess("Template deleted successfully");
        onTemplateDeleted?.();
      } else {
        showError(result.error || "Failed to delete template");
      }
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Failed to delete template",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEditCustomTemplate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!template.isCustom) return;
    onTemplateEdit?.(template);
  };

  return (
    <>
      <div
        onClick={handleCardClick}
        className={`
          bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden 
          transform transition-all duration-300 ease-in-out 
          cursor-pointer group relative
          ${
            isSelected
              ? "ring-2 ring-blue-500 dark:ring-blue-400 shadow-xl"
              : "hover:shadow-lg hover:-translate-y-1"
          }
        `}
      >
        <div className="relative">
          <img
            src={getImageUrl()}
            alt={template.title}
            className={`w-full h-52 object-cover transition-opacity duration-300 group-hover:opacity-80 ${
              isSelected ? "opacity-75" : ""
            }`}
          />
          {isSelected && (
            <span className="absolute top-3 right-3 bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-md shadow-lg">
              Selected
            </span>
          )}
        </div>
        <div className="p-4">
          <div className="flex justify-between items-center mb-1.5">
            <h2
              className={`text-lg font-semibold ${
                isSelected
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-gray-900 dark:text-white"
              }`}
            >
              {template.title}
            </h2>
            {template.isOfficial && !template.isExperimental && (
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  isSelected
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-600 dark:text-blue-100"
                    : "bg-green-100 text-green-800 dark:bg-green-700 dark:text-green-200"
                }`}
              >
                Official
              </span>
            )}
            {template.isExperimental && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-700 dark:text-yellow-200">
                Experimental
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 h-10 overflow-y-auto">
            {template.description}
          </p>
          {template.githubUrl && (
            <a
              className={`inline-flex items-center text-sm font-medium transition-colors duration-200 ${
                isSelected
                  ? "text-blue-500 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200"
                  : "text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
              }`}
              onClick={handleGithubClick}
            >
              View on GitHub{" "}
              <ArrowLeft className="w-4 h-4 ml-1 transform rotate-180" />
            </a>
          )}

          <Button
            onClick={(e) => {
              e.stopPropagation();
              onCreateApp();
            }}
            size="sm"
            className={cn(
              "w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold mt-2",
              settings?.selectedTemplateId !== template.id && "invisible",
            )}
          >
            Create App
          </Button>
        </div>

        {/* Custom Template Action Buttons */}
        {template.isCustom && (
          <div className="flex items-center gap-2 px-4 pb-4">
            <Button
              onClick={handleEditCustomTemplate}
              variant="outline"
              size="sm"
              className="flex-1 flex items-center justify-center gap-2"
            >
              <Edit3 className="h-4 w-4" />
              Edit Template
            </Button>
            <Button
              onClick={handleDeleteCustomTemplate}
              disabled={isDeleting}
              variant="outline"
              size="sm"
              className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
              title="Delete template"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <CommunityCodeConsentDialog
        isOpen={showConsentDialog}
        onAccept={handleConsentAccept}
        onCancel={handleConsentCancel}
      />
    </>
  );
};
