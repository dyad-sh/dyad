import { useAtom, useAtomValue } from "jotai";
import { useEffect, useState, type ReactNode } from "react";
import { activeSettingsTabAtom } from "@/atoms/viewAtoms";
import { activeSettingsSectionAtom } from "@/atoms/viewAtoms";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SETTINGS_TABS, type SettingsTabId } from "@/lib/settingsTabs";
import { SECTION_IDS, SETTING_IDS } from "@/lib/settingsSearchIndex";
import { ProviderSettingsGrid } from "@/components/ProviderSettings";
import { GitHubIntegration } from "@/components/GitHubIntegration";
import { VercelIntegration } from "@/components/VercelIntegration";
import { SupabaseConnectionSettings } from "@/components/settings/SupabaseConnectionSettings";
import { AgentToolsSettings } from "@/components/settings/AgentToolsSettings";
import { ToolsMcpSettings } from "@/components/settings/ToolsMcpSettings";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  INTEGRATIONS,
  PLUGIN_CATEGORIES,
  type IntegrationCatalogId,
  type PluginCatalogId,
  type PluginCategory,
} from "@/lib/connection_catalog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AtSign,
  Braces,
  Compass,
  Database,
  Github,
  HeartHandshake,
  CloudSun,
  Coins,
  MapPinned,
  Plane,
  Search,
  SearchX,
  Share2,
  TicketCheck,
  Triangle,
  UserRoundCheck,
} from "lucide-react";

const settingsCardClass =
  "rounded-2xl border border-border/70 bg-card/90 p-5 shadow-sm backdrop-blur-md scroll-mt-24 sm:p-6";

const sectionHeadingClass =
  "mb-4 font-jarvis-ui text-xs font-semibold uppercase tracking-[0.18em] text-primary";

const integrationAccordionItemClass =
  "group/connection overflow-hidden rounded-xl border border-border/70 bg-background/45 shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-primary/30 hover:shadow-md";

const pluginIcons: Record<PluginCatalogId, typeof Github> = {
  github: Github,
  vercel: Triangle,
  lovable: HeartHandshake,
  duckduckgo: Search,
  coingecko: Coins,
  weather: CloudSun,
  maps: MapPinned,
  "travel-search": Compass,
  amadeus: TicketCheck,
  skyscanner: Plane,
  duffel: Plane,
};

const integrationIcons: Record<IntegrationCatalogId, typeof Github> = {
  supabase: Database,
  facebook: Share2,
  x: AtSign,
};

const categoryIcons: Record<PluginCategory["id"], typeof Github> = {
  developer: Braces,
  "live-data": Search,
  travel: Plane,
};

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
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/8 text-primary transition-colors group-hover/connection:bg-primary/12">
            <Icon className="size-4.5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">
              {title}
            </span>
            <span className="mt-0.5 block text-left text-xs leading-5 font-normal text-muted-foreground sm:truncate">
              {description}
            </span>
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="border-t border-border/60 px-4 pt-4">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

function PluginCategorySection({
  category,
  children,
}: {
  category: PluginCategory;
  children: ReactNode;
}) {
  const Icon = categoryIcons[category.id];
  return (
    <section aria-labelledby={`plugin-category-${category.id}`}>
      <div className="mb-3 flex items-center gap-3 px-1">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <div>
          <h3
            id={`plugin-category-${category.id}`}
            className="text-sm font-semibold text-foreground"
          >
            {category.title}
          </h3>
          <p className="text-xs text-muted-foreground">
            {category.description}
          </p>
        </div>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {category.plugins.length}
        </span>
      </div>
      <Accordion className="grid gap-2.5 md:grid-cols-2">{children}</Accordion>
    </section>
  );
}

function PluginSettingsBody({ id }: { id: PluginCatalogId }) {
  switch (id) {
    case "github":
      return (
        <div id={SETTING_IDS.github}>
          <GitHubIntegration />
        </div>
      );
    case "vercel":
      return (
        <div id={SETTING_IDS.vercel}>
          <VercelIntegration />
        </div>
      );
    case "lovable":
      return (
        <div id={SETTING_IDS.lovable}>
          <LovablePluginSettings />
        </div>
      );
    case "travel-search":
      return (
        <div id={SETTING_IDS.travelSearch}>
          <ResearchPluginSettings plugin="travel-search" />
        </div>
      );
    case "duckduckgo":
      return (
        <div id={SETTING_IDS.duckDuckGo}>
          <ResearchPluginSettings plugin="duckduckgo" />
        </div>
      );
    case "coingecko":
      return (
        <div id={SETTING_IDS.coinGecko}>
          <ResearchPluginSettings plugin="coingecko" />
        </div>
      );
    case "weather":
      return (
        <div id={SETTING_IDS.weather}>
          <ResearchPluginSettings plugin="weather" />
        </div>
      );
    case "maps":
      return (
        <div id={SETTING_IDS.maps}>
          <ResearchPluginSettings plugin="maps" />
        </div>
      );
    case "amadeus":
      return (
        <div id={SETTING_IDS.amadeus}>
          <ResearchPluginSettings plugin="amadeus" />
        </div>
      );
    case "skyscanner":
      return (
        <div id={SETTING_IDS.skyscanner}>
          <ResearchPluginSettings plugin="skyscanner" />
        </div>
      );
    case "duffel":
      return (
        <div id={SETTING_IDS.duffel}>
          <ResearchPluginSettings plugin="duffel" />
        </div>
      );
  }
}

function IntegrationSettingsBody({ id }: { id: IntegrationCatalogId }) {
  switch (id) {
    case "supabase":
      return (
        <div id={SECTION_IDS.connections} className="scroll-mt-24">
          <div id={SETTING_IDS.supabase}>
            <SupabaseConnectionSettings />
          </div>
        </div>
      );
    case "facebook":
      return (
        <div id={SETTING_IDS.facebook}>
          <SocialConnectionCard platform="facebook" />
        </div>
      );
    case "x":
      return (
        <div id={SETTING_IDS.xIntegration}>
          <SocialConnectionCard platform="x" />
        </div>
      );
  }
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
  hideTabList = false,
}: SettingsTabbedContentProps & { hideTabList?: boolean }) {
  const [activeTab, setActiveTab] = useAtom(activeSettingsTabAtom);
  const activeSection = useAtomValue(activeSettingsSectionAtom);
  const [extensionView, setExtensionView] = useState<
    "plugins" | "skills" | "integrations"
  >("plugins");
  const [extensionQuery, setExtensionQuery] = useState("");
  const { settings, updateSettings } = useSettings();

  const normalizedExtensionQuery = extensionQuery.trim().toLowerCase();
  const filteredPluginCategories = PLUGIN_CATEGORIES.map((category) => ({
    ...category,
    plugins: category.plugins.filter(
      (plugin) =>
        normalizedExtensionQuery.length === 0 ||
        plugin.title.toLowerCase().includes(normalizedExtensionQuery) ||
        plugin.description.toLowerCase().includes(normalizedExtensionQuery),
    ),
  })).filter((category) => category.plugins.length > 0);
  const filteredIntegrations = INTEGRATIONS.filter(
    (integration) =>
      normalizedExtensionQuery.length === 0 ||
      integration.title.toLowerCase().includes(normalizedExtensionQuery) ||
      integration.description.toLowerCase().includes(normalizedExtensionQuery),
  );
  const builtInPlugins = PLUGIN_CATEGORIES.flatMap(
    (category) => category.plugins,
  );
  const extensionViewCopy = {
    plugins: {
      title: "Plugins",
      description:
        "Work with Meta Human across your favourite tools and live services.",
      search: "Search plugins",
    },
    skills: {
      title: "Skills",
      description: "Choose which built-in capabilities the Chat Agent can use.",
      search: "Search skills",
    },
    integrations: {
      title: "Integrations",
      description:
        "Connect your accounts, private data and publishing destinations.",
      search: "Search integrations",
    },
  }[extensionView];

  useEffect(() => {
    if (activeTab !== "plugins") return;
    if (
      activeSection === SECTION_IDS.integrations ||
      activeSection === SECTION_IDS.connections
    ) {
      setExtensionView("integrations");
    } else if (activeSection === SECTION_IDS.systemAccess) {
      setExtensionView("skills");
    }
  }, [activeSection, activeTab]);

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
      {/* The rail sticks, so it needs a ceiling and a scrollbar of its own.
          Sticky without a bounded height means a rail taller than the viewport
          pins its top and carries its lower tabs off the bottom of the screen,
          where they cannot be reached at all. `overscroll-contain` stops a
          flick inside the rail from continuing into the page behind it. */}
      {/* Hidden when System renders its own secondary navigation, so the two
          rails do not stack. The tabs themselves are untouched: the active one
          still comes from the same atom. */}
      <TabsList
        hidden={hideTabList}
        className="grid h-auto w-full shrink-0 grid-cols-2 gap-2 rounded-none border-0 bg-transparent p-0 sm:grid-cols-3 lg:sticky lg:top-6 lg:flex lg:max-h-[calc(100vh-7rem)] lg:w-64 lg:flex-col lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
        style={hideTabList ? { display: "none" } : undefined}
      >
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
      {/* min-w-0 so a wide child (a table, a long token) cannot stretch this
          column and push the rail out of the viewport. */}
      <div className="min-w-0 flex-1 pb-16">
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
            className={`${settingsCardClass} overflow-hidden !p-0`}
          >
            <Tabs
              value={extensionView}
              onValueChange={(value) => {
                if (
                  value === "plugins" ||
                  value === "skills" ||
                  value === "integrations"
                ) {
                  setExtensionView(value);
                  setExtensionQuery("");
                }
              }}
              className="gap-0"
            >
              <div className="flex justify-center border-b border-border/60 bg-muted/20 px-5 py-4">
                <TabsList className="h-10 rounded-full border border-border/70 bg-muted/70 p-1 shadow-inner">
                  <TabsTrigger
                    value="plugins"
                    className="min-w-28 rounded-full px-5 data-active:bg-background data-active:shadow-sm"
                  >
                    Plugins
                  </TabsTrigger>
                  <TabsTrigger
                    value="skills"
                    className="min-w-28 rounded-full px-5 data-active:bg-background data-active:shadow-sm"
                  >
                    Skills
                  </TabsTrigger>
                  <TabsTrigger
                    value="integrations"
                    className="min-w-28 rounded-full px-5 data-active:bg-background data-active:shadow-sm"
                  >
                    Integrations
                  </TabsTrigger>
                </TabsList>
              </div>

              <div className="p-5 sm:p-7">
                <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="font-jarvis-display text-2xl font-semibold tracking-tight text-foreground">
                      {extensionViewCopy.title}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {extensionViewCopy.description}
                    </p>
                  </div>
                  <div className="relative w-full sm:w-72">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="search"
                      value={extensionQuery}
                      onChange={(event) =>
                        setExtensionQuery(event.currentTarget.value)
                      }
                      placeholder={extensionViewCopy.search}
                      aria-label={extensionViewCopy.search}
                      className="h-10 rounded-full border-border/80 bg-muted/45 pr-4 pl-9 shadow-none"
                    />
                  </div>
                </div>

                <TabsContent
                  value="plugins"
                  className="mt-0 space-y-8 focus-visible:outline-none"
                >
                  <section aria-labelledby="built-in-plugins-title">
                    <h3
                      id="built-in-plugins-title"
                      className="mb-3 text-sm font-semibold text-foreground"
                    >
                      Built in
                    </h3>
                    <div className="flex flex-wrap gap-2.5">
                      {builtInPlugins.map((plugin) => {
                        const Icon = pluginIcons[plugin.id];
                        return (
                          <button
                            key={plugin.id}
                            type="button"
                            title={plugin.title}
                            aria-label={`Find ${plugin.title}`}
                            onClick={() => setExtensionQuery(plugin.title)}
                            className="group grid size-11 place-items-center rounded-xl border border-border/70 bg-muted/55 text-muted-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 hover:text-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Icon className="size-5 transition-transform group-hover:scale-105" />
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <div className="space-y-8">
                    {filteredPluginCategories.map((category) => (
                      <PluginCategorySection
                        key={category.id}
                        category={category}
                      >
                        {category.plugins.map((plugin) => (
                          <IntegrationRow
                            key={plugin.id}
                            value={plugin.id}
                            title={plugin.title}
                            description={plugin.description}
                            icon={pluginIcons[plugin.id]}
                          >
                            <PluginSettingsBody id={plugin.id} />
                          </IntegrationRow>
                        ))}
                      </PluginCategorySection>
                    ))}
                    {filteredPluginCategories.length === 0 && (
                      <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-border bg-muted/20 px-6 text-center">
                        <div>
                          <SearchX className="mx-auto size-6 text-muted-foreground" />
                          <p className="mt-3 text-sm font-medium text-foreground">
                            No plugins found
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Try a provider name or capability.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent
                  value="skills"
                  className="mt-0 focus-visible:outline-none"
                >
                  <ChatAgentSystemAccessSettings
                    embedded
                    searchQuery={extensionQuery}
                  />
                </TabsContent>

                <TabsContent
                  value="integrations"
                  className="mt-0 space-y-8 focus-visible:outline-none"
                >
                  <section
                    id={SECTION_IDS.integrations}
                    aria-labelledby="available-integrations-title"
                  >
                    <h3
                      id="available-integrations-title"
                      className="mb-3 text-sm font-semibold text-foreground"
                    >
                      Built in
                    </h3>
                    <div className="flex flex-wrap gap-2.5">
                      {INTEGRATIONS.map((integration) => {
                        const Icon = integrationIcons[integration.id];
                        return (
                          <button
                            key={integration.id}
                            type="button"
                            title={integration.title}
                            aria-label={`Find ${integration.title}`}
                            onClick={() => setExtensionQuery(integration.title)}
                            className="group grid size-11 place-items-center rounded-xl border border-border/70 bg-muted/55 text-muted-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 hover:text-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Icon className="size-5 transition-transform group-hover:scale-105" />
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  {filteredIntegrations.length > 0 ? (
                    <section aria-labelledby="integration-directory-title">
                      <div className="mb-3 flex items-center gap-3 px-1">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                          <UserRoundCheck className="size-4" />
                        </span>
                        <div>
                          <h3
                            id="integration-directory-title"
                            className="text-sm font-semibold text-foreground"
                          >
                            Your services
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            Accounts and data you explicitly authorize.
                          </p>
                        </div>
                        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {filteredIntegrations.length}
                        </span>
                      </div>
                      <Accordion className="grid gap-2.5 md:grid-cols-2">
                        {filteredIntegrations.map((integration) => (
                          <IntegrationRow
                            key={integration.id}
                            value={integration.id}
                            title={integration.title}
                            description={integration.description}
                            icon={integrationIcons[integration.id]}
                          >
                            <IntegrationSettingsBody id={integration.id} />
                          </IntegrationRow>
                        ))}
                      </Accordion>
                    </section>
                  ) : (
                    <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-border bg-muted/20 px-6 text-center">
                      <div>
                        <SearchX className="mx-auto size-6 text-muted-foreground" />
                        <p className="mt-3 text-sm font-medium text-foreground">
                          No integrations found
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Try Supabase, Facebook or X.
                        </p>
                      </div>
                    </div>
                  )}
                </TabsContent>
              </div>
            </Tabs>
          </div>
          <SettingsTabSaveBar tabId="plugins" />
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
          {/* No card wrapper here: this tab is a chooser whose own two cards
              are the surface. Wrapping them in a third drew a border around a
              border. */}
          <div id={SECTION_IDS.toolsMcp}>
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
