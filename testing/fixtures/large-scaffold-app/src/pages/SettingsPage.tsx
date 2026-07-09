import { SettingsAccess } from "@/components/settings/SettingsAccess";
import { SettingsAudit } from "@/components/settings/SettingsAudit";
import { SettingsBilling } from "@/components/settings/SettingsBilling";
import { SettingsDanger } from "@/components/settings/SettingsDanger";
import { SettingsDeployments } from "@/components/settings/SettingsDeployments";
import { SettingsNotifications } from "@/components/settings/SettingsNotifications";
import { SettingsRegions } from "@/components/settings/SettingsRegions";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { PageHeader } from "@/components/layout/PageHeader";
import { useSettings } from "@/hooks/useOpsQueries";

export default function SettingsPage() {
  const settings = useSettings();
  const item = settings.data ? [{ id: "settings", name: settings.data.workspaceName, status: settings.data.deploymentFreeze ? "frozen" : "active" }] : [];
  return (
    <>
      <PageHeader title="Settings" description="Static workspace settings for the large scaffold fixture." />
      <section className="grid gap-4 lg:grid-cols-2">
        <SettingsWorkspace items={item} />
        <SettingsAccess items={item} />
        <SettingsNotifications items={item} />
        <SettingsDeployments items={item} />
        <SettingsAudit items={item} />
        <SettingsRegions items={item} />
        <SettingsBilling items={item} />
        <SettingsDanger items={item} />
      </section>
    </>
  );
}
