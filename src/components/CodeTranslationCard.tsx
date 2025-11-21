import { useState } from "react";
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
import { ArrowRight, Upload, Loader2, Code2 } from "lucide-react";
import { FileAttachmentDropdown } from "@/components/chat/FileAttachmentDropdown";
import { useAttachments } from "@/hooks/useAttachments";
import { AttachmentsList } from "@/components/chat/AttachmentsList";

interface CodeTranslationCardProps {
  onTranslate: (code: string, attachments: any[], projectName: string) => void;
}

export function CodeTranslationCard({ onTranslate }: CodeTranslationCardProps) {
  const [solidityCode, setSolidityCode] = useState("");
  const [projectName, setProjectName] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const { attachments, handleFileSelect, removeAttachment, clearAttachments } =
    useAttachments();

  const handleTranslate = async () => {
    if (!solidityCode.trim() && attachments.length === 0) return;

    setIsTranslating(true);
    try {
      await onTranslate(solidityCode, attachments, projectName);
      setSolidityCode("");
      setProjectName("");
      clearAttachments();
    } catch (error) {
      console.error("Translation failed:", error);
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <Card className="w-full border-2 border-primary/20 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Code2 className="w-5 h-5 text-primary" />
          <CardTitle>Solidity → Sui Move Translation</CardTitle>
        </div>
        <CardDescription>
          Paste your Solidity smart contract code or upload .sol files to
          translate to Sui Move
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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

        <div className="space-y-2">
          <Label htmlFor="solidity-code">Solidity Contract</Label>
          <Textarea
            id="solidity-code"
            placeholder="// Paste your Solidity code here...
// Example:
// pragma solidity ^0.8.0;
// contract SimpleStorage {
//     uint256 public storedData;
//     function set(uint256 x) public {
//         storedData = x;
//     }
// }"
            value={solidityCode}
            onChange={(e) => setSolidityCode(e.target.value)}
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

        <div className="flex items-center justify-between gap-2">
          <FileAttachmentDropdown
            onFileSelect={handleFileSelect}
            disabled={isTranslating}
          />

          <Button
            onClick={handleTranslate}
            disabled={
              (!solidityCode.trim() && attachments.length === 0) ||
              isTranslating
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
                Translate to Move
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>• Supports Solidity versions 0.6.0 - 0.8.x</p>
          <p>• Upload .sol files or paste code directly</p>
          <p>
            • Translation preserves contract logic and adds Sui Move safety
            features
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
