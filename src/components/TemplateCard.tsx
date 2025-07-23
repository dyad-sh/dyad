import React, { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import { useSettings } from "@/hooks/useSettings";
import { CommunityCodeConsentDialog } from "./CommunityCodeConsentDialog";
import type { Template } from "@/shared/templates";

interface TemplateCardProps {
  template: Template;
  isSelected: boolean;
  onSelect: (templateId: string) => void;
}

export const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  isSelected,
  onSelect,
}) => {
  const { settings, updateSettings } = useSettings();
  const [showConsentDialog, setShowConsentDialog] = useState(false);

  const handleCardClick = () => {
    // If it's a community template and user hasn't accepted community code yet, show dialog
    if (!template.isOfficial && !settings?.acceptedCommunityCode) {
      setShowConsentDialog(true);
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
            src={template.imageUrl}
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
            {template.isOfficial && (
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
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 h-8 overflow-y-auto">
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
        </div>
      </div>

      <CommunityCodeConsentDialog
        isOpen={showConsentDialog}
        onAccept={handleConsentAccept}
        onCancel={handleConsentCancel}
      />
    </>
  );
};
