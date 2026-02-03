import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { useTemplates } from "@/hooks/useTemplates";
import { ipc } from "@/ipc/types";
import type { Template } from "@/shared/templates";

const HubPage: React.FC = () => {
  const router = useRouter();
  const { templates, isLoading } = useTemplates();

  // Only show community (non-official) templates
  const communityTemplates =
    templates?.filter((template) => !template.isOfficial) || [];

  return (
    <div className="min-h-screen px-8 py-4">
      <div className="max-w-5xl mx-auto pb-12">
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
            Community Templates
          </h1>
          <p className="text-md text-gray-600 dark:text-gray-400">
            Discover community-contributed templates.
            {isLoading && " Loading templates..."}
          </p>
        </header>

        {communityTemplates.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {communityTemplates.map((template) => (
              <CommunityTemplateCard key={template.id} template={template} />
            ))}
          </div>
        ) : (
          !isLoading && (
            <div className="text-muted-foreground">
              No community templates available yet.
            </div>
          )
        )}
      </div>
    </div>
  );
};

function CommunityTemplateCard({ template }: { template: Template }) {
  const handleGithubClick = () => {
    if (template.githubUrl) {
      ipc.system.openExternalUrl(template.githubUrl);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
      <div className="relative">
        <img
          src={template.imageUrl}
          alt={template.title}
          className="w-full h-52 object-cover"
        />
      </div>
      <div className="p-4">
        <div className="flex justify-between items-center mb-1.5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {template.title}
          </h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 h-10 overflow-y-auto">
          {template.description}
        </p>
        {template.githubUrl && (
          <a
            className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors duration-200 cursor-pointer"
            onClick={handleGithubClick}
          >
            View on GitHub <ExternalLink className="w-4 h-4 ml-1" />
          </a>
        )}
      </div>
    </div>
  );
}

export default HubPage;
