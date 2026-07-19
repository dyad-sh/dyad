import { useAtomValue } from "jotai";
import { RefreshCw, Sparkles } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { chatMessagesByIdAtom, isStreamingByIdAtom } from "@/atoms/chatAtoms";
import { DyadProTrialDialog } from "@/components/DyadProTrialDialog";
import { useSettings } from "@/hooks/useSettings";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { ipc, type UserBudgetInfo } from "@/ipc/types";
import { hasDyadProKey, type UserSettings } from "@/lib/schemas";
import { cn } from "@/lib/utils";

export interface PromoMessageConfig {
  /** Stable id used for the promo_click event and UTM attribution. */
  id: string;
  /** Pro promos open the in-app trial dialog; community tips open an external URL. */
  target: { type: "trial-dialog" } | { type: "url"; url: string };
  /** Relative frequency in the rotation. */
  weight: number;
}

export const PROMO_MESSAGES: PromoMessageConfig[] = [
  {
    id: "pro-trial",
    target: { type: "trial-dialog" },
    weight: 3,
  },
  {
    id: "agent-mode",
    target: { type: "trial-dialog" },
    weight: 3,
  },
  {
    id: "custom-theme",
    target: { type: "trial-dialog" },
    weight: 2,
  },
  {
    id: "speech-to-text",
    target: { type: "trial-dialog" },
    weight: 3,
  },
  {
    id: "web-search",
    target: { type: "trial-dialog" },
    weight: 2,
  },
  {
    id: "pro-tools",
    target: { type: "trial-dialog" },
    weight: 2,
  },
  {
    id: "all-models",
    target: { type: "trial-dialog" },
    weight: 3,
  },
  {
    id: "github-star",
    target: { type: "url", url: "https://github.com/dyad-sh/dyad" },
    weight: 1,
  },
  {
    id: "reddit",
    target: { type: "url", url: "https://www.reddit.com/r/dyadbuilders/" },
    weight: 1,
  },
  {
    id: "follow-x",
    target: { type: "url", url: "https://x.com/dyad_sh" },
    weight: 0.5,
  },
];

const SHOW_PROMO_DEV_CYCLE =
  (import.meta as { env?: { MODE?: string } }).env?.MODE === "development";

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

export function shouldShowPromoMessage({
  promoSeed,
  settings,
  userBudget,
  messagesLength,
}: {
  promoSeed: number | null;
  settings: UserSettings | null | undefined;
  userBudget: UserBudgetInfo | undefined;
  messagesLength: number;
}) {
  const hasProKey = settings ? hasDyadProKey(settings) : false;
  return (
    promoSeed !== null &&
    !settings?.isTestMode &&
    !hasProKey &&
    !userBudget &&
    messagesLength > 0
  );
}

export interface PromoMessageState {
  visible: boolean;
  seed: number;
}

/**
 * Tracks which promo (if any) to show for a chat. A promo is picked when a
 * stream starts and kept after it ends, so users have a chance to act on it
 * once their attention returns to the composer. A new stream rotates to a
 * new promo. Exposed as a hook so the composer can drop its top corners
 * while the promo cap row is visible.
 */
export function usePromoMessage(chatId?: number): PromoMessageState {
  const { settings } = useSettings();
  const { userBudget } = useUserBudgetInfo();
  const appId = useAtomValue(selectedAppIdAtom);
  const messagesById = useAtomValue(chatMessagesByIdAtom);
  const isStreamingById = useAtomValue(isStreamingByIdAtom);

  const messagesLength =
    chatId !== undefined ? (messagesById.get(chatId)?.length ?? 0) : 0;
  const isStreaming =
    chatId !== undefined ? (isStreamingById.get(chatId) ?? false) : false;

  const [activePromo, setActivePromo] = useState<{
    chatId: number | null;
    seed: number;
  } | null>(null);
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (isStreaming && !wasStreamingRef.current) {
      setActivePromo({
        chatId: chatId ?? null,
        seed: messagesLength * (appId ?? 1) * (chatId ?? 1),
      });
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, chatId, appId, messagesLength]);

  const promoSeed =
    activePromo && activePromo.chatId === (chatId ?? null)
      ? activePromo.seed
      : null;

  return {
    visible: shouldShowPromoMessage({
      promoSeed,
      settings,
      userBudget,
      messagesLength,
    }),
    seed: promoSeed ?? 0,
  };
}

/**
 * Promo rendered as a quiet "cap" row fused to the top of the chat composer,
 * mirroring the ContextLimitBanner pattern: rounded top corners here, and the
 * composer drops its own top border and corners while this is visible.
 */
export function PromoMessage({ seed }: { seed: number }) {
  const { t } = useTranslation("chat");
  const posthog = usePostHog();
  const [isTrialDialogOpen, setIsTrialDialogOpen] = useState(false);
  const [devMessageIndex, setDevMessageIndex] = useState<number | null>(null);

  useEffect(() => {
    setDevMessageIndex(null);
  }, [seed]);

  const message =
    devMessageIndex === null
      ? pickPromoMessage(seed)
      : PROMO_MESSAGES[devMessageIndex];
  const promoCopyById: Record<string, { text: string; cta: string }> = {
    "pro-trial": {
      text: t("promoMessages.pro-trial.text"),
      cta: t("promoMessages.pro-trial.cta"),
    },
    "agent-mode": {
      text: t("promoMessages.agent-mode.text"),
      cta: t("promoMessages.agent-mode.cta"),
    },
    "custom-theme": {
      text: t("promoMessages.custom-theme.text"),
      cta: t("promoMessages.custom-theme.cta"),
    },
    "speech-to-text": {
      text: t("promoMessages.speech-to-text.text"),
      cta: t("promoMessages.speech-to-text.cta"),
    },
    "web-search": {
      text: t("promoMessages.web-search.text"),
      cta: t("promoMessages.web-search.cta"),
    },
    "pro-tools": {
      text: t("promoMessages.pro-tools.text"),
      cta: t("promoMessages.pro-tools.cta"),
    },
    "all-models": {
      text: t("promoMessages.all-models.text"),
      cta: t("promoMessages.all-models.cta"),
    },
    "github-star": {
      text: t("promoMessages.github-star.text"),
      cta: t("promoMessages.github-star.cta"),
    },
    reddit: {
      text: t("promoMessages.reddit.text"),
      cta: t("promoMessages.reddit.cta"),
    },
    "follow-x": {
      text: t("promoMessages.follow-x.text"),
      cta: t("promoMessages.follow-x.cta"),
    },
  };
  const promoCopy = promoCopyById[message.id] ?? {
    text: t("promoMessages.pro-trial.text"),
    cta: t("promoMessages.pro-trial.cta"),
  };
  const isProPromo = message.target.type === "trial-dialog";

  const handleCtaClick = () => {
    posthog?.capture("promo_click", { messageId: message.id });
    if (message.target.type === "trial-dialog") {
      setIsTrialDialogOpen(true);
    } else {
      ipc.system.openExternalUrl(message.target.url);
    }
  };

  const handleDevCycle = () => {
    setDevMessageIndex((currentIndex) => {
      if (currentIndex !== null) {
        return (currentIndex + 1) % PROMO_MESSAGES.length;
      }
      const pickedIndex = PROMO_MESSAGES.findIndex(
        (promo) => promo.id === message.id,
      );
      return (pickedIndex + 1) % PROMO_MESSAGES.length;
    });
  };

  return (
    <>
      <div
        data-testid="promo-message"
        className="flex items-center gap-2 rounded-t-2xl border-t border-l border-r border-border bg-muted/30 py-1.5 pl-3 pr-1.5 text-[13px] animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
      >
        {isProPromo && (
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
        )}
        <span className="flex-1 min-w-0 truncate text-muted-foreground">
          {promoCopy.text}
        </span>
        <button
          type="button"
          data-testid="promo-cta"
          onClick={handleCtaClick}
          className={cn(
            "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 font-medium transition-colors",
            isProPromo
              ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
              : "border-border bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {promoCopy.cta}
        </button>
        {SHOW_PROMO_DEV_CYCLE && (
          <button
            type="button"
            aria-label={t("cyclePromoMessage")}
            title={t("cyclePromoMessage")}
            onClick={handleDevCycle}
            className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
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
