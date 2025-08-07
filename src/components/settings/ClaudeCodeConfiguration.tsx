import { useState } from "react";
import { Settings, Clock } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UserSettings } from "@/lib/schemas";

interface ClaudeCodeConfigurationProps {
  provider: string;
  settings: UserSettings | null | undefined;
  isSaving: boolean;
  onSettingsChange: (timeout?: number) => Promise<void>;
}

export function ClaudeCodeConfiguration({
  provider,
  settings,
  isSaving,
  onSettingsChange,
}: ClaudeCodeConfigurationProps) {
  const currentTimeout = settings?.providerSettings?.[provider]?.timeout || 300; // Default 5 minutes
  const [timeoutInput, setTimeoutInput] = useState(currentTimeout.toString());
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSaveTimeout = async () => {
    try {
      setSaveError(null);
      const timeoutValue = parseInt(timeoutInput);
      
      if (isNaN(timeoutValue) || timeoutValue < 30 || timeoutValue > 3600) {
        setSaveError("Timeout must be between 30 and 3600 seconds");
        return;
      }
      
      await onSettingsChange(timeoutValue);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save timeout");
    }
  };

  const handleResetTimeout = async () => {
    try {
      setSaveError(null);
      setTimeoutInput("300");
      await onSettingsChange(300); // Reset to 5 minutes
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to reset timeout");
    }
  };

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="claude-code-settings">
        <AccordionTrigger>
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Claude Code Configuration
          </div>
        </AccordionTrigger>
        <AccordionContent className="space-y-4">
          {/* Timeout Setting */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <Label htmlFor="timeout-input">Command Timeout</Label>
            </div>
            
            <div className="text-sm text-muted-foreground mb-2">
              Maximum time (in seconds) to wait for Claude Code commands to complete.
              Range: 30-3600 seconds (0.5-60 minutes)
            </div>
            
            <div className="flex gap-2">
              <Input
                id="timeout-input"
                type="number"
                min="30"
                max="3600"
                value={timeoutInput}
                onChange={(e) => setTimeoutInput(e.target.value)}
                placeholder="300"
                className="max-w-32"
              />
              <span className="flex items-center text-sm text-muted-foreground">
                seconds ({Math.round(parseInt(timeoutInput || "300") / 60 * 10) / 10} min)
              </span>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleSaveTimeout}
                disabled={isSaving || timeoutInput === currentTimeout.toString()}
                size="sm"
              >
                {isSaving ? "Saving..." : "Save Timeout"}
              </Button>
              
              <Button
                variant="outline"
                onClick={handleResetTimeout}
                disabled={isSaving || currentTimeout === 300}
                size="sm"
              >
                Reset to Default (5 min)
              </Button>
            </div>

            {saveError && (
              <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                {saveError}
              </div>
            )}

            <div className="text-xs text-muted-foreground mt-2">
              Current setting: {currentTimeout} seconds ({Math.round(currentTimeout / 60 * 10) / 10} minutes)
            </div>
          </div>

          {/* Info Section */}
          <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-800">
            <div className="font-medium mb-1">About Claude Code Max</div>
            <div className="space-y-1 text-xs">
              <p>• Uses Claude CLI directly for enhanced code understanding</p>
              <p>• Requires <code>claude login</code> authentication</p>
              <p>• Longer timeout allows for complex operations</p>
              <p>• Processes are automatically killed if timeout is exceeded</p>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}