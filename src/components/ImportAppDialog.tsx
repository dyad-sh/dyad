import { useState, useEffect } from "react";
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
import type { GithubRepository } from "@/ipc/ipc_types";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettings } from "@/hooks/useSettings";
import { UnconnectedGitHubConnector } from "@/components/GitHubConnector";

interface ImportAppDialogProps {
  isOpen: boolean;
  onClose: () => void;
}
export const AI_RULES_PROMPT =
  "Generate an AI_RULES.md file for this app. Describe the tech stack in 5-10 bullet points and describe clear rules about what libraries to use for what.";
export function ImportAppDialog({ isOpen, onClose }: ImportAppDialogProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [hasAiRules, setHasAiRules] = useState<boolean | null>(null);
  const [customAppName, setCustomAppName] = useState<string>("");
  const [nameExists, setNameExists] = useState<boolean>(false);
  const [isCheckingName, setIsCheckingName] = useState<boolean>(false);
  const [installCommand, setInstallCommand] = useState("");
  const [startCommand, setStartCommand] = useState("");
  const navigate = useNavigate();
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const { refreshApps } = useLoadApps();
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  // GitHub import state
  const [repos, setRepos] = useState<GithubRepository[]>([]);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const { settings, refreshSettings } = useSettings();
  const isAuthenticated = !!settings?.githubAccessToken;

  const [githubAppName, setGithubAppName] = useState("");
  const [githubNameExists, setGithubNameExists] = useState(false);
  const [isCheckingGithubName, setIsCheckingGithubName] = useState(false);
  useEffect(() => {
    if (isOpen) {
      setGithubAppName("");
      setGithubNameExists(false);
      // Fetch GitHub repos if authenticated
      if (isAuthenticated) {
        fetchRepos();
      }
    }
  }, [isOpen, isAuthenticated]);

  const fetchRepos = async () => {
    setLoading(true);
    try {
      const fetchedRepos = await IpcClient.getInstance().listGithubRepos();
      setRepos(fetchedRepos);
    } catch (err: unknown) {
      showError("Failed to fetch repositories.: " + (err as any).toString());
    } finally {
      setLoading(false);
    }
  };
  const handleUrlBlur = async () => {
    if (!url.trim()) return;
    const repoName = extractRepoNameFromUrl(url);
    if (repoName) {
      setGithubAppName(repoName);
      setIsCheckingGithubName(true);
      try {
        const result = await IpcClient.getInstance().checkAppName({
          appName: repoName,
        });
        setGithubNameExists(result.exists);
      } catch (error: unknown) {
        showError("Failed to check app name: " + (error as any).toString());
      } finally {
        setIsCheckingGithubName(false);
      }
    }
  };
  const extractRepoNameFromUrl = (url: string): string | null => {
    const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
    return match ? match[2] : null;
  };
  const handleImportFromUrl = async () => {
    setImporting(true);
    try {
      const match = extractRepoNameFromUrl(url);
      const repoName = match ? match[2] : "";
      const appName = githubAppName.trim() || repoName;
      const result = await IpcClient.getInstance().cloneRepoFromUrl({
        url,
        installCommand: installCommand.trim() || undefined,
        startCommand: startCommand.trim() || undefined,
        appName,
      });
      if ("error" in result) {
        showError(result.error);
        setImporting(false);
        return;
      }
      setSelectedAppId(result.app.id);
      showSuccess(`Successfully imported ${result.app.name}`);
      const chatId = await IpcClient.getInstance().createChat(result.app.id);
      navigate({ to: "/chat", search: { id: chatId } });
      if (!result.hasAiRules) {
        streamMessage({
          prompt: AI_RULES_PROMPT,
          chatId,
        });
      }
      onClose();
    } catch (error: unknown) {
      showError("Failed to import repository: " + (error as any).toString());
    } finally {
      setImporting(false);
    }
  };

  const handleSelectRepo = async (repo: GithubRepository) => {
    setImporting(true);

    try {
      const appName = githubAppName.trim() || repo.name;
      const result = await IpcClient.getInstance().cloneRepoFromUrl({
        url: `https://github.com/${repo.full_name}.git`,
        installCommand: installCommand.trim() || undefined,
        startCommand: startCommand.trim() || undefined,
        appName,
      });
      if ("error" in result) {
        showError(result.error);
        setImporting(false);
        return;
      }
      setSelectedAppId(result.app.id);
      showSuccess(`Successfully imported ${result.app.name}`);
      const chatId = await IpcClient.getInstance().createChat(result.app.id);
      navigate({ to: "/chat", search: { id: chatId } });
      if (!result.hasAiRules) {
        streamMessage({
          prompt: AI_RULES_PROMPT,
          chatId,
        });
      }
      onClose();
    } catch (error: unknown) {
      showError("Failed to import repository: " + (error as any).toString());
    } finally {
      setImporting(false);
    }
  };

  const handleGithubAppNameChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const newName = e.target.value;
    setGithubAppName(newName);
    if (newName.trim()) {
      setIsCheckingGithubName(true);
      try {
        const result = await IpcClient.getInstance().checkAppName({
          appName: newName,
        });
        setGithubNameExists(result.exists);
      } catch (error: unknown) {
        showError("Failed to check app name: " + (error as any).toString());
      } finally {
        setIsCheckingGithubName(false);
      }
    }
  };

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
          prompt: AI_RULES_PROMPT,
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
    setInstallCommand("");
    setStartCommand("");
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
  // Add this component inside the ImportAppDialog.tsx file, before the main component
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[98vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import App</DialogTitle>
          <DialogDescription>
            Import existing app from local folder or clone from Github.
          </DialogDescription>
        </DialogHeader>

        <Alert className="border-blue-500/20 text-blue-500">
          <Info className="h-4 w-4" />
          <AlertDescription>
            App import is an experimental feature. If you encounter any issues,
            please report them using the Help button.
          </AlertDescription>
        </Alert>
        <Tabs defaultValue="local-folder" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="local-folder">Local Folder</TabsTrigger>
            <TabsTrigger value="github-repos">Your GitHub Repos</TabsTrigger>
            <TabsTrigger value="github-url">GitHub URL</TabsTrigger>
          </TabsList>
          <TabsContent value="local-folder" className="space-y-4">
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
                          <Label className="text-sm ml-2 mb-2">
                            Start command
                          </Label>
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
                              AI_RULES.md lets Dyad know which tech stack to use
                              for editing the app
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <AlertDescription>
                        No AI_RULES.md found. Dyad will automatically generate
                        one after importing.
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
          </TabsContent>
          <TabsContent value="github-repos" className="space-y-4">
            {!isAuthenticated ? (
              <UnconnectedGitHubConnector
                appId={null}
                folderName=""
                settings={settings}
                refreshSettings={refreshSettings}
                handleRepoSetupComplete={() => undefined}
                expanded={false}
              />
            ) : (
              <>
                {loading && (
                  <div className="flex justify-center py-8">
                    <Loader2 className="animate-spin h-6 w-6" />
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-sm ml-2 mb-2">
                    App name (optional)
                  </Label>
                  <Input
                    value={githubAppName}
                    onChange={handleGithubAppNameChange}
                    placeholder="Leave empty to use repository name"
                    className="w-full pr-8"
                    disabled={importing}
                  />
                  {isCheckingGithubName && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {githubNameExists && (
                    <p className="text-sm text-yellow-500">
                      An app with this name already exists. Please choose a
                      different name.
                    </p>
                  )}
                </div>

                <div className="flex flex-col space-y-2 max-h-64 overflow-y-auto">
                  {!loading && repos.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No repositories found
                    </p>
                  )}
                  {repos.map((repo) => (
                    <div
                      key={repo.full_name}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{repo.name}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {repo.full_name}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSelectRepo(repo)}
                        disabled={importing}
                        className="ml-2 flex-shrink-0"
                      >
                        {importing ? (
                          <Loader2 className="animate-spin h-4 w-4" />
                        ) : (
                          "Import"
                        )}
                      </Button>
                    </div>
                  ))}
                </div>

                {repos.length > 0 && (
                  <>
                    <Accordion type="single" collapsible>
                      <AccordionItem value="advanced-options">
                        <AccordionTrigger className="text-sm hover:no-underline">
                          Advanced options
                        </AccordionTrigger>
                        <AccordionContent className="space-y-4">
                          <div className="grid gap-2">
                            <Label className="text-sm">Install command</Label>
                            <Input
                              value={installCommand}
                              onChange={(e) =>
                                setInstallCommand(e.target.value)
                              }
                              placeholder="pnpm install"
                              disabled={importing}
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label className="text-sm">Start command</Label>
                            <Input
                              value={startCommand}
                              onChange={(e) => setStartCommand(e.target.value)}
                              placeholder="pnpm dev"
                              disabled={importing}
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
                  </>
                )}
              </>
            )}
          </TabsContent>
          <TabsContent value="github-url" className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">Repository URL</Label>
              <Input
                placeholder="https://github.com/user/repo.git"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={importing}
                onBlur={handleUrlBlur}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">App name (optional)</Label>
              <Input
                value={githubAppName}
                onChange={handleGithubAppNameChange}
                placeholder="Leave empty to use repository name"
                disabled={importing}
              />
              {isCheckingGithubName && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {githubNameExists && (
                <p className="text-sm text-yellow-500">
                  An app with this name already exists. Please choose a
                  different name.
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
                    <Label className="text-sm">Install command</Label>
                    <Input
                      value={installCommand}
                      onChange={(e) => setInstallCommand(e.target.value)}
                      placeholder="pnpm install"
                      disabled={importing}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-sm">Start command</Label>
                    <Input
                      value={startCommand}
                      onChange={(e) => setStartCommand(e.target.value)}
                      placeholder="pnpm dev"
                      disabled={importing}
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

            <Button
              onClick={handleImportFromUrl}
              disabled={importing || !url.trim() || !commandsValid}
              className="w-full"
            >
              {importing ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Importing...
                </>
              ) : (
                "Import"
              )}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
