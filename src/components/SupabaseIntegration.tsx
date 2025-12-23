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
  const { accounts, loadAccounts, deleteAccount } = useSupabase();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const handleDisconnectAllFromSupabase = async () => {
    setIsDisconnecting(true);
    try {
      // Clear the entire supabase object in settings (including all accounts)
      const result = await updateSettings({
        supabase: undefined,
        // Also disable the migration setting on disconnect
        enableSupabaseWriteSqlMigration: false,
      });
      if (result) {
        showSuccess("Successfully disconnected all Supabase accounts");
        await loadAccounts();
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

  const handleDeleteAccount = async (
    userId: string,
    organizationId: string,
  ) => {
    try {
      await deleteAccount({ userId, organizationId });
      showSuccess("Account disconnected successfully");
    } catch (err: any) {
      showError(err.message || "Failed to disconnect account");
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

  // Check if there are any connected accounts
  const hasConnectedAccounts = accounts.length > 0;

  if (!hasConnectedAccounts) {
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
            {accounts.length} account{accounts.length !== 1 ? "s" : ""}{" "}
            connected to Supabase.
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

      {/* Connected accounts list */}
      <div className="mt-3 space-y-1">
        {accounts.map((account) => (
          <div
            key={`${account.userId}:${account.organizationId}`}
            className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm"
          >
            <span className="text-gray-700 dark:text-gray-300">
              {account.organizationName ||
                account.userEmail ||
                `Account ${account.userId.slice(0, 8)}`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
              onClick={() =>
                handleDeleteAccount(account.userId, account.organizationId)
              }
            >
              <Trash2 className="h-3 w-3" />
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
