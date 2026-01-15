import { FileEditor } from "./FileEditor";
import { FileTree } from "./FileTree";
import { SuiSetup } from "./SuiSetup";
import { useState, useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { selectedFileAtom } from "@/atoms/viewAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { homeModeAtom } from "@/atoms/appAtoms";
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
  Settings,
  FlaskConical,
  Zap,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLoadApp } from "@/hooks/useLoadApp";
import { IpcClient } from "@/ipc/ipc_client";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useNavigate } from "@tanstack/react-router";
import log from "electron-log";

const logger = log.scope("ContractView");

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
type TestStatus = "idle" | "testing" | "success" | "error";
type BlockchainType = "sui" | "solana" | "unknown";

/**
 * Detect blockchain type based on project files
 */
function detectBlockchainType(files: string[] | undefined): BlockchainType {
  if (!files) return "unknown";

  const hasAnchorToml = files.some((f) => f.includes("Anchor.toml"));
  const hasCargoToml = files.some(
    (f) => f.includes("Cargo.toml") && f.includes("programs/"),
  );
  const hasMoveToml = files.some((f) => f.includes("Move.toml"));
  const hasMoveFiles = files.some((f) => f.endsWith(".move"));

  if (hasAnchorToml || hasCargoToml) {
    return "solana";
  }

  if (hasMoveToml || hasMoveFiles) {
    return "sui";
  }

  return "unknown";
}

export const ContractView = ({ loading, app }: ContractViewProps) => {
  const selectedFile = useAtomValue(selectedFileAtom);
  const setSelectedFile = useSetAtom(selectedFileAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { refreshApp } = useLoadApp(app?.id ?? null);
  const { streamMessage } = useStreamChat();
  const navigate = useNavigate();
  const setHomeMode = useSetAtom(homeModeAtom);
  const [compileStatus, setCompileStatus] = useState<CompileStatus>("idle");
  const [deployStatus, setDeployStatus] = useState<DeployStatus>("idle");
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [compileOutput, setCompileOutput] = useState("");
  const [deployOutput, setDeployOutput] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [suiAddress, setSuiAddress] = useState<string | null>(null);
  const [rawCompileError, setRawCompileError] = useState("");
  const [rawTestError, setRawTestError] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [lastFailedAction, setLastFailedAction] = useState<
    "compile" | "test" | null
  >(null);
  const [deployedPackageId, setDeployedPackageId] = useState<string | null>(
    null,
  );
  const [network, setNetwork] = useState<string>("devnet");

  // Detect blockchain type
  const blockchainType = detectBlockchainType(app?.files);

  // Get wallet address on mount
  useEffect(() => {
    const loadWalletAddress = async () => {
      try {
        let result;
        if (blockchainType === "sui") {
          result = await IpcClient.getInstance().getSuiAddress();
        } else if (blockchainType === "solana") {
          result = await IpcClient.getInstance().getSolanaAddress();
        }
        setSuiAddress(result?.address || null);
      } catch (error) {
        logger.error("Failed to get wallet address:", error);
      }
    };
    loadWalletAddress();
  }, [blockchainType]);

  // Auto-select the first contract file when app loads or files change
  useEffect(() => {
    if (!app?.files || loading) return;

    let contractFiles: string[] = [];
    if (blockchainType === "sui") {
      contractFiles = app.files.filter((f) => f.endsWith(".move"));
    } else if (blockchainType === "solana") {
      contractFiles = app.files.filter(
        (f) => f.endsWith(".rs") && f.includes("/src/"),
      );
    }

    // If there are contract files and no file is currently selected, select the first one
    if (contractFiles.length > 0 && !selectedFile) {
      setSelectedFile({ path: contractFiles[0] });
      logger.info("Auto-selected contract file:", contractFiles[0]);
    }
  }, [app?.files, loading, selectedFile, setSelectedFile, blockchainType]);

  const handleCompile = async () => {
    if (!app?.path) return;

    setCompileStatus("compiling");
    setCompileOutput("");
    setRawCompileError("");

    try {
      let result;
      if (blockchainType === "sui") {
        result = await IpcClient.getInstance().suiCompile(app.path);
      } else if (blockchainType === "solana") {
        result = await IpcClient.getInstance().solanaCompile(app.path);
      } else {
        throw new Error("Unknown blockchain type");
      }

      if (result.success) {
        setCompileStatus("success");
        setCompileOutput(result.output);
        setRawCompileError("");
        setLastFailedAction(null);
      } else {
        setCompileStatus("error");
        // Use the truncated formatted output for UI display
        setCompileOutput(result.output);
        // Store full formatted error for AI fix prompt (all errors, not truncated)
        setRawCompileError(result.fullError || result.error || "");
        setLastFailedAction("compile");
      }
    } catch (error) {
      setCompileStatus("error");
      setCompileOutput(`✗ Compilation failed:\n${error}`);
      setRawCompileError(String(error));
      setLastFailedAction("compile");
    }
  };

  const handleFixErrors = () => {
    if (!selectedChatId || !rawCompileError) return;

    const chainName =
      blockchainType === "sui"
        ? "Sui Move"
        : blockchainType === "solana"
          ? "Solana/Anchor"
          : "smart contract";
    const configFile =
      blockchainType === "sui"
        ? "Move.toml"
        : blockchainType === "solana"
          ? "Cargo.toml/Anchor.toml"
          : "config";

    const fixPrompt = `The ${chainName} smart contract failed to compile with the following errors:

\`\`\`
${rawCompileError}
\`\`\`

Please fix these compilation errors in the contract. Make sure to:
1. Address all the error messages shown above
2. Update the ${configFile} file if needed (e.g., add missing dependencies)
3. Fix any syntax errors, type mismatches, or missing imports
4. Ensure the code follows best practices for ${chainName}
5. Maintain the original functionality while fixing the errors

Make only the code changes and give no further tips and actions, only a brief summary.`;

    streamMessage({
      prompt: fixPrompt,
      chatId: selectedChatId,
    });
  };

  const handleFixTestErrors = () => {
    if (!selectedChatId || !rawTestError) return;

    const fixPrompt = `The Move smart contract tests failed with the following output:

\`\`\`
${rawTestError}
\`\`\`

Please fix the test failures. Make sure to:
1. Analyze the test failure messages and identify the root cause
2. Fix any issues in the test code or the contract code being tested
3. Update test assertions if the contract behavior has changed intentionally
4. Ensure all test helper functions and test scenarios are correct
5. Make sure the tests follow Sui Move testing best practices
6. Maintain the original test coverage while fixing the failures

Make only the code changes and give no further tips and actions, only a brief summary.`;

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
      let result;
      if (blockchainType === "sui") {
        result = await IpcClient.getInstance().suiDeploy({
          appPath: app.path,
        });
      } else if (blockchainType === "solana") {
        result = await IpcClient.getInstance().solanaDeploy({
          appPath: app.path,
          network: network as
            | "localnet"
            | "devnet"
            | "testnet"
            | "mainnet-beta",
        });
      } else {
        throw new Error("Unknown blockchain type");
      }

      if (result.success) {
        setDeployStatus("success");
        setDeployOutput(result.output);

        // Save deployment info to database
        const deployedAddr =
          blockchainType === "sui"
            ? (result as any).packageId
            : (result as any).programId;

        if (deployedAddr && app.id) {
          setDeployedPackageId(deployedAddr);
          try {
            await IpcClient.getInstance().saveContractDeployment({
              appId: app.id,
              chain: blockchainType,
              address: deployedAddr,
              network: blockchainType === "sui" ? "testnet" : network,
              deploymentData: result,
            });
          } catch (saveError) {
            logger.error("Failed to save deployment info:", saveError);
          }
        }
      } else {
        setDeployStatus("error");
        setDeployOutput((result as any).error || result.output);
      }
    } catch (error) {
      setDeployStatus("error");
      setDeployOutput(`✗ Deployment failed:\n${error}`);
    }
  };

  const handleTest = async () => {
    if (!app?.path) return;

    setTestStatus("testing");
    setTestOutput("");
    setRawTestError("");

    try {
      let result;
      if (blockchainType === "sui") {
        result = await IpcClient.getInstance().suiTest(app.path);
      } else if (blockchainType === "solana") {
        result = await IpcClient.getInstance().solanaTest(app.path);
      } else {
        throw new Error("Unknown blockchain type");
      }

      if (result.success) {
        setTestStatus("success");
        setTestOutput(result.output);
        setRawTestError("");
        setLastFailedAction(null);
      } else {
        setTestStatus("error");
        setTestOutput(result.output);
        // Store raw error for AI fix prompt
        setRawTestError(result.error || result.output);
        setLastFailedAction("test");
      }
    } catch (error) {
      setTestStatus("error");
      const errorOutput = `✗ Tests failed:\n${error}`;
      setTestOutput(errorOutput);
      setRawTestError(String(error));
      setLastFailedAction("test");
    }
  };

  const handleBuildDapp = () => {
    // Switch to Generate mode
    setHomeMode("generate");
    // Navigate to home page with the contract pre-mentioned
    navigate({ to: "/" });
    // The user can then type their dApp request and the @ mention will auto-suggest the deployed contract
  };

  if (loading) {
    return <div className="text-center py-4">Loading contract files...</div>;
  }

  if (!app) {
    return (
      <div className="text-center py-4 text-gray-500">No contract selected</div>
    );
  }

  // Find contract files based on blockchain type
  const contractFiles =
    blockchainType === "sui"
      ? app.files?.filter((f) => f.endsWith(".move")) || []
      : blockchainType === "solana"
        ? app.files?.filter(
            (f) =>
              f.endsWith(".rs") &&
              (f.includes("/programs/") || f.includes("/src/")) &&
              f.endsWith("lib.rs"),
          ) || []
        : [];

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Contract Actions Toolbar */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Smart Contract</span>
          {blockchainType === "sui" && (
            <span className="text-xs px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 font-medium">
              🌊 Sui Move
            </span>
          )}
          {blockchainType === "solana" && (
            <span className="text-xs px-2 py-1 rounded-md bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 font-medium">
              ◎ Solana
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {contractFiles.length}{" "}
            {blockchainType === "sui"
              ? "Move"
              : blockchainType === "solana"
                ? "Rust"
                : "contract"}{" "}
            file{contractFiles.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Network selector for Solana */}
          {blockchainType === "solana" && (
            <Select value={network} onValueChange={setNetwork}>
              <SelectTrigger className="w-32 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="localnet">Localnet</SelectItem>
                <SelectItem value="devnet">Devnet</SelectItem>
                <SelectItem value="testnet">Testnet</SelectItem>
                <SelectItem value="mainnet-beta">Mainnet</SelectItem>
              </SelectContent>
            </Select>
          )}

          <Button
            onClick={() => setShowSetup(!showSetup)}
            variant={showSetup ? "default" : "ghost"}
            size="sm"
            title={
              blockchainType === "sui"
                ? "Sui Deployment Setup"
                : blockchainType === "solana"
                  ? "Solana Wallet Setup"
                  : "Deployment Setup"
            }
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
            disabled={
              compileStatus === "compiling" || contractFiles.length === 0
            }
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

          {/* Fix with AI button - only show when compilation errors are the last failure */}
          {compileStatus === "error" &&
            rawCompileError &&
            lastFailedAction === "compile" && (
              <Button
                onClick={handleFixErrors}
                variant="secondary"
                size="sm"
                disabled={!selectedChatId}
                className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
                title={
                  !selectedChatId ? "No chat selected" : "Ask AI to fix errors"
                }
              >
                <Sparkles className="w-4 h-4" />
                Fix with AI
              </Button>
            )}

          <Button
            onClick={handleTest}
            variant="outline"
            size="sm"
            disabled={testStatus === "testing" || contractFiles.length === 0}
            className="gap-2"
          >
            {testStatus === "testing" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Testing...
              </>
            ) : testStatus === "success" ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Passed
              </>
            ) : testStatus === "error" ? (
              <>
                <XCircle className="w-4 h-4 text-red-600" />
                Failed
              </>
            ) : (
              <>
                <FlaskConical className="w-4 h-4" />
                Test
              </>
            )}
          </Button>

          {/* Fix Tests with AI button - only show when test errors are the last failure */}
          {testStatus === "error" &&
            rawTestError &&
            lastFailedAction === "test" && (
              <Button
                onClick={handleFixTestErrors}
                variant="secondary"
                size="sm"
                disabled={!selectedChatId}
                className="gap-2 bg-orange-600 hover:bg-orange-700 text-white"
                title={
                  !selectedChatId
                    ? "No chat selected"
                    : "Ask AI to fix test failures"
                }
              >
                <Sparkles className="w-4 h-4" />
                Fix Tests
              </Button>
            )}

          <Button
            onClick={handleDeploy}
            variant="default"
            size="sm"
            disabled={
              compileStatus !== "success" || deployStatus === "deploying"
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
                {blockchainType === "sui"
                  ? "Deploy to Sui"
                  : blockchainType === "solana"
                    ? "Deploy to Solana"
                    : "Deploy"}
              </>
            )}
          </Button>

          {/* Build dApp button - only show after successful deployment */}
          {deployStatus === "success" && deployedPackageId && (
            <Button
              onClick={handleBuildDapp}
              variant="default"
              size="sm"
              className="gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
            >
              <Zap className="w-4 h-4" />
              Build dApp
            </Button>
          )}
        </div>
      </div>

      {/* Wallet Setup Panel */}
      {showSetup && (
        <div className="border-b p-4 bg-muted/30">
          <SuiSetup suiAddress={suiAddress} blockchainType={blockchainType} />
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
                  <p>
                    Select a{" "}
                    {blockchainType === "sui"
                      ? "Move"
                      : blockchainType === "solana"
                        ? "Rust"
                        : "contract"}{" "}
                    file to view
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Compile/Test/Deploy Output */}
          {(compileOutput || testOutput || deployOutput) && (
            <div className="border-t bg-muted/50 p-4 max-h-96 overflow-auto">
              <div className="space-y-2">
                {/* Output header */}
                <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {deployOutput
                      ? "Deployment Output"
                      : testOutput
                        ? "Test Output"
                        : "Compilation Output"}
                  </span>
                </div>
                {/* Output content */}
                <div className="font-mono text-xs whitespace-pre-wrap leading-relaxed">
                  {deployOutput || testOutput || compileOutput}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Help Text */}
      {contractFiles.length === 0 && blockchainType !== "unknown" && (
        <div className="p-4 border-t bg-yellow-50 dark:bg-yellow-900/20 text-sm">
          <p className="text-yellow-800 dark:text-yellow-200">
            ⚠️ No{" "}
            {blockchainType === "sui"
              ? "Move files (.move)"
              : blockchainType === "solana"
                ? "Rust program files (.rs in programs/*/src/)"
                : "contract files"}{" "}
            detected. Make sure your contract files are in the correct location.
          </p>
        </div>
      )}
    </div>
  );
};
