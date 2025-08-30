import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Info, KeyRound } from "lucide-react";

interface AzureConfigurationProps {
  envVars: Record<string, string | undefined>;
}

export function AzureConfiguration({ envVars }: AzureConfigurationProps) {
  const azureApiKey = envVars["AZURE_API_KEY"];
  const azureResourceName = envVars["AZURE_RESOURCE_NAME"];

  const isAzureConfigured = !!(azureApiKey && azureResourceName);

  return (
    <div className="space-y-4">
      <Alert
        variant={isAzureConfigured ? "default" : "destructive"}
        className={
          isAzureConfigured
            ? ""
            : "border-red-200 bg-red-100 dark:border-red-800/50 dark:bg-red-800/20"
        }
      >
        <Info
          className={`h-4 w-4 ${isAzureConfigured ? "" : "text-red-800 dark:text-red-400"}`}
        />
        <AlertTitle
          className={isAzureConfigured ? "" : "text-red-800 dark:text-red-400"}
        >
          Azure OpenAI Configuration
        </AlertTitle>
        <AlertDescription
          className={isAzureConfigured ? "" : "text-red-800 dark:text-red-400"}
        >
          Azure OpenAI requires both an API key and resource name to be
          configured via environment variables.
        </AlertDescription>
      </Alert>

      <Accordion
        type="multiple"
        className="w-full space-y-4"
        defaultValue={["azure-config"]}
      >
        <AccordionItem
          value="azure-config"
          className="border rounded-lg px-4 bg-background"
        >
          <AccordionTrigger className="text-lg font-medium hover:no-underline cursor-pointer">
            Environment Variables Configuration
          </AccordionTrigger>
          <AccordionContent className="pt-4">
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">
                  Required Environment Variables:
                </h4>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-center p-3 bg-muted rounded border">
                    <code className="font-mono text-foreground">
                      AZURE_API_KEY
                    </code>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${azureApiKey ? "bg-green-100 text-green-800 dark:bg-green-800/20 dark:text-green-400" : "bg-red-100 text-red-800 dark:bg-red-800/20 dark:text-red-400"}`}
                    >
                      {azureApiKey ? "Set" : "Not Set"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-muted rounded border">
                    <code className="font-mono text-foreground">
                      AZURE_RESOURCE_NAME
                    </code>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${azureResourceName ? "bg-green-100 text-green-800 dark:bg-green-800/20 dark:text-green-400" : "bg-red-100 text-red-800 dark:bg-red-800/20 dark:text-red-400"}`}
                    >
                      {azureResourceName ? "Set" : "Not Set"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-950/30 rounded border border-blue-200 dark:border-blue-700">
                <h5 className="font-medium mb-2 text-blue-900 dark:text-blue-200">
                  How to configure:
                </h5>
                <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800 dark:text-blue-300">
                  <li>Get your API key from the Azure portal</li>
                  <li>
                    Find your resource name (the name you gave your Azure OpenAI
                    resource)
                  </li>
                  <li>Set these environment variables before starting Dyad</li>
                  <li>Restart Dyad after setting the environment variables</li>
                </ol>
              </div>

              {isAzureConfigured && (
                <Alert>
                  <KeyRound className="h-4 w-4" />
                  <AlertTitle>Azure OpenAI Configured</AlertTitle>
                  <AlertDescription>
                    Both required environment variables are set. You can now use
                    Azure OpenAI models.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
