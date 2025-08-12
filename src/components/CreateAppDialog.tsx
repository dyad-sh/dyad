import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { NEON_TEMPLATE_IDS, Template } from "@/shared/templates";

import { useRouter } from "@tanstack/react-router";

import { Loader2 } from "lucide-react";
import { neonTemplateHook } from "@/client_logic/template_hook";
import { showError } from "@/lib/toast";
import { CreateAppParams } from "@/ipc/ipc_types";

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
  const [installCommand, setInstallCommand] = useState("pnpm install");
  const [startCommand, setStartCommand] = useState("pnpm dev");
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
      const params: CreateAppParams = { name: appName.trim() };
      if (hasInstall && hasStart) {
        params.installCommand = installCommand.trim();
        params.startCommand = startCommand.trim();
      }
      const result = await createApp(params);
      if (template && NEON_TEMPLATE_IDS.has(template.id)) {
        await neonTemplateHook({
          appId: result.app.id,
          appName: result.app.name,
        });
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
      showError(error as any);
      // Error is already handled by createApp hook or shown above
      console.error("Error creating app:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isNameValid = appName.trim().length > 0;
  const nameExists = nameCheckResult?.exists;
  const hasInstall = installCommand.trim().length > 0;
  const hasStart = startCommand.trim().length > 0;
  const commandsValid = (hasInstall && hasStart) || (!hasInstall && !hasStart);
  const commandsMismatch = hasInstall !== hasStart;
  const canSubmit =
    isNameValid && !nameExists && !isSubmitting && commandsValid;

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
            <Accordion type="single" collapsible>
              <AccordionItem value="advanced-options">
                <AccordionTrigger className="text-sm hover:no-underline">
                  Advanced options
                </AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label className="text-sm ml-2 mb-2">Install command</Label>
                    <Input
                      value={installCommand}
                      onChange={(e) => setInstallCommand(e.target.value)}
                      placeholder="pnpm install"
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-sm ml-2 mb-2">Start command</Label>
                    <Input
                      value={startCommand}
                      onChange={(e) => setStartCommand(e.target.value)}
                      placeholder="pnpm dev"
                      disabled={isSubmitting}
                    />
                  </div>
                  {commandsMismatch && (
                    <p className="text-sm text-red-500">
                      Both commands are required when customizing.
                    </p>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
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
