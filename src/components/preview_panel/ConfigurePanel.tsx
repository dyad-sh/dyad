import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Trash2,
  Edit2,
  Plus,
  Save,
  X,
  HelpCircle,
  ArrowRight,
  Terminal,
} from "lucide-react";
import { showError, showSuccess } from "@/lib/toast";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { ipc } from "@/ipc/types";
import { useNavigate } from "@tanstack/react-router";
import { NeonConfigure } from "./NeonConfigure";
import { queryKeys } from "@/lib/queryKeys";

const AppCommandsTitle = () => (
  <div className="flex items-center gap-2">
    <Terminal size={18} className="text-muted-foreground" />
    <span className="text-lg font-semibold">App Commands</span>
    <Tooltip>
      <TooltipTrigger>
        <HelpCircle size={16} className="text-muted-foreground cursor-help" />
      </TooltipTrigger>
      <TooltipContent>
        <p>
          Configure custom install and start commands for your app.
          <br />
          Leave empty to use the default pnpm commands.
        </p>
      </TooltipContent>
    </Tooltip>
  </div>
);

const AppCommandsSection = ({
  selectedAppId,
}: {
  selectedAppId: number | null;
}) => {
  const queryClient = useQueryClient();
  const [installCommand, setInstallCommand] = useState("");
  const [startCommand, setStartCommand] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  // Query to get app details including commands
  const { data: app, isLoading: isLoadingApp } = useQuery({
    queryKey: queryKeys.apps.detail({ appId: selectedAppId }),
    queryFn: async () => {
      if (!selectedAppId) return null;
      return await ipc.app.getApp(selectedAppId);
    },
    enabled: !!selectedAppId,
  });

  // Sync local state with app data when it changes (but not during editing)
  useEffect(() => {
    if (app && !isEditing) {
      setInstallCommand(app.installCommand || "");
      setStartCommand(app.startCommand || "");
    }
  }, [app, isEditing]);

  // Mutation to update commands
  const updateCommandsMutation = useMutation({
    mutationFn: async ({
      installCmd,
      startCmd,
    }: {
      installCmd: string;
      startCmd: string;
    }) => {
      if (!selectedAppId) throw new Error("No app selected");
      return await ipc.app.updateAppCommands({
        appId: selectedAppId,
        installCommand: installCmd.trim() || null,
        startCommand: startCmd.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.apps.detail({ appId: selectedAppId }),
      });
      showSuccess("App commands saved");
      setIsEditing(false);
    },
    onError: (error) => {
      showError(`Failed to save app commands: ${error}`);
    },
  });

  const handleSave = useCallback(() => {
    updateCommandsMutation.mutate({
      installCmd: installCommand,
      startCmd: startCommand,
    });
  }, [installCommand, startCommand, updateCommandsMutation]);

  const handleCancel = useCallback(() => {
    // Reset to original values
    setInstallCommand(app?.installCommand || "");
    setStartCommand(app?.startCommand || "");
    setIsEditing(false);
  }, [app]);

  const handleClear = useCallback(() => {
    updateCommandsMutation.mutate({
      installCmd: "",
      startCmd: "",
    });
  }, [updateCommandsMutation]);

  if (!selectedAppId) {
    return null;
  }

  if (isLoadingApp) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <AppCommandsTitle />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <div className="text-sm text-muted-foreground">
              Loading app commands...
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasCustomCommands = app?.installCommand && app?.startCommand;
  const hasInstallCommand = installCommand.trim().length > 0;
  const hasStartCommand = startCommand.trim().length > 0;
  const commandsValid = hasInstallCommand === hasStartCommand;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <AppCommandsTitle />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEditing ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="install-command">Install Command</Label>
              <Input
                id="install-command"
                data-testid="install-command-input"
                placeholder="pnpm install"
                value={installCommand}
                onChange={(e) => setInstallCommand(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="start-command">Start Command</Label>
              <Input
                id="start-command"
                data-testid="start-command-input"
                placeholder="pnpm dev"
                value={startCommand}
                onChange={(e) => setStartCommand(e.target.value)}
              />
            </div>
            {!commandsValid && (
              <p className="text-sm text-red-500">
                Both commands are required when customizing.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                data-testid="save-app-commands"
                onClick={handleSave}
                size="sm"
                disabled={updateCommandsMutation.isPending || !commandsValid}
              >
                <Save size={14} />
                {updateCommandsMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button
                data-testid="cancel-edit-app-commands"
                onClick={handleCancel}
                variant="outline"
                size="sm"
              >
                <X size={14} />
                Cancel
              </Button>
            </div>
          </div>
        ) : hasCustomCommands ? (
          <div className="space-y-3">
            <div className="p-3 border rounded-md bg-muted/30">
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-muted-foreground">
                    Install Command
                  </span>
                  <p
                    data-testid="current-install-command"
                    className="font-mono text-sm truncate"
                  >
                    {app.installCommand}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">
                    Start Command
                  </span>
                  <p
                    data-testid="current-start-command"
                    className="font-mono text-sm truncate"
                  >
                    {app.startCommand}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                data-testid="edit-app-commands"
                onClick={() => setIsEditing(true)}
                variant="outline"
                size="sm"
              >
                <Edit2 size={14} />
                Edit
              </Button>
              <Button
                data-testid="clear-app-commands"
                onClick={handleClear}
                variant="outline"
                size="sm"
                disabled={updateCommandsMutation.isPending}
              >
                <Trash2 size={14} />
                Clear
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Using default install and start commands
            </p>
            <Button
              data-testid="configure-app-commands"
              onClick={() => setIsEditing(true)}
              variant="outline"
              className="w-full"
            >
              <Plus size={14} />
              Configure Custom Commands
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const EnvironmentVariablesTitle = () => (
  <div className="flex items-center gap-2">
    <span className="text-lg font-semibold">Environment Variables</span>
    <span className="text-sm text-muted-foreground font-normal">Local</span>
    <Tooltip>
      <TooltipTrigger>
        <HelpCircle size={16} className="text-muted-foreground cursor-help" />
      </TooltipTrigger>
      <TooltipContent>
        <p>
          To modify environment variables for Supabase or production,
          <br />
          access your hosting provider's console and update them there.
        </p>
      </TooltipContent>
    </Tooltip>
  </div>
);

export const ConfigurePanel = () => {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const queryClient = useQueryClient();

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingKeyValue, setEditingKeyValue] = useState("");
  const [editingValue, setEditingValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [isAddingNew, setIsAddingNew] = useState(false);
  const navigate = useNavigate();

  // Query to get environment variables
  const {
    data: envVars = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.appEnvVars.byApp({ appId: selectedAppId }),
    queryFn: async () => {
      if (!selectedAppId) return [];
      return await ipc.misc.getAppEnvVars({ appId: selectedAppId });
    },
    enabled: !!selectedAppId,
  });

  // Mutation to save environment variables
  const saveEnvVarsMutation = useMutation({
    mutationFn: async (newEnvVars: { key: string; value: string }[]) => {
      if (!selectedAppId) throw new Error("No app selected");
      return await ipc.misc.setAppEnvVars({
        appId: selectedAppId,
        envVars: newEnvVars,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.appEnvVars.byApp({ appId: selectedAppId }),
      });
      showSuccess("Environment variables saved");
    },
    onError: (error) => {
      showError(`Failed to save environment variables: ${error}`);
    },
  });

  const handleAdd = useCallback(() => {
    if (!newKey.trim() || !newValue.trim()) {
      showError("Both key and value are required");
      return;
    }

    // Check for duplicate keys
    if (envVars.some((envVar) => envVar.key === newKey.trim())) {
      showError("Environment variable with this key already exists");
      return;
    }

    const newEnvVars = [
      ...envVars,
      { key: newKey.trim(), value: newValue.trim() },
    ];
    saveEnvVarsMutation.mutate(newEnvVars);
    setNewKey("");
    setNewValue("");
    setIsAddingNew(false);
  }, [newKey, newValue, envVars, saveEnvVarsMutation]);

  const handleEdit = useCallback((envVar: { key: string; value: string }) => {
    setEditingKey(envVar.key);
    setEditingKeyValue(envVar.key);
    setEditingValue(envVar.value);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingKeyValue.trim() || !editingValue.trim()) {
      showError("Both key and value are required");
      return;
    }

    // Check for duplicate keys (excluding the current one being edited)
    if (
      envVars.some(
        (envVar) =>
          envVar.key === editingKeyValue.trim() && envVar.key !== editingKey,
      )
    ) {
      showError("Environment variable with this key already exists");
      return;
    }

    const newEnvVars = envVars.map((envVar) =>
      envVar.key === editingKey
        ? { key: editingKeyValue.trim(), value: editingValue.trim() }
        : envVar,
    );
    saveEnvVarsMutation.mutate(newEnvVars);
    setEditingKey(null);
    setEditingKeyValue("");
    setEditingValue("");
  }, [editingKey, editingKeyValue, editingValue, envVars, saveEnvVarsMutation]);

  const handleCancelEdit = useCallback(() => {
    setEditingKey(null);
    setEditingKeyValue("");
    setEditingValue("");
  }, []);

  const handleDelete = useCallback(
    (key: string) => {
      const newEnvVars = envVars.filter((envVar) => envVar.key !== key);
      saveEnvVarsMutation.mutate(newEnvVars);
    },
    [envVars, saveEnvVarsMutation],
  );

  const handleCancelAdd = useCallback(() => {
    setIsAddingNew(false);
    setNewKey("");
    setNewValue("");
  }, []);

  // Show loading state
  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>
              <EnvironmentVariablesTitle />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8">
              <div className="text-sm text-muted-foreground">
                Loading environment variables...
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="p-4 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>
              <EnvironmentVariablesTitle />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8">
              <div className="text-sm text-red-500">
                Error loading environment variables: {error.message}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show no app selected state
  if (!selectedAppId) {
    return (
      <div className="p-4 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>
              <EnvironmentVariablesTitle />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8">
              <div className="text-sm text-muted-foreground">
                Select an app to manage environment variables
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <EnvironmentVariablesTitle />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add new environment variable form */}
          {isAddingNew ? (
            <div className="space-y-3 p-3 border rounded-md bg-muted/50">
              <div className="space-y-2">
                <Label htmlFor="new-key">Key</Label>
                <Input
                  id="new-key"
                  placeholder="e.g., API_URL"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-value">Value</Label>
                <Input
                  id="new-value"
                  placeholder="e.g., https://api.example.com"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleAdd}
                  size="sm"
                  disabled={saveEnvVarsMutation.isPending}
                >
                  <Save size={14} />
                  {saveEnvVarsMutation.isPending ? "Saving..." : "Save"}
                </Button>
                <Button onClick={handleCancelAdd} variant="outline" size="sm">
                  <X size={14} />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              onClick={() => setIsAddingNew(true)}
              variant="outline"
              className="w-full"
            >
              <Plus size={14} />
              Add Environment Variable
            </Button>
          )}

          {/* List of existing environment variables */}
          <div className="space-y-2">
            {envVars.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No environment variables configured
              </p>
            ) : (
              envVars.map((envVar) => (
                <div
                  key={envVar.key}
                  className="flex items-center space-x-2 p-2 border rounded-md"
                >
                  {editingKey === envVar.key ? (
                    <>
                      <div className="flex-1 space-y-2">
                        <Input
                          value={editingKeyValue}
                          onChange={(e) => setEditingKeyValue(e.target.value)}
                          placeholder="Key"
                          className="h-8"
                        />
                        <Input
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          placeholder="Value"
                          className="h-8"
                        />
                      </div>
                      <div className="flex gap-1">
                        <Button
                          data-testid={`save-edit-env-var`}
                          onClick={handleSaveEdit}
                          size="sm"
                          variant="outline"
                          disabled={saveEnvVarsMutation.isPending}
                        >
                          <Save size={14} />
                        </Button>
                        <Button
                          data-testid={`cancel-edit-env-var`}
                          onClick={handleCancelEdit}
                          size="sm"
                          variant="outline"
                        >
                          <X size={14} />
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {envVar.key}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {envVar.value}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          data-testid={`edit-env-var-${envVar.key}`}
                          onClick={() => handleEdit(envVar)}
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                        >
                          <Edit2 size={14} />
                        </Button>
                        <Button
                          data-testid={`delete-env-var-${envVar.key}`}
                          onClick={() => handleDelete(envVar.key)}
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          disabled={saveEnvVarsMutation.isPending}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          {/* More app configurations button */}
          <div className="pt-4 border-t">
            <Button
              variant="outline"
              className="w-full text-sm justify-between"
              onClick={() => {
                if (selectedAppId) {
                  navigate({
                    to: "/app-details",
                    search: { appId: selectedAppId },
                  });
                }
              }}
            >
              <span>More app settings</span>
              <ArrowRight size={16} />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* App Commands Configuration */}
      <AppCommandsSection selectedAppId={selectedAppId} />

      {/* Neon Database Configuration */}
      <div className="grid grid-cols-1 gap-6">
        <NeonConfigure />
      </div>
    </div>
  );
};
