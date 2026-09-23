import { Cloud, Server } from "lucide-react";
import { VercelConnector } from "@/components/VercelConnector";
import { CoolifyConnector } from "@/components/CoolifyConnector";
import { CloudflareConnector } from "@/components/CloudflareConnector";
import { ipc } from "@/ipc/types";
import type { DeploymentProvidersInUse } from "@/ipc/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettings } from "@/hooks/useSettings";

/**
 * Where an app is published: Vercel, Cloudflare, or a server the user runs
 * themselves.
 *
 * They are alternatives, so they share one card and a row of tabs rather than
 * stacking cards that each look like the next required step.
 *
 * Cloudflare and your own server are each off by default. With both off this
 * renders exactly the Vercel card that was here before the options existed —
 * no tabs, no mention of another destination.
 */

interface AppSummary {
  name: string;
  githubOrg: string | null;
  githubRepo: string | null;
  deploymentProvidersInUse: DeploymentProvidersInUse;
}

export type DeploymentTab = "vercel" | "cloudflare" | "own-server";

const PROVIDER_FOR_TAB: Record<DeploymentTab, keyof DeploymentProvidersInUse> =
  {
    vercel: "vercel",
    cloudflare: "cloudflare",
    "own-server": "coolify",
  };

/** The tabs on screen, in display order. */
export function visibleDeploymentTabs({
  showCloudflare,
  showOwnServer,
}: {
  showCloudflare: boolean;
  showOwnServer: boolean;
}): DeploymentTab[] {
  return [
    "vercel",
    ...(showCloudflare ? (["cloudflare"] as const) : []),
    ...(showOwnServer ? (["own-server"] as const) : []),
  ];
}

/**
 * The tab the card opens on: the first one, in display order, whose
 * destination this app is connected to, or the first tab when it is
 * connected to none of them.
 *
 * Only tabs on screen are candidates, so a destination the user has not
 * turned on cannot be chosen even when the app is connected to it. When a
 * destination stops being optional its tab is always on screen and this
 * needs no change.
 */
export function chooseDefaultDeploymentTab(
  tabs: readonly DeploymentTab[],
  inUse: DeploymentProvidersInUse,
): DeploymentTab {
  return tabs.find((tab) => inUse[PROVIDER_FOR_TAB[tab]]) ?? tabs[0];
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

function GithubRequiredNotice({ provider }: { provider: string }) {
  return (
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
            GitHub Required for {provider} Deployment
          </h3>
          <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
            Deploying to {provider} requires connecting to GitHub first. Please
            set up your GitHub repository above.
          </p>
        </div>
      </div>
    </div>
  );
}

function VercelDeployment({ appId, app }: { appId: number; app: AppSummary }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Publish your app by deploying it to Vercel.
      </p>

      {!app.githubOrg || !app.githubRepo ? (
        <GithubRequiredNotice provider="Vercel" />
      ) : (
        <VercelConnector appId={appId} folderName={app.name} />
      )}
    </div>
  );
}

function CloudflareDeployment({
  appId,
  app,
}: {
  appId: number;
  app: AppSummary;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Deploy a Cloudflare Worker from this app. Cloudflare builds it from your
        GitHub repository on every sync.
      </p>
      {!app.githubOrg || !app.githubRepo ? (
        <GithubRequiredNotice provider="Cloudflare" />
      ) : (
        <CloudflareConnector appId={appId} />
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

  const showCloudflare = !!settings?.enableCloudflareDeployment;
  const showOwnServer = !!settings?.enableOwnServerDeployment;

  if (!showCloudflare && !showOwnServer) {
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
        {/* The default is read once, when the tabs mount, and the tab then
            belongs to the user: connecting or disconnecting something from
            inside a tab never moves them. Keyed by app because this component
            stays mounted when the selected app changes, and the next app
            gets its own choice. */}
        <Tabs
          key={appId}
          defaultValue={chooseDefaultDeploymentTab(
            visibleDeploymentTabs({ showCloudflare, showOwnServer }),
            app.deploymentProvidersInUse,
          )}
        >
          <TabsList>
            <TabsTrigger value="vercel">Vercel</TabsTrigger>
            {showCloudflare && (
              <TabsTrigger value="cloudflare">Cloudflare</TabsTrigger>
            )}
            {showOwnServer && (
              <TabsTrigger value="own-server">Your Own Server</TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="vercel" className="pt-4 space-y-4">
            {/* The link lived in the card header before the tabs, and the
                header is no longer Vercel's alone. */}
            <div className="text-sm font-semibold">
              <VercelDashboardLink />
            </div>
            <VercelDeployment appId={appId} app={app} />
          </TabsContent>
          {/* Mounted on first click, unlike your own server below: mounting it
              with the card would call Cloudflare every time Publish opens,
              for users who never leave the Vercel tab. */}
          {showCloudflare && (
            <TabsContent value="cloudflare" className="pt-4 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Cloud className="w-5 h-5" />
                Cloudflare
              </div>
              <CloudflareDeployment appId={appId} app={app} />
            </TabsContent>
          )}
          {/* Mounted with the card rather than on first click. The connector
              cannot read its status until it mounts, so a lazy panel opens on
              a spinner and then jumps to full height. The cost is that opening
              Publish now reaches the user's Coolify server for its server and
              project list, whether or not they come to this tab. */}
          {showOwnServer && (
            <TabsContent
              value="own-server"
              className="pt-4 space-y-4"
              keepMounted
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Server className="w-5 h-5" />
                Your own server
              </div>
              <OwnServerDeployment appId={appId} />
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}
