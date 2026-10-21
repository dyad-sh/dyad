import { Cloud, Server } from "lucide-react";
import { VercelConnector } from "@/components/VercelConnector";
import { CoolifyConnector } from "@/components/CoolifyConnector";
import { CloudflareConnector } from "@/components/CloudflareConnector";
import { ipc } from "@/ipc/types";
import type { DeploymentProvidersInUse } from "@/ipc/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettings } from "@/hooks/useSettings";
import { describeLinkedRemote } from "@/shared/linked_remote";

/**
 * Where an app is published: Vercel, Cloudflare, or a server the user runs
 * themselves.
 *
 * They are alternatives, so they share one card and a row of tabs rather than
 * stacking cards that each look like the next required step.
 *
 * Your own server is off by default, and its tab is hidden until it is turned
 * on.
 */

interface AppSummary {
  name: string;
  githubOrg: string | null;
  githubRepo: string | null;
  gitlabInstanceUrl?: string | null;
  gitlabProjectId?: number | null;
  gitlabProjectPath?: string | null;
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
  showOwnServer,
}: {
  showOwnServer: boolean;
}): DeploymentTab[] {
  return [
    "vercel",
    "cloudflare",
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

/**
 * Why a destination that deploys from GitHub cannot deploy this app: it has no
 * repository yet, or its repository is on another provider.
 */
function GithubRequiredNotice({
  provider,
  app,
}: {
  provider: string;
  app: AppSummary;
}) {
  const linked = describeLinkedRemote(app);
  const { settings, settingsLoading } = useSettings();
  // Own-server deployment is itself behind an experiment that is off by
  // default, so pointing a GitLab user at it without saying where it lives
  // named a control that is nowhere on their screen. Until settings arrive
  // the flag reads false, so neither branch of that advice is known to be
  // true yet — say nothing rather than the wrong thing.
  const ownServerAvailable = Boolean(settings?.enableOwnServerDeployment);
  return (
    <div
      className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4"
      data-testid={`${provider.toLowerCase()}-requires-github`}
    >
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
            {linked && linked.provider !== "github" ? (
              <>
                This app is linked to {linked.providerLabel}. {provider} deploys
                from GitHub only
                {settingsLoading
                  ? "."
                  : ownServerAvailable
                    ? "; deploy it to your own server instead."
                    : "; turn on “Deploy to your own server” in Settings → Experiments to deploy it."}
              </>
            ) : (
              <>
                Deploying to {provider} requires connecting to GitHub first.
                Please set up your GitHub repository above.
              </>
            )}
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
        <GithubRequiredNotice provider="Vercel" app={app} />
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
        <GithubRequiredNotice provider="Cloudflare" app={app} />
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

  const showOwnServer = !!settings?.enableOwnServerDeployment;

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
            visibleDeploymentTabs({ showOwnServer }),
            app.deploymentProvidersInUse,
          )}
        >
          <TabsList>
            <TabsTrigger value="vercel">Vercel</TabsTrigger>
            <TabsTrigger value="cloudflare">Cloudflare</TabsTrigger>
            {showOwnServer && (
              <TabsTrigger value="own-server">Your Own Server</TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="vercel" className="pt-4 space-y-4">
            <div className="text-sm font-semibold">
              <VercelDashboardLink />
            </div>
            <VercelDeployment appId={appId} app={app} />
          </TabsContent>
          {/* Mounted when its tab is selected: on open when Cloudflare is the
              tab the card opens on, on first click otherwise. Unlike your own
              server below, mounting it with the card would call Cloudflare
              every time Publish opens, for users who never leave the Vercel
              tab. */}
          <TabsContent value="cloudflare" className="pt-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Cloud className="w-5 h-5" />
              Cloudflare
            </div>
            <CloudflareDeployment appId={appId} app={app} />
          </TabsContent>
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
