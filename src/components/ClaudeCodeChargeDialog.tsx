import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CLAUDE_CODE_DYAD_CHARGE_RATIO,
  CLAUDE_CODE_UNKNOWN_MODEL_USD_PER_MILLION_TOKENS,
} from "@/shared/claude_code_pricing";

export const CLAUDE_CODE_CHARGE_DISCLOSURE =
  "Claude subscription usage and a separate Dyad charge both apply.";

interface ClaudeCodeChargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAcknowledge: () => void;
  isAcknowledging?: boolean;
}

/**
 * First-use disclosure for the Subscription backend. Using an existing Claude
 * subscription does not make Dyad execution free; this dialog states both
 * charges and the pricing rule before the first subscription-backed turn.
 */
export function ClaudeCodeChargeDialog({
  open,
  onOpenChange,
  onAcknowledge,
  isAcknowledging = false,
}: ClaudeCodeChargeDialogProps) {
  const ratioPercent = Math.round(CLAUDE_CODE_DYAD_CHARGE_RATIO * 100);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="claude-code-charge-dialog"
      >
        <DialogHeader>
          <DialogTitle>Using your Claude Code subscription in Dyad</DialogTitle>
          <DialogDescription>{CLAUDE_CODE_CHARGE_DISCLOSURE}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            Claude Code runs the model on your Anthropic subscription, so its
            usage counts against your Claude plan limits.
          </p>
          <p>
            Dyad separately charges your Dyad Pro credits for the tokens each
            turn uses:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              Models in the pricing catalog: {ratioPercent}% of the API list
              price for the measured input, cached, and output tokens.
            </li>
            <li>
              Models missing from the catalog: a flat $
              {CLAUDE_CODE_UNKNOWN_MODEL_USD_PER_MILLION_TOKENS.toFixed(2)} per
              1M tokens.
            </li>
          </ul>
          <p className="text-muted-foreground">
            Usage and estimated charges are listed under Settings → AI → Claude
            Code. Charges are calculated by Dyad's servers from the reported
            token counts.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="claude-code-charge-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={onAcknowledge}
            disabled={isAcknowledging}
            data-testid="claude-code-charge-acknowledge"
          >
            I understand, continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
