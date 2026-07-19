import { ipc } from "@/ipc/types";
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import { useFreeModelQuota } from "@/hooks/useFreeModelQuota";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { AI_STREAMING_ERROR_MESSAGE_PREFIX } from "@/shared/texts";
import {
  X,
  ExternalLink as ExternalLinkIcon,
  CircleArrowUp,
  MessageSquarePlus,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { formatTime } from "@/i18n/format";

export function ChatErrorBox({
  onDismiss,
  error,
  isDyadProEnabled,
  onStartNewChat,
}: {
  onDismiss: () => void;
  error: string;
  isDyadProEnabled: boolean;
  onStartNewChat?: () => void;
}) {
  const { t, i18n } = useTranslation("chat");
  const fallbackPrefix = "Fallbacks=[{";
  const normalizedError = error.includes(fallbackPrefix)
    ? error.split(fallbackPrefix)[0]
    : error;
  const isFreeModelQuotaError =
    normalizedError.includes("dyad_free_model_quota_exceeded") ||
    normalizedError.includes("FREE_MODEL_QUOTA_EXCEEDED") ||
    normalizedError.includes("Dyad Free has reached its daily limit.") ||
    normalizedError.includes("Dyad Free limit");
  const { messagesLimit } = useFreeAgentQuota();
  const {
    messagesLimit: freeModelMessagesLimit,
    resetTime: freeModelResetTime,
  } = useFreeModelQuota({ enabled: isFreeModelQuotaError });
  const { userBudget } = useUserBudgetInfo();
  // Trial Pro users cannot use the Free model (it is hidden from the picker and
  // rejected by the engine), so don't suggest it to them.
  const isTrialProUser = userBudget?.isTrial === true;

  if (error.includes("doesn't have a free quota tier")) {
    return (
      <ChatErrorContainer onDismiss={onDismiss}>
        {error}
        <span className="ml-1">
          <ExternalLink
            href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=free-quota-error"
            variant="primary"
          >
            {t("errorBox.accessWithDyadPro")}
          </ExternalLink>
        </span>{" "}
        {t("errorBox.orSwitchModel")}
      </ChatErrorContainer>
    );
  }

  // Important, this needs to come after the "free quota tier" check
  // because it also includes this URL in the error message
  //
  // Sometimes Dyad Pro can return rate limit errors and we do not want to
  // show the upgrade to Dyad Pro link in that case because they are
  // already on the Dyad Pro plan.
  if (
    !isDyadProEnabled &&
    (error.includes("Resource has been exhausted") ||
      error.includes("https://ai.google.dev/gemini-api/docs/rate-limits") ||
      error.includes("Provider returned error"))
  ) {
    return (
      <ChatErrorContainer onDismiss={onDismiss}>
        {error}
        <div className="mt-2 space-y-2 space-x-2">
          <ExternalLink
            href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=rate-limit-error"
            variant="primary"
          >
            {t("errorBox.upgradeToDyadPro")}
          </ExternalLink>

          <ExternalLink href="https://dyad.sh/docs/help/ai-rate-limit">
            {t("errorBox.troubleshootingGuide")}
          </ExternalLink>
        </div>
      </ChatErrorContainer>
    );
  }

  if (error.includes("LiteLLM Virtual Key expected")) {
    return (
      <ChatInfoContainer onDismiss={onDismiss}>
        <span>
          {t("errorBox.invalidProKey")}{" "}
          <ExternalLink
            href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=invalid-pro-key-error"
            variant="primary"
          >
            {t("errorBox.upgradeToDyadPro")}
          </ExternalLink>{" "}
          {t("errorBox.today")}
        </span>
      </ChatInfoContainer>
    );
  }
  if (isDyadProEnabled && error.includes("ExceededBudget:")) {
    return (
      <ChatInfoContainer onDismiss={onDismiss}>
        <span>
          {t("errorBox.creditsUsed")}{" "}
          {!isTrialProUser && (
            <>
              {t("errorBox.switchToFreeModel", {
                count: freeModelMessagesLimit,
              })}{" "}
            </>
          )}
          <ExternalLink
            href="https://academy.dyad.sh/subscription?utm_source=dyad-app&utm_medium=app&utm_campaign=exceeded-budget-error"
            variant="primary"
          >
            {t("errorBox.getMoreCredits")}
          </ExternalLink>
        </span>
      </ChatInfoContainer>
    );
  }
  // This is a very long list of model fallbacks that clutters the error message.
  //
  // We are matching "Fallbacks=[{" and not just "Fallbacks=" because the fallback
  // model itself can error and we want to include the fallback model error in the error message.
  // Example: https://github.com/dyad-sh/dyad/issues/1849#issuecomment-3590685911
  if (error.includes(fallbackPrefix)) {
    error = normalizedError;
  }
  // Handle FREE_AGENT_QUOTA_EXCEEDED error (Basic Agent mode quota exceeded)
  if (error.includes("FREE_AGENT_QUOTA_EXCEEDED")) {
    return (
      <ChatErrorContainer onDismiss={onDismiss}>
        {t("errorBox.freeAgentQuota", { count: messagesLimit })}
        <div className="mt-2 space-y-2 space-x-2">
          <ExternalLink
            href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=free-agent-quota-exceeded"
            variant="primary"
          >
            {t("errorBox.upgradeToDyadPro")}
          </ExternalLink>
        </div>
      </ChatErrorContainer>
    );
  }

  if (isFreeModelQuotaError) {
    const resetTime = freeModelResetTime
      ? formatTime(new Date(freeModelResetTime), i18n.language, {
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        })
      : null;

    return (
      <ChatErrorContainer onDismiss={onDismiss}>
        <span>
          {t(
            resetTime
              ? "errorBox.freeModelQuotaWithReset"
              : "errorBox.freeModelQuota",
            { count: freeModelMessagesLimit, resetTime: resetTime ?? "" },
          )}{" "}
          <ExternalLink
            href="https://academy.dyad.sh/subscription?utm_source=dyad-app&utm_medium=app&utm_campaign=exceeded-budget-error"
            variant="primary"
          >
            {t("errorBox.getMoreCredits")}
          </ExternalLink>
        </span>
      </ChatErrorContainer>
    );
  }

  return (
    <ChatErrorContainer onDismiss={onDismiss}>
      {error}
      <div className="mt-2 space-y-2 space-x-2">
        {!isDyadProEnabled &&
          error.includes(AI_STREAMING_ERROR_MESSAGE_PREFIX) &&
          !error.includes("TypeError: terminated") && (
            <ExternalLink
              href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=general-error"
              variant="primary"
            >
              {t("errorBox.upgradeToDyadPro")}
            </ExternalLink>
          )}
        {isDyadProEnabled && onStartNewChat && (
          <Tooltip>
            <TooltipTrigger
              onClick={onStartNewChat}
              className="cursor-pointer inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500"
            >
              <span>{t("errorBox.startNewChat")}</span>
              <MessageSquarePlus size={18} />
            </TooltipTrigger>
            <TooltipContent>{t("errorBox.newChatTip")}</TooltipContent>
          </Tooltip>
        )}
        <ExternalLink href="https://www.dyad.sh/docs/faq">
          {t("errorBox.readDocs")}
        </ExternalLink>
      </div>
    </ChatErrorContainer>
  );
}

function ExternalLink({
  href,
  children,
  variant = "secondary",
  icon,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  icon?: React.ReactNode;
}) {
  const baseClasses =
    "cursor-pointer inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium shadow-sm focus:outline-none focus:ring-2";
  const primaryClasses =
    "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500";
  const secondaryClasses =
    "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 focus:ring-blue-200";
  const iconElement =
    icon ??
    (variant === "primary" ? (
      <CircleArrowUp size={18} />
    ) : (
      <ExternalLinkIcon size={14} />
    ));

  return (
    <a
      className={`${baseClasses} ${variant === "primary" ? primaryClasses : secondaryClasses}`}
      onClick={() => ipc.system.openExternalUrl(href)}
    >
      <span>{children}</span>
      {iconElement}
    </a>
  );
}

function ChatErrorContainer({
  onDismiss,
  children,
}: {
  onDismiss: () => void;
  children: React.ReactNode | string;
}) {
  return (
    <div
      data-testid="chat-error-box"
      className="relative mt-2 bg-red-50 border border-red-200 rounded-md shadow-sm p-2 mx-4"
    >
      <button
        onClick={onDismiss}
        className="absolute top-2.5 left-2 p-1 hover:bg-red-100 rounded"
      >
        <X size={14} className="text-red-500" />
      </button>
      <div className="pl-8 py-1 text-sm">
        <div className="text-red-700 text-wrap">
          {typeof children === "string" ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ children: linkChildren, ...props }) => (
                  <a
                    {...props}
                    onClick={(e) => {
                      e.preventDefault();
                      if (props.href) {
                        ipc.system.openExternalUrl(props.href);
                      }
                    }}
                    className="text-blue-500 hover:text-blue-700"
                  >
                    {linkChildren}
                  </a>
                ),
              }}
            >
              {children}
            </ReactMarkdown>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}

function ChatInfoContainer({
  onDismiss,
  children,
}: {
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative mt-2 bg-sky-50 border border-sky-200 rounded-md shadow-sm p-2 mx-4">
      <button
        onClick={onDismiss}
        className="absolute top-2.5 left-2 p-1 hover:bg-sky-100 rounded"
      >
        <X size={14} className="text-sky-600" />
      </button>
      <div className="pl-8 py-1 text-sm">
        <div className="text-sky-800 text-wrap">{children}</div>
      </div>
    </div>
  );
}
