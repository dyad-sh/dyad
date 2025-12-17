import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SimpleAvatar } from "@/components/ui/SimpleAvatar";
import { IpcClient } from "@/ipc/ipc_client";
import { Trash2, UserPlus, Users } from "lucide-react";
import { showSuccess, showError } from "@/lib/toast";

interface Collaborator {
  login: string;
  avatar_url: string;
  permissions: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

interface CollaboratorManagerProps {
  appId: number;
}

export function GithubCollaboratorManager({ appId }: CollaboratorManagerProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [isInviting, setIsInviting] = useState(false);

  const loadCollaborators = async () => {
    setIsLoading(true);
    try {
      const collabs = await IpcClient.getInstance().listCollaborators(appId);
      setCollaborators(collabs);
    } catch (error: any) {
      console.error("Failed to load collaborators:", error);
      showError("Failed to load collaborators: " + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCollaborators();
  }, [appId]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteUsername.trim()) return;

    setIsInviting(true);
    try {
      await IpcClient.getInstance().inviteCollaborator(appId, inviteUsername);
      showSuccess(`Invited ${inviteUsername} to the project.`);
      setInviteUsername("");
      // Reload list (though they might be pending)
      loadCollaborators();
    } catch (error: any) {
      showError(error.message);
    } finally {
      setIsInviting(false);
    }
  };

  const handleRemove = async (username: string) => {
    if (
      !confirm(`Are you sure you want to remove ${username} from this project?`)
    ) {
      return;
    }

    try {
      await IpcClient.getInstance().removeCollaborator(appId, username);
      showSuccess(`Removed ${username} from the project.`);
      loadCollaborators();
    } catch (error: any) {
      showError(error.message);
    }
  };

  return (
    <Card className="mt-2">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="w-5 h-5" />
          Collaborators
        </CardTitle>
        <CardDescription>
          Manage who has access to this project via GitHub.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Invite Form */}
        <form onSubmit={handleInvite} className="flex gap-2">
          <Input
            placeholder="GitHub username"
            value={inviteUsername}
            onChange={(e) => setInviteUsername(e.target.value)}
            disabled={isInviting}
            data-testid="collaborator-invite-input"
          />
          <Button
            type="submit"
            data-testid="collaborator-invite-button"
            disabled={isInviting || !inviteUsername}
          >
            {isInviting ? (
              "Inviting..."
            ) : (
              <>
                <UserPlus className="w-4 h-4 mr-2" />
                Invite
              </>
            )}
          </Button>
        </form>

        {/* Collaborators List */}
        <div className="space-y-2 mt-4">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Current Team
          </h3>
          {isLoading ? (
            <div className="text-sm text-center py-4 text-gray-500">
              Loading collaborators...
            </div>
          ) : collaborators.length === 0 ? (
            <div className="text-sm text-center py-4 text-gray-500 bg-gray-50 dark:bg-gray-800/50 rounded-md">
              No collaborators found.
            </div>
          ) : (
            <div className="space-y-2">
              {collaborators.map((collab) => (
                <div
                  key={collab.login}
                  className="flex items-center justify-between p-2 rounded-md border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900"
                >
                  <div className="flex items-center gap-3">
                    <SimpleAvatar
                      src={collab.avatar_url}
                      alt={collab.login}
                      fallbackText={collab.login.slice(0, 2).toUpperCase()}
                    />
                    <div>
                      <p className="text-sm font-medium">{collab.login}</p>
                      <p className="text-xs text-gray-500">
                        {collab.permissions.admin
                          ? "Admin"
                          : collab.permissions.push
                            ? "Editor"
                            : "Viewer"}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                    onClick={() => handleRemove(collab.login)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
