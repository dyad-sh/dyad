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

  // Important, this needs to come after the "free quota tier" check
  // because it also includes this URL in the error message
  if (
    error.includes("Resource has been exhausted") ||
    error.includes("https://ai.google.dev/gemini-api/docs/rate-limits") ||
    error.includes("Provider returned error")
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
  if (error.includes("Fallbacks=")) {
    error = error.split("Fallbacks=")[0];
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
      className={`${baseClasses} ${
        variant === "primary" ? primaryClasses : secondaryClasses
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
