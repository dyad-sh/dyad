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
import { NEON_TEMPLATE_IDS, Template } from "@/shared/templates";
import { useRouter } from "@tanstack/react-router";
import {
  Loader2,
  AppWindow,
  Bot,
  MessageSquare,
  Code2,
  Database,
  Brain,
  Sparkles,
} from "lucide-react";
import { neonTemplateHook } from "@/client_logic/template_hook";
import { showError } from "@/lib/toast";
import { cn } from "@/lib/utils";

export type AssetType = "app" | "agent" | "bot" | "algorithm" | "schema" | "nlp";

interface AssetTypeConfig {
  id: AssetType;
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  borderColor: string;
}

const assetTypes: AssetTypeConfig[] = [
  {
    id: "app",
    title: "App",
    description: "Full-stack web application",
    icon: AppWindow,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
  },
  {
    id: "agent",
    title: "Agent",
    description: "Autonomous AI agent with tools",
    icon: Bot,
    color: "text-violet-500",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/30",
  },
  {
    id: "bot",
    title: "Bot",
    description: "Conversational chatbot",
    icon: MessageSquare,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
  },
  {
    id: "algorithm",
    title: "Algorithm",
    description: "Custom logic & processing",
    icon: Code2,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
  },
  {
    id: "schema",
    title: "Schema",
    description: "Data models & validation",
    icon: Database,
    color: "text-pink-500",
    bgColor: "bg-pink-500/10",
    borderColor: "border-pink-500/30",
  },
  {
    id: "nlp",
    title: "NLP",
    description: "Natural language processing",
    icon: Brain,
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/30",
  },
];

interface CreateAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: Template;
  defaultAssetType?: AssetType;
}

export function CreateAssetDialog({
  open,
  onOpenChange,
  template,
  defaultAssetType = "app",
}: CreateAssetDialogProps) {
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const [assetName, setAssetName] = useState("");
  const [selectedType, setSelectedType] = useState<AssetType>(defaultAssetType);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { createApp } = useCreateApp();
  const { data: nameCheckResult } = useCheckName(assetName);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!assetName.trim()) {
      return;
    }

    if (nameCheckResult?.exists) {
      return;
    }

    setIsSubmitting(true);
    try {
      // For now, all asset types use the same creation flow
      // but we tag them with their type for future differentiation
      const result = await createApp({ 
        name: assetName.trim(),
        // metadata: { assetType: selectedType } // TODO: Add metadata support
      });
      
      if (template && NEON_TEMPLATE_IDS.has(template.id)) {
        await neonTemplateHook({
          appId: result.app.id,
          appName: result.app.name,
        });
      }
      
      setSelectedAppId(result.app.id);
      router.navigate({
        to: "/chat",
        search: { id: result.chatId },
      });
      setAssetName("");
      onOpenChange(false);
    } catch (error) {
      showError(error as any);
      console.error("Error creating asset:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isNameValid = assetName.trim().length > 0;
  const nameExists = nameCheckResult?.exists;
  const canSubmit = isNameValid && !nameExists && !isSubmitting;

  const selectedTypeConfig = assetTypes.find((t) => t.id === selectedType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] ghost-panel">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-500" />
            Create New Asset
          </DialogTitle>
          <DialogDescription>
            {template
              ? `Create a new ${selectedType} using the ${template.title} template.`
              : `Build AI-powered ${selectedType}s with JoyCreate.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="grid gap-6 py-4">
            {/* Asset Type Selector */}
            <div className="grid gap-3">
              <Label>Asset Type</Label>
              <div className="grid grid-cols-3 gap-2">
                {assetTypes.map((type) => {
                  const Icon = type.icon;
                  const isSelected = selectedType === type.id;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => setSelectedType(type.id)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all",
                        "hover:shadow-sm",
                        isSelected
                          ? `${type.bgColor} ${type.borderColor} border-2 shadow-sm`
                          : "border-border/50 hover:border-border bg-background/50"
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-5 w-5",
                          isSelected ? type.color : "text-muted-foreground"
                        )}
                      />
                      <span
                        className={cn(
                          "text-xs font-medium",
                          isSelected ? type.color : "text-muted-foreground"
                        )}
                      >
                        {type.title}
                      </span>
                    </button>
                  );
                })}
              </div>
              {selectedTypeConfig && (
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedTypeConfig.description}
                </p>
              )}
            </div>

            {/* Asset Name Input */}
            <div className="grid gap-2">
              <Label htmlFor="assetName">
                {selectedTypeConfig?.title} Name
              </Label>
              <Input
                id="assetName"
                value={assetName}
                onChange={(e) => setAssetName(e.target.value)}
                placeholder={`Enter ${selectedType} name...`}
                className={cn(
                  "ghost-input",
                  nameExists && "border-red-500 focus:border-red-500"
                )}
                disabled={isSubmitting}
              />
              {nameExists && (
                <p className="text-sm text-red-500">
                  An asset with this name already exists
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
              className="ghost-button"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                "transition-all",
                selectedTypeConfig?.bgColor,
                "hover:opacity-90",
                "text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
              )}
            >
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {isSubmitting
                ? "Creating..."
                : `Create ${selectedTypeConfig?.title}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { assetTypes };
