import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
// We might need a Supabase icon here, but for now, let's use a generic one or text.
// import { Supabase } from "lucide-react"; // Placeholder
import { DatabaseZap, Trash2 } from "lucide-react"; // Using DatabaseZap as a placeholder
import { useSettings } from "@/hooks/useSettings";
import { useSupabase } from "@/hooks/useSupabase";
import { showSuccess, showError } from "@/lib/toast";

export function SupabaseIntegration() {
  const { settings, updateSettings } = useSettings();
  const { organizations, loadOrganizations, deleteOrganization } =
    useSupabase();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  useEffect(() => {
    loadOrganizations();
  }, [loadOrganizations]);

  const handleDisconnectAllFromSupabase = async () => {
    setIsDisconnecting(true);
    try {
      // Clear the entire supabase object in settings (including all organizations)
      const result = await updateSettings({
        supabase: undefined,
        // Also disable the migration setting on disconnect
        enableSupabaseWriteSqlMigration: false,
      });
      if (result) {
        showSuccess("Successfully disconnected all Supabase organizations");
        await loadOrganizations();
      } else {
        showError("Failed to disconnect from Supabase");
      }
    } catch (err: any) {
      showError(
        err.message || "An error occurred while disconnecting from Supabase",
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleDeleteOrganization = async (organizationId: string) => {
    try {
      await deleteOrganization({ organizationId });
      showSuccess("Organization disconnected successfully");
    } catch (err: any) {
      showError(err.message || "Failed to disconnect organization");
    }
  };

  const handleMigrationSettingChange = async (enabled: boolean) => {
    try {
      await updateSettings({
        enableSupabaseWriteSqlMigration: enabled,
      });
      showSuccess("Setting updated");
    } catch (err: any) {
      showError(err.message || "Failed to update setting");
    }
  };

  // Check if there are any connected organizations
  const hasConnectedOrganizations = organizations.length > 0;

  if (!hasConnectedOrganizations) {
    return null;
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Supabase Integration
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {organizations.length} organization
            {organizations.length !== 1 ? "s" : ""} connected to Supabase.
          </p>
        </div>
        <Button
          onClick={handleDisconnectAllFromSupabase}
          variant="destructive"
          size="sm"
          disabled={isDisconnecting}
          className="flex items-center gap-2"
        >
          {isDisconnecting ? "Disconnecting..." : "Disconnect All"}
          <DatabaseZap className="h-4 w-4" />
        </Button>
      </div>

      {/* Connected organizations list */}
      <div className="mt-3 space-y-1">
        {organizations.map((org) => (
          <div
            key={org.organizationId}
            className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm gap-2"
          >
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-gray-700 dark:text-gray-300 font-medium truncate">
                {org.name || `Organization ${org.organizationId.slice(0, 8)}`}
              </span>
              {org.ownerEmail && (
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {org.ownerEmail}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground hover:text-destructive shrink-0"
              onClick={() => handleDeleteOrganization(org.organizationId)}
              title="Disconnect organization"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              <span className="text-xs">Disconnect</span>
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <div className="flex items-center space-x-3">
          <Switch
            id="supabase-migrations"
            checked={!!settings?.enableSupabaseWriteSqlMigration}
            onCheckedChange={handleMigrationSettingChange}
          />
          <div className="space-y-1">
            <Label
              htmlFor="supabase-migrations"
              className="text-sm font-medium"
            >
              Write SQL migration files
            </Label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Generate SQL migration files when modifying your Supabase schema.
              This helps you track database changes in version control, though
              these files aren't used for chat context, which uses the live
              schema.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
