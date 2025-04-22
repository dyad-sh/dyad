import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SupabaseSchema } from "@/lib/schemas";
import { IpcClient } from "@/ipc/ipc_client";
import { toast } from "sonner";
import { useSettings } from "@/hooks/useSettings";
import { useSupabase } from "@/hooks/useSupabase";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLoadApp } from "@/hooks/useLoadApp";
const OAUTH_CLIENT_ID = "bf747de7-60bb-48a2-9015-6494e0b04983";

export function SupabaseConnector({ appId }: { appId: number }) {
  const [isConnecting, setIsConnecting] = useState(false);
  const { settings } = useSettings();
  const { app, refreshApp } = useLoadApp(appId);
  const {
    projects,
    loading,
    error,
    loadProjects,
    setAppProject,
    unsetAppProject,
  } = useSupabase();
  const currentProjectId = app?.supabaseProjectId;

  useEffect(() => {
    // Load projects when the component mounts and user is connected
    if (settings?.supabase?.accessToken) {
      loadProjects();
    }
  }, [settings?.supabase?.accessToken, loadProjects]);

  const handleConnect = async () => {
    try {
      setIsConnecting(true);

      // TODO: replace this with deployed URL
      const result = await IpcClient.getInstance().openExternalUrl(
        "http://localhost:30123/connect-supabase/login"
      );
      if (!result.success) {
        throw new Error(result.error || "Failed to open auth URL");
      }

      toast.success("Successfully connected to Supabase");
    } catch (error) {
      console.error("Failed to connect to Supabase:", error);
      toast.error("Failed to connect to Supabase");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleProjectSelect = async (projectId: string) => {
    try {
      await setAppProject(projectId, appId);
      toast.success("Project connected to app successfully");
      await refreshApp();
    } catch (error) {
      toast.error("Failed to connect project to app");
    }
  };

  const handleUnsetProject = async () => {
    try {
      await unsetAppProject(appId);
      toast.success("Project disconnected from app successfully");
      await refreshApp();
    } catch (error) {
      console.error("Failed to disconnect project:", error);
      toast.error("Failed to disconnect project from app");
    }
  };

  if (settings?.supabase?.accessToken) {
    if (app?.supabaseProjectName) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Supabase Project</CardTitle>
            <CardDescription>
              This app is connected to project: {app.supabaseProjectName}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={handleUnsetProject}>
              Disconnect Project
            </Button>
          </CardContent>
        </Card>
      );
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>Supabase Projects</CardTitle>
          <CardDescription>
            Select a Supabase project to connect to this app
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : error ? (
            <div className="text-red-500">
              Error loading projects: {error.message}
              <Button
                variant="outline"
                className="mt-2"
                onClick={() => loadProjects()}
              >
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {projects.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No projects found in your Supabase account.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="project-select">Project</Label>
                    <Select
                      value={currentProjectId || ""}
                      onValueChange={handleProjectSelect}
                    >
                      <SelectTrigger id="project-select">
                        <SelectValue placeholder="Select a project" />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name || project.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {currentProjectId && (
                    <div className="text-sm text-gray-500">
                      This app is connected to project:{" "}
                      {projects.find((p) => p.id === currentProjectId)?.name ||
                        currentProjectId}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col space-y-4 p-4 border rounded-md">
      <h2 className="text-lg font-semibold">Connect to Supabase</h2>

      <Button
        onClick={handleConnect}
        disabled={isConnecting}
        className="w-full"
      >
        {isConnecting ? "Connecting..." : "Connect to Supabase"}
      </Button>
    </div>
  );
}
