import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateApp } from "@/hooks/useCreateApp";
import { useCheckName } from "@/hooks/useCheckName";
import { useSetAtom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { Template } from "@/shared/templates";
import { IpcClient } from "@/ipc/ipc_client";
import { v4 as uuidv4 } from "uuid";
import { useRouter } from "@tanstack/react-router";
import { showError } from "@/lib/toast";
import { Loader2 } from "lucide-react";

interface CreateAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: Template | undefined;
}

export function CreateAppDialog({
  open,
  onOpenChange,
  template,
}: CreateAppDialogProps) {
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const [appName, setAppName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { createApp } = useCreateApp();
  const { data: nameCheckResult } = useCheckName(appName);
  const router = useRouter();
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!appName.trim()) {
      return;
    }

    if (nameCheckResult?.exists) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createApp({ name: appName.trim() });
      if (template?.requiresNeon) {
        try {
          console.log("Creating Neon project");
          const neonProject = await IpcClient.getInstance().createNeonProject({
            name: appName.trim(),
            appId: result.app.id,
          });

          console.log("Neon project created", neonProject);
          await IpcClient.getInstance().setAppEnvVars({
            appId: result.app.id,
            envVars: [
              {
                key: "POSTGRES_URL",
                value: neonProject.connectionString,
              },
              {
                key: "PAYLOAD_SECRET",
                value: uuidv4(),
              },
            ],
          });
          console.log("App env vars set");
        } catch (error) {
          showError(error as any);
          throw error;
        }
      }
      setSelectedAppId(result.app.id);
      // Navigate to the new app's first chat
      router.navigate({
        to: "/chat",
        search: { id: result.chatId },
      });
      setAppName("");
      onOpenChange(false);
    } catch (error) {
      // Error is already handled by createApp hook or shown above
      console.error("Error creating app:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isNameValid = appName.trim().length > 0;
  const nameExists = nameCheckResult?.exists;
  const canSubmit = isNameValid && !nameExists && !isSubmitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New App</DialogTitle>
          <DialogDescription>
            {`Create a new app using the ${template?.title} template.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="appName">App Name</Label>
              <Input
                id="appName"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="Enter app name..."
                className={nameExists ? "border-red-500" : ""}
                disabled={isSubmitting}
              />
              {nameExists && (
                <p className="text-sm text-red-500">
                  An app with this name already exists
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {isSubmitting ? "Creating..." : "Create App"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
