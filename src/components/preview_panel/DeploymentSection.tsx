import { Server } from "lucide-react";
import { VercelConnector } from "@/components/VercelConnector";
import { CoolifyConnector } from "@/components/CoolifyConnector";
import { ipc } from "@/ipc/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettings } from "@/hooks/useSettings";

/**
 * Where an app is published: Vercel, or a server the user runs themselves.
 *
 * The two are alternatives, so they share one card and a pair of tabs rather
 * than stacking two cards that each look like the next required step.
 *
 * Deploying to your own server is off by default. With it off this renders
 * exactly the Vercel card that was here before the option existed — no tabs,
 * no mention of a second destination.
 */

interface AppSummary {
  name: string;
  githubOrg: string | null;
  githubRepo: string | null;
}

function VercelDashboardLink() {
  return (
    <button
      onClick={() => {
        ipc.system.openExternalUrl("https://vercel.com/dashboard");
      }}
      className="flex items-center gap-2 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer bg-transparent border-none p-0"
    >
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M24 22.525H0l12-21.05 12 21.05z" />
      </svg>
      Vercel
    </button>
  );
}

function VercelDeployment({ appId, app }: { appId: number; app: AppSummary }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Publish your app by deploying it to Vercel.
      </p>

      {!app.githubOrg || !app.githubRepo ? (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg
              className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            <div>
              <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">
                GitHub Required for Vercel Deployment
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Deploying to Vercel requires connecting to GitHub first. Please
                set up your GitHub repository above.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <VercelConnector appId={appId} folderName={app.name} />
      )}
    </div>
  );
}

function OwnServerDeployment({ appId }: { appId: number }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Deploy this app to a server you own, running Coolify. Its database stays
        where it is.
      </p>
      <CoolifyConnector appId={appId} />
    </div>
  );
}

export function DeploymentSection({
  appId,
  app,
}: {
  appId: number;
  app: AppSummary;
}) {
  const { settings } = useSettings();

  if (!settings?.enableOwnServerDeployment) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <VercelDashboardLink />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VercelDeployment appId={appId} app={app} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Deployment</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="vercel">
          <TabsList>
            <TabsTrigger value="vercel">Vercel</TabsTrigger>
            <TabsTrigger value="own-server">Your Own Server</TabsTrigger>
          </TabsList>
          <TabsContent value="vercel" className="pt-4 space-y-4">
            {/* The link lived in the card header before the tabs, and the
                header is no longer Vercel's alone. */}
            <div className="text-sm font-semibold">
              <VercelDashboardLink />
            </div>
            <VercelDeployment appId={appId} app={app} />
          </TabsContent>
          <TabsContent value="own-server" className="pt-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Server className="w-5 h-5" />
              Your own server
            </div>
            <OwnServerDeployment appId={appId} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
