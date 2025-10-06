import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useEffect, useState } from "react";
import { Loader2, Info, Github } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { IpcClient } from "@/ipc/ipc_client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useStreamChat } from "@/hooks/useStreamChat";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useSetAtom } from "jotai";
import { useSettings } from "@/hooks/useSettings";
import { UnconnectedGitHubConnector } from "@/components/GitHubConnector";
import { AI_RULES_PROMPT } from "@/components/ImportAppDialog";

interface GithubRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GithubRepoModal({ isOpen, onClose }: GithubRepoModalProps) {
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [installCommand, setInstallCommand] = useState("pnpm install");
  const [startCommand, setStartCommand] = useState("pnpm dev");
  const navigate = useNavigate();
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const { settings, refreshSettings } = useSettings();

  const isAuthenticated = !!settings?.githubAccessToken;

  useEffect(() => {
    if (isOpen) {
      if (isAuthenticated) {
        fetchRepos();
      }
      // Reset state when modal opens
      setUrl("");
      setError(null);
      setInstallCommand("pnpm install");
      setStartCommand("pnpm dev");
    }
  }, [isOpen, isAuthenticated]);

  const fetchRepos = async () => {
    setLoading(true);
    setError(null);
    try {
      const fetchedRepos = await IpcClient.getInstance().listGithubRepos();
      setRepos(fetchedRepos);
    } catch (err: any) {
      setError(err.message || "Failed to fetch repositories.");
    } finally {
      setLoading(false);
    }
  };

  const checkAndGenerateAiRules = async (appId: number, appPath: string) => {
    try {
      const hasAiRules = await IpcClient.getInstance().checkAiRules({
        path: appPath,
      });

      if (!hasAiRules.exists) {
        const chatId = await IpcClient.getInstance().createChat(appId);
        navigate({ to: "/chat", search: { id: chatId } });
        streamMessage({
          prompt: AI_RULES_PROMPT,
          chatId,
        });
        return { chatId, generated: true };
      }

      return { generated: false };
    } catch (err: any) {
      setError(err.message || "Failed to check/generate AI_RULES:");
      return { generated: false };
    }
  };

  const handleImportFromUrl = async () => {
    setImporting(true);
    setError(null);
    try {
      const result = await IpcClient.getInstance().cloneRepoFromUrl({
        url,
        installCommand: installCommand.trim() || undefined,
        startCommand: startCommand.trim() || undefined,
      });

      if (result.success && result.app) {
        setSelectedAppId(result.app.id);
        onClose();
        await checkAndGenerateAiRules(result.app.id, result.app.path);
      } else {
        setError(result.error || "Failed to import repository.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to import repository.");
    } finally {
      setImporting(false);
    }
  };

  const handleSelectRepo = async (repo: any) => {
    setImporting(true);
    setError(null);
    try {
      const result = await IpcClient.getInstance().cloneRepoFromUrl({
        url: `https://github.com/${repo.full_name}.git`,
        installCommand: installCommand.trim() || undefined,
        startCommand: startCommand.trim() || undefined,
      });

      if (result.success && result.app) {
        setSelectedAppId(result.app.id);
        onClose();

        await checkAndGenerateAiRules(result.app.id, result.app.path);
      } else {
        setError(result.error || "Failed to import repository.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to import repository.");
    } finally {
      setImporting(false);
    }
  };

  const hasInstallCommand = installCommand.trim().length > 0;
  const hasStartCommand = startCommand.trim().length > 0;
  const commandsValid = hasInstallCommand === hasStartCommand;

  // Show GitHub connection UI if not authenticated
  if (!isAuthenticated) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Github className="w-5 h-5" /> Connect to GitHub
            </DialogTitle>
            <DialogDescription>
              Connect your GitHub account to import repositories into Dyad.
            </DialogDescription>
          </DialogHeader>
          <UnconnectedGitHubConnector
            appId={null}
            folderName=""
            settings={settings}
            refreshSettings={refreshSettings}
            handleRepoSetupComplete={() => undefined}
            expanded={false}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="w-5 h-5" /> Import from GitHub
          </DialogTitle>
          <DialogDescription>
            Clone a repository from GitHub to start working on it in Dyad.
          </DialogDescription>
        </DialogHeader>

        <Alert className="border-blue-500/20 text-blue-500">
          <Info className="h-4 w-4" />
          <AlertDescription>
            After cloning, Dyad will automatically generate an AI_RULES.md file
            if one doesn't exist.
          </AlertDescription>
        </Alert>

        <Tabs defaultValue="your-repos" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="your-repos">Your Repositories</TabsTrigger>
            <TabsTrigger value="from-url">From URL</TabsTrigger>
          </TabsList>

          <TabsContent value="your-repos" className="space-y-4">
            {loading && (
              <div className="flex justify-center py-8">
                <Loader2 className="animate-spin h-6 w-6" />
              </div>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}

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
            )}
          </TabsContent>

          <TabsContent value="from-url" className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">Repository URL</Label>
              <Input
                placeholder="https://github.com/user/repo.git"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={importing}
              />
              {error && <p className="text-sm text-red-500">{error}</p>}
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
