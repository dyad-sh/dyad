import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { useSettings } from "@/hooks/useSettings";
import { IpcClient } from "@/ipc/ipc_client";
import { DEFAULT_TEMPLATE_ID, templatesData } from "@/shared/templates";

const HubPage: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  const router = useRouter();

  const selectedTemplateId =
    settings?.selectedTemplateId || DEFAULT_TEMPLATE_ID;

  const handleTemplateSelect = (templateId: string) => {
    updateSettings({ selectedTemplateId: templateId });
  };

  return (
    <div className="min-h-screen px-8 py-4">
      <div className="max-w-5xl mx-auto">
        <Button
          onClick={() => router.history.back()}
          variant="outline"
          size="sm"
          className="flex items-center gap-2 mb-4 bg-(--background-lightest) py-5"
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>
        <header className="mb-8 text-left">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Pick your default template
          </h1>
          <p className="text-md text-gray-600 dark:text-gray-400">
            Choose a starting point for your new project.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {templatesData.map((template) => {
            const isSelected = template.id === selectedTemplateId;
            return (
              <div
                key={template.id}
                onClick={() => handleTemplateSelect(template.id)}
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
                    className={`w-full h-52 object-cover transition-opacity duration-300 group-hover:opacity-80 ${isSelected ? "opacity-75" : ""}`}
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
                      className={`text-lg font-semibold ${isSelected ? "text-blue-600 dark:text-blue-400" : "text-gray-900 dark:text-white"}`}
                    >
                      {template.title}
                    </h2>
                    {template.isOfficial && (
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isSelected ? "bg-blue-100 text-blue-700 dark:bg-blue-600 dark:text-blue-100" : "bg-green-100 text-green-800 dark:bg-green-700 dark:text-green-200"}`}
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
                      className={`inline-flex items-center text-sm font-medium transition-colors duration-200 ${isSelected ? "text-blue-500 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200" : "text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (template.githubUrl) {
                          IpcClient.getInstance().openExternalUrl(
                            template.githubUrl,
                          );
                        }
                      }}
                    >
                      View on GitHub{" "}
                      <ArrowLeft className="w-4 h-4 ml-1 transform rotate-180" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default HubPage;
