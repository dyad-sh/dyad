import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IpcClient } from "@/ipc/ipc_client";
import { useMutation } from "@tanstack/react-query";
import { showError, showSuccess } from "@/lib/toast";
import { Folder, X, Loader2, Info } from "lucide-react";
import { Input } from "@/components/ui/input";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@radix-ui/react-label";
import { useNavigate } from "@tanstack/react-router";
import { useStreamChat } from "@/hooks/useStreamChat";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useSetAtom } from "jotai";
import { useLoadApps } from "@/hooks/useLoadApps";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";

interface ImportAppDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ImportAppDialog({ isOpen, onClose }: ImportAppDialogProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [hasAiRules, setHasAiRules] = useState<boolean | null>(null);
  const [customAppName, setCustomAppName] = useState<string>("");
  const [nameExists, setNameExists] = useState<boolean>(false);
  const [isCheckingName, setIsCheckingName] = useState<boolean>(false);
  const [installCommand, setInstallCommand] = useState("pnpm install");
  const [startCommand, setStartCommand] = useState("pnpm dev");
  const navigate = useNavigate();
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const { refreshApps } = useLoadApps();
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);

  const checkAppName = async (name: string): Promise<void> => {
    setIsCheckingName(true);
    try {
      const result = await IpcClient.getInstance().checkAppName({
        appName: name,
      });
      setNameExists(result.exists);
    } catch (error: unknown) {
      showError("Failed to check app name: " + (error as any).toString());
    } finally {
      setIsCheckingName(false);
    }
  };

  const selectFolderMutation = useMutation({
    mutationFn: async () => {
      const result = await IpcClient.getInstance().selectAppFolder();
      if (!result.path || !result.name) {
        throw new Error("No folder selected");
      }
      const aiRulesCheck = await IpcClient.getInstance().checkAiRules({
        path: result.path,
      });
      setHasAiRules(aiRulesCheck.exists);
      setSelectedPath(result.path);

      // Use the folder name from the IPC response
      setCustomAppName(result.name);

      // Check if the app name already exists
      await checkAppName(result.name);

      return result;
    },
    onError: (error: Error) => {
      showError(error.message);
    },
  });

  const importAppMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPath) throw new Error("No folder selected");
      return IpcClient.getInstance().importApp({
        path: selectedPath,
        appName: customAppName,
        installCommand: installCommand || undefined,
        startCommand: startCommand || undefined,
      });
    },
    onSuccess: async (result) => {
      showSuccess(
        !hasAiRules
          ? "App imported successfully. Dyad will automatically generate an AI_RULES.md now."
          : "App imported successfully",
      );
      onClose();

      navigate({ to: "/chat", search: { id: result.chatId } });
      if (!hasAiRules) {
        streamMessage({
          prompt:
            "Generate an AI_RULES.md file for this app. Describe the tech stack in 5-10 bullet points and describe clear rules about what libraries to use for what.",
          chatId: result.chatId,
        });
      }
      setSelectedAppId(result.appId);
      await refreshApps();
    },
    onError: (error: Error) => {
      showError(error.message);
    },
  });

  const handleSelectFolder = () => {
    selectFolderMutation.mutate();
  };

  const handleImport = () => {
    importAppMutation.mutate();
  };

  const handleClear = () => {
    setSelectedPath(null);
    setHasAiRules(null);
    setCustomAppName("");
    setNameExists(false);
    setInstallCommand("pnpm install");
    setStartCommand("pnpm dev");
  };

  const handleAppNameChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const newName = e.target.value;
    setCustomAppName(newName);
    if (newName.trim()) {
      await checkAppName(newName);
    }
  };

  const hasInstallCommand = installCommand.trim().length > 0;
  const hasStartCommand = startCommand.trim().length > 0;
  const commandsValid = hasInstallCommand === hasStartCommand;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import App</DialogTitle>
          <DialogDescription>
            Select an existing app folder to import into Dyad.
          </DialogDescription>
        </DialogHeader>

        <Alert className="border-blue-500/20 text-blue-500">
          <Info className="h-4 w-4" />
          <AlertDescription>
            App import is an experimental feature. If you encounter any issues,
            please report them using the Help button.
          </AlertDescription>
        </Alert>

        <div className="py-4">
          {!selectedPath ? (
            <Button
              onClick={handleSelectFolder}
              disabled={selectFolderMutation.isPending}
              className="w-full"
            >
              {selectFolderMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Folder className="mr-2 h-4 w-4" />
              )}
              {selectFolderMutation.isPending
                ? "Selecting folder..."
                : "Select Folder"}
            </Button>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Selected folder:</p>
                    <p className="text-sm text-muted-foreground break-all">
                      {selectedPath}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClear}
                    className="h-8 w-8 p-0 flex-shrink-0"
                    disabled={importAppMutation.isPending}
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Clear selection</span>
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {nameExists && (
                  <p className="text-sm text-yellow-500">
                    An app with this name already exists. Please choose a
                    different name:
                  </p>
                )}
                <div className="relative">
                  <Label className="text-sm ml-2 mb-2">App name</Label>
                  <Input
                    value={customAppName}
                    onChange={handleAppNameChange}
                    placeholder="Enter new app name"
                    className="w-full pr-8"
                    disabled={importAppMutation.isPending}
                  />
                  {isCheckingName && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>

              <Accordion type="single" collapsible>
                <AccordionItem value="advanced-options">
                  <AccordionTrigger className="text-sm hover:no-underline">
                    Advanced options
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4">
                    <div className="grid gap-2">
                      <Label className="text-sm ml-2 mb-2">
                        Install command
                      </Label>
                      <Input
                        value={installCommand}
                        onChange={(e) => setInstallCommand(e.target.value)}
                        placeholder="pnpm install"
                        disabled={importAppMutation.isPending}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-sm ml-2 mb-2">Start command</Label>
                      <Input
                        value={startCommand}
                        onChange={(e) => setStartCommand(e.target.value)}
                        placeholder="pnpm dev"
                        disabled={importAppMutation.isPending}
                      />
                    </div>
                    {!commandsValid && (
                      <p className="text-sm text-red-500">
                        Both commands are required when customizing.
                      </p>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              {hasAiRules === false && (
                <Alert className="border-yellow-500/20 text-yellow-500 flex items-start gap-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 flex-shrink-0 mt-1" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          AI_RULES.md lets Dyad know which tech stack to use for
                          editing the app
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <AlertDescription>
                    No AI_RULES.md found. Dyad will automatically generate one
                    after importing.
                  </AlertDescription>
                </Alert>
              )}

              {importAppMutation.isPending && (
                <div className="flex items-center justify-center space-x-2 text-sm text-muted-foreground animate-pulse">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Importing app...</span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={importAppMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={
              !selectedPath ||
              importAppMutation.isPending ||
              nameExists ||
              !commandsValid
            }
            className="min-w-[80px]"
          >
            {importAppMutation.isPending ? <>Importing...</> : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
