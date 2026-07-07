import { X } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";

import { DyadProTrialDialog } from "@/components/DyadProTrialDialog";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/types";

export interface PromoMessageConfig {
  /** Stable id used for the promo_click event and UTM attribution. */
  id: string;
  text: string;
  cta: string;
  /** Pro promos open the in-app trial dialog; community tips open an external URL. */
  target: { type: "trial-dialog" } | { type: "url"; url: string };
  /** Relative frequency in the rotation. */
  weight: number;
}

export const PROMO_MESSAGES: PromoMessageConfig[] = [
  {
    id: "pro-trial",
    text: "Build more with Dyad Pro — free for 3 days.",
    cta: "Start Free Trial",
    target: { type: "trial-dialog" },
    weight: 3,
  },
  {
    id: "agent-mode",
    text: "Dyad Pro's Agent mode automatically debugs your app.",
    cta: "Try Agent Mode",
    target: { type: "trial-dialog" },
    weight: 3,
  },
  {
    id: "pro-tools",
    text: "Clone websites, search the web, and generate images with Pro tools.",
    cta: "Unlock Pro Tools",
    target: { type: "trial-dialog" },
    weight: 3,
  },
  {
    id: "all-models",
    text: "Access all the leading AI models in one subscription.",
    cta: "Get Dyad Pro",
    target: { type: "trial-dialog" },
    weight: 3,
  },
  {
    id: "github-star",
    text: "Enjoying Dyad? Star us on GitHub.",
    cta: "Star on GitHub",
    target: { type: "url", url: "https://github.com/dyad-sh/dyad" },
    weight: 1,
  },
  {
    id: "reddit",
    text: "Join 600+ builders in the Dyad subreddit.",
    cta: "Join r/dyadbuilders",
    target: { type: "url", url: "https://www.reddit.com/r/dyadbuilders/" },
    weight: 1,
  },
  {
    id: "follow-x",
    text: "Follow Dyad on X for tips and updates.",
    cta: "Follow @dyad_sh",
    target: { type: "url", url: "https://x.com/dyad_sh" },
    weight: 1,
  },
];

export function pickPromoMessage(seed: number): PromoMessageConfig {
  const totalWeight = PROMO_MESSAGES.reduce(
    (sum, message) => sum + message.weight,
    0,
  );
  let remaining = hashNumber(seed) % totalWeight;
  for (const message of PROMO_MESSAGES) {
    remaining -= message.weight;
    if (remaining < 0) {
      return message;
    }
  }
  return PROMO_MESSAGES[0];
}

const PROMO_DISMISSED_AT_KEY = "dyadPromoDismissedAt";
const PROMO_DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function isPromoDismissed(): boolean {
  try {
    const dismissedAt = Number(localStorage.getItem(PROMO_DISMISSED_AT_KEY));
    return (
      Number.isFinite(dismissedAt) &&
      dismissedAt > 0 &&
      Date.now() - dismissedAt < PROMO_DISMISS_DURATION_MS
    );
  } catch {
    return false;
  }
}

export function PromoMessage({ seed }: { seed: number }) {
  const posthog = usePostHog();
  const [dismissed, setDismissed] = useState(isPromoDismissed);
  const [isTrialDialogOpen, setIsTrialDialogOpen] = useState(false);

  if (dismissed) {
    return null;
  }

  const message = pickPromoMessage(seed);

  const handleCtaClick = () => {
    posthog?.capture("promo_click", { messageId: message.id });
    if (message.target.type === "trial-dialog") {
      setIsTrialDialogOpen(true);
    } else {
      ipc.system.openExternalUrl(message.target.url);
    }
  };

  const handleDismiss = () => {
    try {
      localStorage.setItem(PROMO_DISMISSED_AT_KEY, String(Date.now()));
    } catch {
      // localStorage unavailable — still hide for this session.
    }
    setDismissed(true);
  };

  return (
    <>
      <div
        data-testid="promo-message"
        className="max-w-3xl mx-auto mt-4 flex items-center justify-center gap-3 rounded-lg border border-border bg-muted/50 py-2 pl-4 pr-2"
      >
        <p className="text-sm text-foreground">{message.text}</p>
        <Button
          size="sm"
          variant={
            message.target.type === "trial-dialog" ? "default" : "outline"
          }
          className="shrink-0"
          onClick={handleCtaClick}
        >
          {message.cta}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
          title="Hide for a week"
          onClick={handleDismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <DyadProTrialDialog
        isOpen={isTrialDialogOpen}
        onClose={() => setIsTrialDialogOpen(false)}
        utmCampaign={`streaming-promo-${message.id}`}
      />
    </>
  );
}

/**
 * Hashes a 32-bit integer using a variant of the MurmurHash3 algorithm.
 * This function is designed to produce a good, random-like distribution
 * of hash values, which is crucial for data structures like hash tables.
 * @param {number} key - The integer to hash.
 * @returns {number} A 32-bit integer hash.
 */
function hashNumber(key: number): number {
  // Ensure the key is treated as an integer.
  let i = key | 0;

  // MurmurHash3's mixing function (fmix32)
  // It uses a series of bitwise multiplications, shifts, and XORs
  // to thoroughly mix the bits of the input key.

  // XOR with a shifted version of itself to start mixing bits.
  i ^= i >>> 16;
  // Multiply by a large prime to further scramble bits.
  i = Math.imul(i, 0x85ebca6b);
  // Another XOR shift.
  i ^= i >>> 13;
  // Another prime multiplication.
  i = Math.imul(i, 0xc2b2ae35);
  // Final XOR shift to get the final mix.
  i ^= i >>> 16;

  // Return the result as an unsigned 32-bit integer.
  return i >>> 0;
}
