import { FileEditor } from "./FileEditor";
import { FileTree } from "./FileTree";
import { SuiSetup } from "./SuiSetup";
import { useState, useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { selectedFileAtom } from "@/atoms/viewAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { Button } from "@/components/ui/button";
import {
  Code2,
  Rocket,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  FileCode,
  Sparkles,
  Settings
} from "lucide-react";
import { useLoadApp } from "@/hooks/useLoadApp";
import { IpcClient } from "@/ipc/ipc_client";
import { useStreamChat } from "@/hooks/useStreamChat";

interface App {
  id?: number;
  files?: string[];
  name?: string;
  path?: string;
}

export interface ContractViewProps {
  loading: boolean;
  app: App | null;
}

type CompileStatus = "idle" | "compiling" | "success" | "error";
type DeployStatus = "idle" | "deploying" | "success" | "error";

export const ContractView = ({ loading, app }: ContractViewProps) => {
  const selectedFile = useAtomValue(selectedFileAtom);
  const setSelectedFile = useSetAtom(selectedFileAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { refreshApp } = useLoadApp(app?.id ?? null);
  const { streamMessage } = useStreamChat();
  const [compileStatus, setCompileStatus] = useState<CompileStatus>("idle");
  const [deployStatus, setDeployStatus] = useState<DeployStatus>("idle");
  const [compileOutput, setCompileOutput] = useState("");
  const [deployOutput, setDeployOutput] = useState("");
  const [suiAddress, setSuiAddress] = useState<string | null>(null);
  const [rawCompileError, setRawCompileError] = useState("");
  const [showSetup, setShowSetup] = useState(false);

  // Get Sui address on mount
  useEffect(() => {
    const loadSuiAddress = async () => {
      try {
        const result = await IpcClient.getInstance().getSuiAddress();
        setSuiAddress(result.address);
      } catch (error) {
        console.error("Failed to get Sui address:", error);
      }
    };
    loadSuiAddress();
  }, []);

  // Auto-select the first .move file when app loads or files change
  useEffect(() => {
    if (!app?.files || loading) return;

    const moveFiles = app.files.filter(f => f.endsWith('.move'));

    // If there are Move files and no file is currently selected, select the first one
    if (moveFiles.length > 0 && !selectedFile) {
      setSelectedFile({ path: moveFiles[0] });
      console.log("Auto-selected Move file:", moveFiles[0]);
    }
  }, [app?.files, loading, selectedFile, setSelectedFile]);

  const handleCompile = async () => {
    if (!app?.path) return;

    setCompileStatus("compiling");
    setCompileOutput("");
    setRawCompileError("");

    try {
      const result = await IpcClient.getInstance().suiCompile(app.path);

      if (result.success) {
        setCompileStatus("success");
        setCompileOutput(result.output);
        setRawCompileError("");
      } else {
        setCompileStatus("error");
        // Use the truncated formatted output for UI display
        setCompileOutput(result.output);
        // Store full formatted error for AI fix prompt (all errors, not truncated)
        setRawCompileError(result.fullError || result.error || "");
      }
    } catch (error) {
      setCompileStatus("error");
      setCompileOutput(`✗ Compilation failed:\n${error}`);
      setRawCompileError(String(error));
    }
  };

  const handleFixErrors = () => {
    if (!selectedChatId || !rawCompileError) return;

    const fixPrompt = `The Move smart contract failed to compile with the following errors:

\`\`\`
${rawCompileError}
\`\`\`

Please fix these compilation errors in the contract. Make sure to:
1. Address all the error messages shown above
2. Update the Move.toml file if needed (e.g., add missing dependencies)
3. Fix any syntax errors, type mismatches, or missing imports
4. Ensure the code follows Sui Move 2024 edition standards
5. Maintain the original functionality while fixing the errors`;

    streamMessage({
      prompt: fixPrompt,
      chatId: selectedChatId,
    });
  };

  const handleDeploy = async () => {
    if (!app?.path || compileStatus !== "success") return;

    setDeployStatus("deploying");
    setDeployOutput("");

    try {
      const result = await IpcClient.getInstance().suiDeploy({
        appPath: app.path,
      });

      if (result.success) {
        setDeployStatus("success");
        setDeployOutput(result.output);
      } else {
        setDeployStatus("error");
        setDeployOutput(result.error || result.output);
      }
    } catch (error) {
      setDeployStatus("error");
      setDeployOutput(`✗ Deployment failed:\n${error}`);
    }
  };

  if (loading) {
    return <div className="text-center py-4">Loading contract files...</div>;
  }

  if (!app) {
    return (
      <div className="text-center py-4 text-gray-500">No contract selected</div>
    );
  }

  // Find Move files
  const moveFiles = app.files?.filter(f => f.endsWith('.move')) || [];

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Contract Actions Toolbar */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Smart Contract</span>
          <span className="text-xs text-muted-foreground">
            {moveFiles.length} Move file{moveFiles.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowSetup(!showSetup)}
            variant={showSetup ? "default" : "ghost"}
            size="sm"
            title="Sui Deployment Setup"
          >
            <Settings className="w-4 h-4" />
          </Button>

          <Button
            onClick={() => refreshApp()}
            variant="ghost"
            size="sm"
            disabled={loading || !app.id}
            title="Refresh Files"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>

          <Button
            onClick={handleCompile}
            variant="outline"
            size="sm"
            disabled={compileStatus === "compiling" || moveFiles.length === 0}
            className="gap-2"
          >
            {compileStatus === "compiling" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Compiling...
              </>
            ) : compileStatus === "success" ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Compiled
              </>
            ) : compileStatus === "error" ? (
              <>
                <XCircle className="w-4 h-4 text-red-600" />
                Failed
              </>
            ) : (
              <>
                <Code2 className="w-4 h-4" />
                Compile
              </>
            )}
          </Button>

          {/* Fix with AI button - only show when there are compilation errors */}
          {compileStatus === "error" && rawCompileError && (
            <Button
              onClick={handleFixErrors}
              variant="secondary"
              size="sm"
              disabled={!selectedChatId}
              className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
              title={!selectedChatId ? "No chat selected" : "Ask AI to fix errors"}
            >
              <Sparkles className="w-4 h-4" />
              Fix with AI
            </Button>
          )}

          <Button
            onClick={handleDeploy}
            variant="default"
            size="sm"
            disabled={
              compileStatus !== "success" ||
              deployStatus === "deploying"
            }
            className="gap-2"
          >
            {deployStatus === "deploying" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Deploying...
              </>
            ) : deployStatus === "success" ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Deployed
              </>
            ) : deployStatus === "error" ? (
              <>
                <XCircle className="w-4 h-4" />
                Failed
              </>
            ) : (
              <>
                <Rocket className="w-4 h-4" />
                Deploy to Sui
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Sui Setup Panel */}
      {showSetup && (
        <div className="border-b p-4 bg-muted/30">
          <SuiSetup suiAddress={suiAddress} />
        </div>
      )}

      {/* Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* File Tree */}
        <div className="w-1/3 overflow-auto border-r">
          <FileTree files={app.files || []} />
        </div>

        {/* Editor or Output */}
        <div className="w-2/3 flex flex-col">
          <div className="flex-1 overflow-hidden">
            {selectedFile ? (
              <FileEditor appId={app.id ?? null} filePath={selectedFile.path} />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <FileCode className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>Select a Move file to view</p>
                </div>
              </div>
            )}
          </div>

          {/* Compile/Deploy Output */}
          {(compileOutput || deployOutput) && (
            <div className="border-t bg-muted/50 p-4 max-h-96 overflow-auto">
              <div className="space-y-2">
                {/* Output header */}
                <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {deployOutput ? "Deployment Output" : "Compilation Output"}
                  </span>
                </div>
                {/* Output content */}
                <div className="font-mono text-xs whitespace-pre-wrap leading-relaxed">
                  {deployOutput || compileOutput}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Help Text */}
      {moveFiles.length === 0 && (
        <div className="p-4 border-t bg-yellow-50 dark:bg-yellow-900/20 text-sm">
          <p className="text-yellow-800 dark:text-yellow-200">
            ⚠️ No Move files detected. Make sure your contract files have the .move extension.
          </p>
        </div>
      )}
    </div>
  );
};
