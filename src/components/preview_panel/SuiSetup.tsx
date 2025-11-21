import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Terminal,
  Wallet,
  Droplet,
  RefreshCw,
} from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";

interface SuiSetupProps {
  suiAddress: string | null;
}

type SetupStep = "env" | "address" | "faucet" | "complete";

export const SuiSetup = ({ suiAddress }: SuiSetupProps) => {
  const [currentStep, setCurrentStep] = useState<SetupStep>(
    suiAddress ? "complete" : "env",
  );
  const [isCheckingEnv, setIsCheckingEnv] = useState(false);
  const [isCheckingAddress, setIsCheckingAddress] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

  // Fetch balance when address is available
  useEffect(() => {
    if (suiAddress) {
      loadBalance();
    }
  }, [suiAddress]);

  const loadBalance = async () => {
    setIsLoadingBalance(true);
    try {
      const result = await IpcClient.getInstance().getSuiBalance();
      setBalance(result.formattedBalance);
    } catch (error) {
      console.error("Failed to load balance:", error);
      setBalance(null);
    } finally {
      setIsLoadingBalance(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const checkEnvironment = async () => {
    setIsCheckingEnv(true);
    // TODO: Add actual check via IPC
    setTimeout(() => {
      setIsCheckingEnv(false);
      setCurrentStep("address");
    }, 1000);
  };

  const checkAddress = async () => {
    setIsCheckingAddress(true);
    // TODO: Add actual check via IPC
    setTimeout(() => {
      setIsCheckingAddress(false);
      setCurrentStep("faucet");
    }, 1000);
  };

  const steps = [
    {
      id: "env" as SetupStep,
      title: "1. Configure Network",
      description: "Set your Sui CLI to use testnet",
      icon: <Terminal className="w-5 h-5" />,
      command: "sui client switch --env testnet",
      action: checkEnvironment,
      actionLabel: "Verify Configuration",
      isLoading: isCheckingEnv,
      completed: currentStep !== "env",
    },
    {
      id: "address" as SetupStep,
      title: "2. Set Up Wallet",
      description: "Create or import a wallet address",
      icon: <Wallet className="w-5 h-5" />,
      command: "sui client active-address",
      helpText:
        "If you don't have an address, run: sui client new-address ed25519",
      action: checkAddress,
      actionLabel: "Verify Address",
      isLoading: isCheckingAddress,
      completed: currentStep === "faucet" || currentStep === "complete",
    },
    {
      id: "faucet" as SetupStep,
      title: "3. Get Testnet Tokens",
      description: "Request SUI tokens from the faucet",
      icon: <Droplet className="w-5 h-5" />,
      command: "sui client faucet",
      helpText: "Or visit the web faucet",
      externalLink: {
        url: "https://faucet.sui.io/",
        label: "Open Sui Faucet",
      },
      action: () => setCurrentStep("complete"),
      actionLabel: "I've Got Tokens",
      completed: currentStep === "complete",
    },
  ];

  if (currentStep === "complete" && suiAddress) {
    return (
      <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
              <CardTitle className="text-green-900 dark:text-green-100">
                Sui CLI Ready
              </CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadBalance}
              disabled={isLoadingBalance}
              className="h-8 px-2"
              title="Refresh Balance"
            >
              <RefreshCw
                className={`w-4 h-4 ${isLoadingBalance ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
          <CardDescription className="text-green-700 dark:text-green-300">
            Your deployment environment is configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Balance Display */}
            <div className="text-sm">
              <span className="font-medium">Testnet Balance:</span>
              <div className="mt-1 flex items-center gap-2">
                {isLoadingBalance ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs">Loading...</span>
                  </div>
                ) : balance !== null ? (
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-green-700 dark:text-green-300">
                      {balance} SUI
                    </span>
                    {parseFloat(balance) < 0.1 && (
                      <span className="text-xs text-orange-600 dark:text-orange-400">
                        (Low balance - visit faucet)
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Unable to fetch balance
                  </span>
                )}
              </div>
            </div>

            {/* Address Display */}
            <div className="text-sm pt-2 border-t">
              <span className="font-medium">Active Address:</span>
              <div className="mt-1 flex items-center gap-2">
                <code className="px-2 py-1 bg-white dark:bg-gray-800 rounded text-xs font-mono border flex-1 overflow-hidden text-ellipsis">
                  {suiAddress}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(suiAddress)}
                  className="h-7 px-2"
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sui Deployment Setup</CardTitle>
        <CardDescription>
          Configure your local Sui CLI to deploy smart contracts to testnet
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {steps.map((step) => {
          const isActive = currentStep === step.id;

          return (
            <div
              key={step.id}
              className={`p-4 rounded-lg border transition-all ${
                step.completed
                  ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20"
                  : isActive
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/30 opacity-60"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    step.completed
                      ? "bg-green-600 text-white"
                      : isActive
                        ? "bg-primary text-white"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {step.completed ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    step.icon
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm mb-1">{step.title}</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    {step.description}
                  </p>

                  {!step.completed && (
                    <>
                      {step.command && (
                        <div className="mb-2">
                          <div className="flex items-center gap-2 mb-1">
                            <code className="flex-1 px-3 py-2 bg-black dark:bg-gray-900 text-green-400 rounded text-xs font-mono">
                              $ {step.command}
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCopy(step.command!)}
                              className="h-8 px-2"
                            >
                              <Copy className="w-3 h-3" />
                            </Button>
                          </div>
                          {step.helpText && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {step.helpText}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        {step.action && (
                          <Button
                            onClick={step.action}
                            size="sm"
                            disabled={!isActive || step.isLoading}
                            className="h-8"
                          >
                            {step.isLoading && (
                              <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                            )}
                            {step.actionLabel}
                          </Button>
                        )}

                        {step.externalLink && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              window.open(step.externalLink!.url, "_blank")
                            }
                            className="h-8"
                          >
                            <ExternalLink className="w-3 h-3 mr-2" />
                            {step.externalLink.label}
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div className="pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            💡 <strong>Tip:</strong> Run these commands in your terminal to
            configure the Sui CLI. Once complete, you'll be able to deploy your
            Move contracts directly from this panel.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
