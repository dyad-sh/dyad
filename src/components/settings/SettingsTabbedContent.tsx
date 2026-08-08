import { useAtom } from "jotai";
import type { ReactNode } from "react";
import { activeSettingsTabAtom } from "@/atoms/viewAtoms";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SETTINGS_TABS, type SettingsTabId } from "@/lib/settingsTabs";
import { SECTION_IDS, SETTING_IDS } from "@/lib/settingsSearchIndex";
import { ProviderSettingsGrid } from "@/components/ProviderSettings";
import { GitHubIntegration } from "@/components/GitHubIntegration";
import { VercelIntegration } from "@/components/VercelIntegration";
import { NeonIntegration } from "@/components/NeonIntegration";
import { SupabaseConnectionSettings } from "@/components/settings/SupabaseConnectionSettings";
import { AgentToolsSettings } from "@/components/settings/AgentToolsSettings";
import { ToolsMcpSettings } from "@/components/settings/ToolsMcpSettings";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CloudSandboxExperimentSwitch } from "@/components/CloudSandboxExperimentSwitch";
import { BlockUnsafeNpmPackagesSwitch } from "@/components/BlockUnsafeNpmPackagesSwitch";
import { useSettings } from "@/hooks/useSettings";
import { SystemSettings } from "@/components/settings/GeneralSettingsSections";
import { ModelRolesSettings } from "@/components/settings/ModelRolesSettings";
import { JarvisSettings } from "@/components/settings/JarvisSettings";
import { SettingsTabSaveBar } from "@/components/settings/SettingsTabSaveBar";
import { StorageSettings } from "@/components/settings/StorageSettings";
import { LovablePluginSettings } from "@/components/settings/LovablePluginSettings";
import { ResearchPluginSettings } from "@/components/settings/ResearchPluginSettings";
import { ChatAgentSystemAccessSettings } from "@/components/settings/ChatAgentSystemAccessSettings";
import { SocialConnectionCard } from "@/components/social/SocialConnectionCard";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AtSign,
  Compass,
  Database,
  Github,
  HeartHandshake,
  CloudSun,
  Coins,
  MapPinned,
  Plane,
  Search,
  Share2,
  TicketCheck,
  Triangle,
} from "lucide-react";

const settingsCardClass =
  "rounded-xl p-6 scroll-mt-24 border border-cyan-500/15 bg-[rgba(8,18,36,0.72)] shadow-[0_0_24px_rgba(0,229,255,0.06)] backdrop-blur-md";

const sectionHeadingClass =
  "font-jarvis-ui text-sm font-medium uppercase tracking-widest text-cyan-300/70 mb-4";

const integrationAccordionItemClass =
  "overflow-hidden rounded-xl border border-cyan-400/15 bg-slate-950/35 shadow-[0_0_18px_rgba(0,229,255,0.04)]";

function IntegrationRow({
  value,
  title,
  description,
  icon: Icon,
  children,
}: {
  value: string;
  title: string;
  description: string;
  icon: typeof Github;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={value} className={integrationAccordionItemClass}>
      <AccordionTrigger className="items-center px-4 py-3.5 hover:no-underline">
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-cyan-400/15 bg-cyan-400/8 text-cyan-300">
            <Icon className="size-4.5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-cyan-50">
              {title}
            </span>
            <span className="block truncate text-xs font-normal text-cyan-100/40">
              {description}
            </span>
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="border-t border-cyan-400/10 px-4 pt-4">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

type SettingsTabbedContentProps = {
  appVersion: string | null;
  isResetting: boolean;
  onOpenResetDialog: () => void;
};

export function SettingsTabbedContent({
  appVersion,
  isResetting,
  onOpenResetDialog,
}: SettingsTabbedContentProps) {
  const [activeTab, setActiveTab] = useAtom(activeSettingsTabAtom);
  const { settings, updateSettings } = useSettings();

  const handleTabChange = (value: string | null) => {
    if (value && SETTINGS_TABS.some((tab) => tab.id === value)) {
      setActiveTab(value as SettingsTabId);
    }
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="w-full flex-col items-stretch gap-6 lg:flex-row lg:items-start"
    >
      {/* Vertical tab cards in front of the settings content */}
      <TabsList className="grid h-auto w-full shrink-0 grid-cols-2 gap-2 rounded-none border-0 bg-transparent p-0 sm:grid-cols-3 lg:sticky lg:top-6 lg:flex lg:w-64 lg:flex-col">
        {SETTINGS_TABS.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            className="group relative w-full justify-start gap-3 overflow-hidden rounded-xl border border-cyan-500/15 bg-[rgba(8,18,36,0.6)] px-3 py-2.5 text-left backdrop-blur-md transition-all hover:border-cyan-400/30 hover:bg-cyan-500/5 data-active:border-cyan-400/45 data-active:bg-cyan-500/12 data-active:shadow-[0_0_18px_rgba(0,229,255,0.14)]"
          >
            <span
              aria-hidden
              className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-cyan-400 opacity-0 shadow-[0_0_10px_rgba(0,229,255,0.8)] transition-opacity group-data-active:opacity-100"
            />
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-cyan-400/15 bg-cyan-500/8 text-cyan-300/60 transition-colors group-data-active:border-cyan-400/40 group-data-active:bg-cyan-500/15 group-data-active:text-cyan-200">
              <tab.icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-cyan-100/65 transition-colors group-hover:text-cyan-100/90 group-data-active:text-cyan-50">
                {tab.label}
              </span>
              <span className="hidden truncate text-[11px] text-cyan-100/30 transition-colors group-data-active:text-cyan-100/55 lg:block">
                {tab.description}
              </span>
            </span>
          </TabsTrigger>
        ))}
      </TabsList>

      {/* Settings content */}
      <div className="min-w-0 flex-1">
        <TabsContent
          value="ai"
          className="space-y-6 focus-visible:outline-none"
        >
          <div
            id={SECTION_IDS.providers}
            className="scroll-mt-24 overflow-hidden rounded-xl border border-cyan-500/15 bg-[rgba(8,18,36,0.72)] shadow-[0_0_24px_rgba(0,229,255,0.06)] backdrop-blur-md"
          >
            <ProviderSettingsGrid />
          </div>
          <SettingsTabSaveBar tabId="ai" />
        </TabsContent>

        <TabsContent
          value="modelRoles"
          className="space-y-6 pb-24 focus-visible:outline-none"
        >
          <ModelRolesSettings />
          <SettingsTabSaveBar tabId="modelRoles" />
        </TabsContent>

        <TabsContent
          value="jarvis"
          className="space-y-6 pb-24 focus-visible:outline-none"
        >
          <JarvisSettings />
          <SettingsTabSaveBar tabId="jarvis" />
        </TabsContent>

        <TabsContent
          value="plugins"
          className="space-y-6 focus-visible:outline-none"
        >
          <div
            id={SECTION_IDS.plugins}
            className={`${settingsCardClass} space-y-6`}
          >
            <div>
              <h2 className={sectionHeadingClass}>Plugins</h2>
              <p className="text-sm text-cyan-100/45">
                Connect developer services, research data and MCP-backed
                platforms. Enabled research plugins are available to the default
                Chat Agent.
              </p>
            </div>

            <Accordion className="gap-3">
              <IntegrationRow
                value="github"
                title="GitHub"
                description="Repository and file management"
                icon={Github}
              >
                <div id={SETTING_IDS.github}>
                  <GitHubIntegration />
                </div>
              </IntegrationRow>

              <IntegrationRow
                value="vercel"
                title="Vercel"
                description="Project and deployment management"
                icon={Triangle}
              >
                <div id={SETTING_IDS.vercel}>
                  <VercelIntegration />
                </div>
              </IntegrationRow>

              <IntegrationRow
                value="lovable"
                title="Lovable"
                description="MCP access for projects, builds and published sites"
                icon={HeartHandshake}
              >
                <div id={SETTING_IDS.lovable}>
                  <LovablePluginSettings />
                </div>
              </IntegrationRow>

              <IntegrationRow
                value="travel-search"
                title="Travel Search"
                description="Keyless flight searches that open current fares"
                icon={Compass}
              >
                <div id={SETTING_IDS.travelSearch}>
                  <ResearchPluginSettings plugin="travel-search" />
                </div>
              </IntegrationRow>

              <IntegrationRow
                value="duckduckgo"
                title="DuckDuckGo"
                description="Keyless web lookups and Instant Answers"
                icon={Search}
              >
                <div id={SETTING_IDS.duckDuckGo}>
                  <ResearchPluginSettings plugin="duckduckgo" />
                </div>
              </IntegrationRow>

              <IntegrationRow
                value="coingecko"
                title="CoinGecko"
                description="Live cryptocurrency prices and market data"
                icon={Coins}
              >
                <div id={SETTING_IDS.coinGecko}>
                  <ResearchPluginSettings plugin="coingecko" />
                </div>
              </IntegrationRow>

              <IntegrationRow
                value="weather"
                title="Open-Meteo Weather"
                description="Keyless live weather and forecasts"
                icon={CloudSun}
              >
                <div id={SETTING_IDS.weather}>
                  <ResearchPluginSettings plugin="weather" />
                </div>
              </IntegrationRow>

              <IntegrationRow
                value="maps"
                title="Maps"
                description="Place search with interactive OpenFreeMap maps"
                icon={MapPinned}
              >
                <div id={SETTING_IDS.maps}>
                  <ResearchPluginSettings plugin="maps" />
                </div>
              </IntegrationRow>

              <IntegrationRow
                value="amadeus"
                title="Amadeus Flight Offers"
                description="Structured fares with a free monthly API quota"
                icon={TicketCheck}
              >
                <div id={SETTING_IDS.amadeus}>
                  <ResearchPluginSettings plugin="amadeus" />
                </div>
              </IntegrationRow>

              <IntegrationRow
                value="skyscanner"
                title="Skyscanner"
                description="Live flight prices for approved API partners"
                icon={Plane}
              >
                <div id={SETTING_IDS.skyscanner}>
                  <ResearchPluginSettings plugin="skyscanner" />
                </div>
              </IntegrationRow>

              <IntegrationRow
                value="duffel"
                title="Duffel Sandbox"
                description="Simulated test fares for development"
                icon={Plane}
              >
                <div id={SETTING_IDS.duffel}>
                  <ResearchPluginSettings plugin="duffel" />
                </div>
              </IntegrationRow>
            </Accordion>
          </div>
          <SettingsTabSaveBar tabId="plugins" />
        </TabsContent>

        <TabsContent
          value="integrations"
          className="space-y-6 focus-visible:outline-none"
        >
          <div
            id={SECTION_IDS.integrations}
            className={`${settingsCardClass} space-y-6`}
          >
            <div>
              <h2 className={sectionHeadingClass}>Integrations</h2>
              <p className="text-sm text-cyan-100/45">
                Connect databases and publishing services from one place.
              </p>
            </div>

            <Accordion className="gap-3">
              <IntegrationRow
                value="supabase"
                title="Supabase"
                description="Postgres, authentication and app storage"
                icon={Database}
              >
                <div id={SECTION_IDS.connections} className="scroll-mt-24">
                  <div id={SETTING_IDS.supabase}>
                    <SupabaseConnectionSettings />
                  </div>
                </div>
              </IntegrationRow>

              <IntegrationRow
                value="neon"
                title="Neon"
                description="Serverless Postgres databases"
                icon={Database}
              >
                <div id={SETTING_IDS.neon}>
                  <NeonIntegration />
                </div>
              </IntegrationRow>

              <IntegrationRow
                value="facebook"
                title="Facebook"
                description="Publish posts and images to a Facebook Page"
                icon={Share2}
              >
                <div id={SETTING_IDS.facebook}>
                  <SocialConnectionCard platform="facebook" />
                </div>
              </IntegrationRow>

              <IntegrationRow
                value="x"
                title="X"
                description="Publish posts and images to an X account"
                icon={AtSign}
              >
                <div id={SETTING_IDS.xIntegration}>
                  <SocialConnectionCard platform="x" />
                </div>
              </IntegrationRow>
            </Accordion>
          </div>
          <SettingsTabSaveBar tabId="integrations" />
        </TabsContent>

        <TabsContent
          value="storage"
          className="space-y-6 pb-24 focus-visible:outline-none"
        >
          <StorageSettings />
        </TabsContent>

        <TabsContent
          value="mcp"
          className="space-y-6 focus-visible:outline-none"
        >
          <div id={SECTION_IDS.toolsMcp} className={settingsCardClass}>
            <h2 className={sectionHeadingClass}>Tools (MCP)</h2>
            <ToolsMcpSettings />
          </div>
          <SettingsTabSaveBar tabId="mcp" />
        </TabsContent>

        <TabsContent
          value="agent"
          className="space-y-6 focus-visible:outline-none"
        >
          <div id={SECTION_IDS.agentPermissions} className={settingsCardClass}>
            <h2 className={sectionHeadingClass}>Tool Permissions (Pro)</h2>
            <AgentToolsSettings />
          </div>
          <SettingsTabSaveBar tabId="agent" />
        </TabsContent>

        <TabsContent
          value="advanced"
          className="space-y-6 focus-visible:outline-none"
        >
          <div id={SECTION_IDS.experiments} className={settingsCardClass}>
            <h2 className={sectionHeadingClass}>Experiments</h2>
            <div className="space-y-4">
              <div id={SETTING_IDS.nativeGit} className="space-y-1 mt-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enable-native-git"
                    aria-label="Enable Native Git"
                    checked={!!settings?.enableNativeGit}
                    onCheckedChange={(checked) => {
                      updateSettings({
                        enableNativeGit: checked,
                      });
                    }}
                  />
                  <Label htmlFor="enable-native-git">Enable Native Git</Label>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  This doesn't require any external Git installation and offers
                  a faster, native-Git performance experience.
                </div>
              </div>
              <div
                id={SETTING_IDS.enableCloudSandbox}
                className="space-y-1 mt-4"
              >
                <CloudSandboxExperimentSwitch />
              </div>
              <div
                id={SETTING_IDS.enableSandboxScriptExecution}
                className="space-y-1 mt-4"
              >
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enable-sandbox-script-execution"
                    aria-label="Enable sandbox script execution"
                    checked={
                      !!settings?.experiments?.enableSandboxScriptExecution
                    }
                    onCheckedChange={(checked) => {
                      updateSettings({
                        experiments: {
                          ...settings?.experiments,
                          enableSandboxScriptExecution: checked,
                        },
                      });
                    }}
                  />
                  <Label htmlFor="enable-sandbox-script-execution">
                    Enable sandbox script execution
                  </Label>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Allow local-agent attachment scripts to inspect files with
                  execute_sandbox_script.
                </div>
              </div>
              <div
                id={SETTING_IDS.blockUnsafeNpmPackages}
                className="space-y-1 mt-4"
              >
                <BlockUnsafeNpmPackagesSwitch />
              </div>
              <div
                id={SETTING_IDS.enableMcpServersForBuildMode}
                className="space-y-1 mt-4"
              >
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enable-mcp-servers-for-build-mode"
                    aria-label="Enable MCP servers for Build mode"
                    checked={!!settings?.enableMcpServersForBuildMode}
                    onCheckedChange={(checked) => {
                      updateSettings({
                        enableMcpServersForBuildMode: checked,
                      });
                    }}
                  />
                  <Label htmlFor="enable-mcp-servers-for-build-mode">
                    Enable MCP servers for Build mode
                  </Label>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Allow MCP servers to be used when in Build mode. Note: MCP
                  servers are always enabled in Agent mode.
                </div>
              </div>
              <div
                id={SETTING_IDS.enableSelectAppFromHomeChatInput}
                className="space-y-1 mt-4"
              >
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enable-select-app-from-home-chat-input"
                    aria-label="Enable Select App from Home Chat Input"
                    checked={!!settings?.enableSelectAppFromHomeChatInput}
                    onCheckedChange={(checked) => {
                      updateSettings({
                        enableSelectAppFromHomeChatInput: checked,
                      });
                    }}
                  />
                  <Label htmlFor="enable-select-app-from-home-chat-input">
                    Enable Select App from Home Chat Input
                  </Label>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Show an app selector in the home chat input to start a chat
                  referencing an existing app.
                </div>
              </div>
            </div>
          </div>

          <SettingsTabSaveBar tabId="advanced" />
        </TabsContent>

        <TabsContent
          value="skills"
          className="space-y-6 pb-24 focus-visible:outline-none"
        >
          <ChatAgentSystemAccessSettings />
          <SettingsTabSaveBar tabId="skills" />
        </TabsContent>

        <TabsContent
          value="general"
          className="space-y-6 focus-visible:outline-none"
        >
          <SystemSettings appVersion={appVersion} />
          <div
            id={SECTION_IDS.dangerZone}
            className={`${settingsCardClass} !border-red-500/30`}
          >
            <h2 className="mb-4 font-jarvis-ui text-sm font-medium uppercase tracking-widest text-red-400">
              Danger Zone
            </h2>
            <div className="space-y-4">
              <div
                id={SETTING_IDS.reset}
                className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"
              >
                <div>
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                    Reset Everything
                  </h3>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    This will delete all your apps, chats, and settings. This
                    action cannot be undone.
                  </p>
                </div>
                <button
                  onClick={onOpenResetDialog}
                  disabled={isResetting}
                  className="rounded-md border border-transparent bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isResetting ? "Resetting..." : "Reset Everything"}
                </button>
              </div>
            </div>
          </div>
          <SettingsTabSaveBar tabId="general" />
        </TabsContent>
      </div>
    </Tabs>
  );
}
