import React from "react";
import { IpcClient } from "@/ipc/ipc_client";
import { AI_STREAMING_ERROR_MESSAGE_PREFIX } from "@/shared/texts";
import {
  X,
  ExternalLink as ExternalLinkIcon,
  CircleArrowUp,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ChatErrorBox({
  onDismiss,
  error,
  isDyadProEnabled,
}: {
  onDismiss: () => void;
  error: string;
  isDyadProEnabled: boolean;
}) {
  if (error.includes("doesn't have a free quota tier")) {
    return (
      <ChatErrorContainer onDismiss={onDismiss}>
        {error}
        <span className="ml-1">
          <ExternalLink
            href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=free-quota-error"
            variant="primary"
          >
            Access with Dyad Pro
          </ExternalLink>
        </span>{" "}
        or switch to another model.
      </ChatErrorContainer>
    );
  }

  // Handle leaked API key error (403)
  if (
    error.includes("Your API key was reported as leaked") ||
    error.includes("PERMISSION_DENIED") ||
    error.includes('"code": 403')
  ) {
    return (
      <ChatErrorContainer onDismiss={onDismiss}>
        <div className="space-y-2">
          <div className="font-semibold">🔒 API Key Security Issue</div>
          <div>
            Your API key was reported as leaked and has been disabled for security reasons.
          </div>
          <div className="text-sm">
            <strong>What to do:</strong>
            <ol className="list-decimal ml-4 mt-1 space-y-1">
              <li>Generate a new API key from your provider</li>
              <li>Update the key in your environment variables</li>
              <li>Never commit API keys to version control</li>
            </ol>
          </div>
        </div>
      </ChatErrorContainer>
    );
  }

  // Handle quota exceeded error (429) - specific to Gemini
  if (
    error.includes("You exceeded your current quota") ||
    error.includes('"code": 429') ||
    error.includes("RESOURCE_EXHAUSTED") ||
    error.includes("Quota exceeded for metric")
  ) {
    // Extract retry delay if available (format: "Please retry in 37.058691744s")
    const retryMatch = error.match(/Please retry in ([\d.]+)s/);
    const retrySeconds = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : null;

    return (
      <QuotaExceededError
        onDismiss={onDismiss}
        retrySeconds={retrySeconds}
      />
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
            Upgrade to Dyad Pro
          </ExternalLink>

          <ExternalLink href="https://dyad.sh/docs/help/ai-rate-limit">
            Troubleshooting guide
          </ExternalLink>
        </div>
      </ChatErrorContainer>
    );
  }

  if (error.includes("LiteLLM Virtual Key expected")) {
    return (
      <ChatInfoContainer onDismiss={onDismiss}>
        <span>
          Looks like you don't have a valid Dyad Pro key.{" "}
          <ExternalLink
            href="https://dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=invalid-pro-key-error"
            variant="primary"
          >
            Upgrade to Dyad Pro
          </ExternalLink>{" "}
          today.
        </span>
      </ChatInfoContainer>
    );
  }
  if (isDyadProEnabled && error.includes("ExceededBudget:")) {
    return (
      <ChatInfoContainer onDismiss={onDismiss}>
        <span>
          You have used all of your Dyad AI credits this month.{" "}
          <ExternalLink
            href="https://academy.dyad.sh/subscription?utm_source=dyad-app&utm_medium=app&utm_campaign=exceeded-budget-error"
            variant="primary"
          >
            Reload or upgrade your subscription
          </ExternalLink>{" "}
          and get more AI credits
        </span>
      </ChatInfoContainer>
    );
  }
  // This is a very long list of model fallbacks that clutters the error message.
  //
  // We are matching "Fallbacks=[{" and not just "Fallbacks=" because the fallback
  // model itself can error and we want to include the fallback model error in the error message.
  // Example: https://github.com/dyad-sh/dyad/issues/1849#issuecomment-3590685911
  const fallbackPrefix = "Fallbacks=[{";
  if (error.includes(fallbackPrefix)) {
    error = error.split(fallbackPrefix)[0];
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
              Upgrade to Dyad Pro
            </ExternalLink>
          )}
        <ExternalLink href="https://www.dyad.sh/docs/faq">
          Read docs
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
      className={`${baseClasses} ${variant === "primary" ? primaryClasses : secondaryClasses
        }`}
      onClick={() => IpcClient.getInstance().openExternalUrl(href)}
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
    <div className="relative mt-2 bg-red-50 border border-red-200 rounded-md shadow-sm p-2 mx-4">
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
                        IpcClient.getInstance().openExternalUrl(props.href);
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

// Enhanced quota exceeded error with countdown and suggestions
function QuotaExceededError({
  onDismiss,
  retrySeconds,
}: {
  onDismiss: () => void;
  retrySeconds: number | null;
}) {
  const [timeLeft, setTimeLeft] = React.useState(retrySeconds);

  React.useEffect(() => {
    if (!timeLeft || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (!prev || prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  // Suggested alternative models
  const suggestedModels = [
    { name: "GPT-3.5 Turbo", provider: "OpenAI", icon: "🤖" },
    { name: "Claude 3 Haiku", provider: "Anthropic", icon: "🧠" },
    { name: "Gemini 1.5 Flash", provider: "Google", icon: "✨" },
  ];

  return (
    <ChatErrorContainer onDismiss={onDismiss}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="font-semibold text-base">⏳ API Quota Exceeded</div>
          {timeLeft && timeLeft > 0 && (
            <div className="ml-auto px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-mono">
              Reset in {formatTime(timeLeft)}
            </div>
          )}
        </div>

        <div className="text-sm">
          You've reached the rate limit for your current API plan.
        </div>

        {/* Model Suggestions */}
        <div className="space-y-2">
          <div className="text-sm font-medium">💡 Try these models instead:</div>
          <div className="grid grid-cols-1 gap-1.5">
            {suggestedModels.map((model) => (
              <button
                key={model.name}
                onClick={() => {
                  // Trigger model picker opening
                  const modelPicker = document.querySelector('[data-model-picker-trigger]');
                  if (modelPicker instanceof HTMLElement) {
                    modelPicker.click();
                  }
                }}
                className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-md hover:bg-gray-50 hover:border-gray-300 transition-colors text-left"
              >
                <span className="text-lg">{model.icon}</span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">{model.name}</div>
                  <div className="text-xs text-gray-500">{model.provider}</div>
                </div>
                <ExternalLinkIcon size={14} className="text-gray-400" />
              </button>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-red-200">
          <button
            onClick={() => {
              const modelPicker = document.querySelector('[data-model-picker-trigger]');
              if (modelPicker instanceof HTMLElement) {
                modelPicker.click();
              }
            }}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Open Model Picker
          </button>
          {timeLeft && timeLeft > 0 && (
            <div className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-md text-sm">
              Wait {formatTime(timeLeft)}
            </div>
          )}
        </div>
      </div>
    </ChatErrorContainer>
  );
}
