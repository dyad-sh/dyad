import React, { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { PluginsList } from "@/components/plugins/PluginsList";
import { useDeepLink } from "@/contexts/DeepLinkContext";

const PluginsPage: React.FC = () => {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const { lastDeepLink } = useDeepLink();

  // The dyad://add-mcp-server deep link lands on this page; open the
  // add dialog so the prefilled form (see AddPluginDialog) is visible.
  useEffect(() => {
    if (lastDeepLink?.type === "add-mcp-server") {
      setIsAddDialogOpen(true);
    }
  }, [lastDeepLink?.timestamp]);

  return (
    <div className="w-full min-h-screen px-8 py-4">
      <div className="max-w-5xl pb-12">
        <BackButton />
        <header className="mb-8 flex items-start justify-between gap-4">
          <div className="text-left">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              Plugins
            </h1>
            <p className="text-md text-gray-600 dark:text-gray-400">
              Connect plugins (MCP servers) to give the AI new tools.
            </p>
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus size={16} />
            Add Plugin
          </Button>
        </header>
        <PluginsList
          addDialogOpen={isAddDialogOpen}
          onAddDialogOpenChange={setIsAddDialogOpen}
        />
      </div>
    </div>
  );
};

export default PluginsPage;
