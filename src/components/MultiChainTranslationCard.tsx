import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, Loader2, Code2, ArrowLeftRight } from "lucide-react";
import { FileAttachmentDropdown } from "@/components/chat/FileAttachmentDropdown";
import { useAttachments } from "@/hooks/useAttachments";
import { AttachmentsList } from "@/components/chat/AttachmentsList";
import {
  BLOCKCHAIN_LANGUAGES,
  getSourceLanguages,
  getTargetLanguages,
  getSupportedTargets,
} from "@/lib/blockchain_languages_registry";
import { IpcClient } from "@/ipc/ipc_client";

interface MultiChainTranslationCardProps {
  onTranslate: (
    code: string,
    attachments: any[],
    projectName: string,
    sourceLanguage: string,
    targetLanguage: string,
  ) => void;
}

export function MultiChainTranslationCard({
  onTranslate,
}: MultiChainTranslationCardProps) {
  // Language selection
  const [sourceLanguage, setSourceLanguage] = useState<string>("solidity");
  const [targetLanguage, setTargetLanguage] = useState<string>("sui_move");

  // Form state
  const [code, setCode] = useState("");
  const [projectName, setProjectName] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [toolchainSetup, setToolchainSetup] = useState(false);

  const { attachments, handleFileSelect, removeAttachment, clearAttachments } =
    useAttachments();

  // Get available languages
  const sourceLanguages = useMemo(() => getSourceLanguages(), []);
  const targetLanguages = useMemo(
    () => getTargetLanguages(sourceLanguage),
    [sourceLanguage],
  );

  // Get translation pair info
  const translationPair = useMemo(() => {
    const pairs = getSupportedTargets(sourceLanguage);
    return pairs.find((p) => p.target === targetLanguage);
  }, [sourceLanguage, targetLanguage]);

  // Handle source language change
  const handleSourceChange = (newSource: string) => {
    setSourceLanguage(newSource);
    // Reset target if it's not valid for new source
    const newTargets = getTargetLanguages(newSource);
    if (!newTargets.some((lang) => lang.id === targetLanguage)) {
      setTargetLanguage(newTargets[0]?.id || "");
    }
  };

  // Swap languages (if bidirectional translation exists)
  const handleSwapLanguages = () => {
    const reverseSupported = getSupportedTargets(targetLanguage).some(
      (p) => p.target === sourceLanguage,
    );
    if (reverseSupported) {
      const temp = sourceLanguage;
      setSourceLanguage(targetLanguage);
      setTargetLanguage(temp);
    }
  };

  const canSwap = useMemo(() => {
    return getSupportedTargets(targetLanguage).some(
      (p) => p.target === sourceLanguage,
    );
  }, [sourceLanguage, targetLanguage]);

  const handleTranslate = async () => {
    if (!code.trim() && attachments.length === 0) return;
    if (!sourceLanguage || !targetLanguage) return;

    setIsTranslating(true);
    try {
      await onTranslate(
        code,
        attachments,
        projectName,
        sourceLanguage,
        targetLanguage,
      );
      setCode("");
      setProjectName("");
      clearAttachments();
    } catch (error) {
      console.error("Translation failed:", error);
    } finally {
      setIsTranslating(false);
    }
  };

  const sourceLang = BLOCKCHAIN_LANGUAGES[sourceLanguage];
  const targetLang = BLOCKCHAIN_LANGUAGES[targetLanguage];

  const checkToolchainSetup = async (language: string) => {
    try {
      switch (language) {
        case "solidity": {
          const { solcVersion } =
            await IpcClient.getInstance().solidityVersion();
          return !!solcVersion;
        }
        case "sui_move": {
          const { suiVersion } = await IpcClient.getInstance().suiVersion();
          return !!suiVersion;
        }
        case "solana_rust": {
          const { anchorVersion } =
            await IpcClient.getInstance().solanaVersion();
          return !!anchorVersion;
        }
        case "aptos_move": {
          const { aptosMoveVersion } =
            await IpcClient.getInstance().aptosVersion();
          return !!aptosMoveVersion;
        }
        case "vyper": {
          const { vyperVersion } = await IpcClient.getInstance().vyperVersion();
          return !!vyperVersion;
        }
        case "cairo": {
          const { cairoVersion } = await IpcClient.getInstance().cairoVersion();
          return !!cairoVersion;
        }
        case "cosmwasm_rust": {
          const { cosmwasmVersion } =
            await IpcClient.getInstance().cosmwasmVersion();
          return !!cosmwasmVersion;
        }
        default:
          return false;
      }
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  useEffect(() => {
    const check = async () => {
      setToolchainSetup(await checkToolchainSetup(targetLanguage));
    };
    check();
  }, [targetLanguage]);

  return (
    <Card className="w-full border-2 border-primary/20 shadow-lg" data-testid="translation-card">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Code2 className="w-5 h-5 text-primary" />
          <CardTitle>Multi-Chain Smart Contract Translation</CardTitle>
        </div>
        <CardDescription>
          Translate smart contracts between different blockchain languages and
          platforms
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Language Selection */}
        <div className="grid grid-cols-3 md:grid-cols-[1fr,auto,1fr] gap-3 items-center">
          {/* Source Language */}
          <div className="space-y-2">
            <Label htmlFor="source-language">Source Language</Label>
            <Select value={sourceLanguage} onValueChange={handleSourceChange}>
              <SelectTrigger id="source-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sourceLanguages.map((lang) => (
                  <SelectItem key={lang.id} value={lang.id}>
                    <div className="flex items-center gap-2">
                      {lang.icon && <span>{lang.icon}</span>}
                      <span>{lang.displayName}</span>
                      <span className="text-xs text-muted-foreground">
                        ({lang.ecosystem[0]})
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Swap Button */}
          <div className="flex items-center justify-center pt-6">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSwapLanguages}
              disabled={!canSwap || isTranslating}
              title={
                canSwap
                  ? "Swap source and target languages"
                  : "Reverse translation not available"
              }
            >
              <ArrowLeftRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Target Language */}
          <div className="space-y-2">
            <Label htmlFor="target-language">Target Language</Label>
            <Select value={targetLanguage} onValueChange={setTargetLanguage}>
              <SelectTrigger id="target-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targetLanguages.map((lang) => (
                  <SelectItem key={lang.id} value={lang.id}>
                    <div className="flex items-center gap-2">
                      {lang.icon && <span>{lang.icon}</span>}
                      <span>{lang.displayName}</span>
                      <span className="text-xs text-muted-foreground">
                        ({lang.ecosystem[0]})
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Translation Status Badge */}
        {translationPair && (
          <div className="flex items-center gap-2 text-sm">
            <div
              className={`px-2 py-1 rounded-md text-xs font-medium ${translationPair.status === "implemented"
                ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                : translationPair.status === "experimental"
                  ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400"
                  : "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                }`}
            >
              {translationPair.status === "implemented"
                ? "✓ Fully Supported"
                : translationPair.status === "experimental"
                  ? "⚠ Experimental"
                  : "🚧 Coming Soon"}
            </div>
            <span className="text-xs text-muted-foreground">
              Quality: {translationPair.quality}
            </span>
          </div>
        )}

        {/* Project Name */}
        <div className="space-y-2">
          <Label htmlFor="project-name">Project Name (optional)</Label>
          <Input
            id="project-name"
            placeholder="e.g., my-defi-protocol"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            disabled={isTranslating}
            className="font-mono"
          />
        </div>

        {/* Code Input */}
        <div className="space-y-2">
          <Label htmlFor="source-code">
            {sourceLang?.displayName || "Source"} Code
          </Label>
          <Textarea
            id="source-code"
            placeholder={`// Paste your ${sourceLang?.displayName || "source"} code here...\n// or upload ${sourceLang?.fileExtension || ""} files`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="min-h-[200px] font-mono text-sm"
            disabled={isTranslating}
          />

          {attachments.length > 0 && (
            <AttachmentsList
              attachments={attachments}
              onRemove={removeAttachment}
            />
          )}
        </div>
        {!toolchainSetup && (
          <div className="max-w-3xl mx-auto mt-4 py-2 px-3 text-sm bg-red-100 border border-red-200 rounded-lg dark:bg-red-800/10 dark:border-red-900">
            {targetLang.displayName} compiler is required but not installed on
            your system.{" "}
            <a
              onClick={() =>
                IpcClient.getInstance().openExternalUrl(
                  targetLang.installationUrl,
                )
              }
              className="text-gray-700 hover:text-gray-900 underline cursor-pointer font-medium dark:text-gray-300 dark:hover:text-gray-100"
            >
              See installation docs
            </a>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-2">
          <FileAttachmentDropdown
            onFileSelect={handleFileSelect}
            disabled={isTranslating}
          />

          <Button
            data-testid="main-translate-button"
            onClick={handleTranslate}
            disabled={
              (!code.trim() && attachments.length === 0) ||
              isTranslating ||
              !translationPair ||
              translationPair.status === "planned" ||
              !toolchainSetup
            }
            className="gap-2"
            size="lg"
          >
            {isTranslating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Translating...
              </>
            ) : (
              <>
                Translate to {targetLang?.displayName || "Target"}
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>

        {/* Info */}
        {translationPair && (
          <div className="text-xs text-muted-foreground space-y-1 border-t pt-3">
            <p className="font-medium">Translation Details:</p>
            {translationPair.notes && <p>• {translationPair.notes}</p>}
            <p>
              • Upload {sourceLang?.fileExtension} files or paste code directly
            </p>
            <p>
              • Translation generates {targetLang?.fileExtension} files with
              proper structure
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
