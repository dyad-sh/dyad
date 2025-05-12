import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useNavigate } from "@tanstack/react-router";
import { providerSettingsRoute } from "@/routes/settings/providers/$provider";
import type { LanguageModelProvider } from "@/ipc/ipc_types";

import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { GiftIcon, PlusIcon } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";

import { CreateCustomProviderDialog } from "./CreateCustomProviderDialog";

export function ProviderSettingsGrid() {
  const navigate = useNavigate();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const {
    data: providers,
    isLoading,
    error,
    isProviderSetup,
    refetch,
  } = useLanguageModelProviders();

  const handleProviderClick = (providerId: string) => {
    navigate({
      to: providerSettingsRoute.id,
      params: { provider: providerId },
    });
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-6">AI Providers</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="border-border">
              <CardHeader className="p-4">
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-6">AI Providers</h2>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            Failed to load AI providers: {error.message}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">AI Providers</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {providers?.map((provider: LanguageModelProvider) => {
          return (
            <Card
              key={provider.id}
              className="cursor-pointer transition-all hover:shadow-md border-border"
              onClick={() => handleProviderClick(provider.id)}
            >
              <CardHeader className="p-4">
                <CardTitle className="text-xl flex items-center justify-between">
                  {provider.name}
                  {isProviderSetup(provider.id) ? (
                    <span className="ml-3 text-sm font-medium text-green-500 bg-green-50 dark:bg-green-900/30 border border-green-500/50 dark:border-green-500/50 px-2 py-1 rounded-full">
                      Ready
                    </span>
                  ) : (
                    <span className="text-sm text-gray-500 bg-gray-50 dark:bg-gray-900 dark:text-gray-300 px-2 py-1 rounded-full">
                      Needs Setup
                    </span>
                  )}
                </CardTitle>
                <CardDescription>
                  {provider.hasFreeTier && (
                    <span className="text-blue-600 mt-2 dark:text-blue-400 text-sm font-medium bg-blue-100 dark:bg-blue-900/30 px-2 py-1 rounded-full inline-flex items-center">
                      <GiftIcon className="w-4 h-4 mr-1" />
                      Free tier available
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
            </Card>
          );
        })}

        {/* Add custom provider button */}
        <Card
          className="cursor-pointer transition-all hover:shadow-md border-border border-dashed hover:border-primary/70"
          onClick={() => setIsDialogOpen(true)}
        >
          <CardHeader className="p-4 flex flex-col items-center justify-center h-full">
            <PlusIcon className="h-10 w-10 text-muted-foreground mb-2" />
            <CardTitle className="text-xl text-center">
              Add custom provider
            </CardTitle>
            <CardDescription className="text-center">
              Connect to a custom LLM API endpoint
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <CreateCustomProviderDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onSuccess={() => {
          setIsDialogOpen(false);
          refetch();
        }}
      />
    </div>
  );
}
