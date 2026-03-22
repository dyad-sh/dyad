/**
 * Email Compose Dialog
 *
 * Full compose experience with AI-powered writing, tone adjustment,
 * and smart suggestions.
 */

import { useState, useCallback } from "react";
import {
  X,
  Send,
  Sparkles,
  ChevronDown,
  Paperclip,
  Minus,
  Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useSendEmail,
  useSaveDraft,
  useComposeEmail,
  useAdjustTone,
  useEmailAccounts,
} from "@/hooks/useEmail";
import type { EmailDraft, EmailAddress, EmailMessage } from "@/types/email_types";

interface EmailComposeProps {
  accountId: string;
  replyTo?: EmailMessage;
  forwardMsg?: EmailMessage;
  onClose: () => void;
}

export function EmailCompose({
  accountId,
  replyTo,
  forwardMsg,
  onClose,
}: EmailComposeProps) {
  const { data: accounts = [] } = useEmailAccounts();
  const sendEmail = useSendEmail();
  const saveDraft = useSaveDraft();
  const composeAi = useComposeEmail();
  const adjustTone = useAdjustTone();

  const [selectedAccount, setSelectedAccount] = useState(accountId);
  const [to, setTo] = useState(
    replyTo ? replyTo.from?.address ?? "" : "",
  );
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(() => {
    if (replyTo) return `Re: ${replyTo.subject}`;
    if (forwardMsg) return `Fwd: ${forwardMsg.subject}`;
    return "";
  });
  const [body, setBody] = useState(() => {
    if (forwardMsg) {
      return `\n\n---------- Forwarded message ----------\nFrom: ${forwardMsg.from?.address}\nSubject: ${forwardMsg.subject}\n\n${forwardMsg.bodyPlain ?? forwardMsg.snippet}`;
    }
    return "";
  });
  const [aiPrompt, setAiPrompt] = useState("");
  const [showAi, setShowAi] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const parseAddresses = (raw: string): EmailAddress[] =>
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((address) => ({ address }));

  const buildDraft = useCallback((): EmailDraft => ({
    accountId: selectedAccount,
    to: parseAddresses(to),
    cc: parseAddresses(cc),
    bcc: parseAddresses(bcc),
    subject,
    body,
    inReplyTo: replyTo?.remoteId,
    aiGenerated: false,
  }), [selectedAccount, to, cc, bcc, subject, body, replyTo]);

  const handleSend = () => {
    const draft = buildDraft();
    sendEmail.mutate(
      { accountId: selectedAccount, draft },
      { onSuccess: () => onClose() },
    );
  };

  const handleSaveDraft = () => {
    saveDraft.mutate(buildDraft());
  };

  const handleAiCompose = () => {
    if (!aiPrompt.trim()) return;
    composeAi.mutate(
      {
        accountId: selectedAccount,
        request: {
          instruction: aiPrompt,
          context: replyTo
            ? {
                replyToMessageId: replyTo.id,
                threadMessages: [replyTo],
              }
            : undefined,
        },
      },
      {
        onSuccess: (draft) => {
          if (draft.to?.length) setTo(draft.to.map((a) => a.address).join(", "));
          if (draft.subject) setSubject(draft.subject);
          setBody(draft.body);
        },
      },
    );
  };

  const handleToneChange = (tone: "formal" | "casual" | "friendly" | "urgent") => {
    adjustTone.mutate(
      { draft: buildDraft(), tone },
      {
        onSuccess: (adjusted) => {
          setBody(adjusted.body);
        },
      },
    );
  };

  if (isMinimized) {
    return (
      <div className="fixed bottom-0 right-4 z-50 w-72 rounded-t-lg border border-border bg-background shadow-lg">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-medium truncate">
            {subject || "New Message"}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsMinimized(false)}
            >
              <Maximize2 className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onClose}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 right-4 z-50 flex w-[560px] flex-col rounded-t-lg border border-border bg-background shadow-xl max-h-[80vh]">
      {/* Title Bar */}
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2 bg-muted/30">
        <span className="text-sm font-medium">
          {replyTo ? "Reply" : forwardMsg ? "Forward" : "New Message"}
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setIsMinimized(true)}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => {
              handleSaveDraft();
              onClose();
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-1 px-3 pt-2">
        {accounts.length > 1 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="w-10 text-muted-foreground">From</span>
            <select
              className="flex-1 bg-transparent border-none text-sm outline-none"
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName} ({a.email as string})
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="w-10 text-xs text-muted-foreground">To</span>
          <Input
            className="h-7 border-none text-sm shadow-none focus-visible:ring-0 px-0"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@email.com"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-10 text-xs text-muted-foreground">Cc</span>
          <Input
            className="h-7 border-none text-sm shadow-none focus-visible:ring-0 px-0"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-10 text-xs text-muted-foreground">Subject</span>
          <Input
            className="h-7 border-none text-sm shadow-none focus-visible:ring-0 px-0 font-medium"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
      </div>

      <div className="border-t border-border/30 mt-1" />

      {/* Body */}
      <Textarea
        className="flex-1 min-h-[200px] resize-none border-none text-sm shadow-none focus-visible:ring-0 rounded-none px-3"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write your message..."
      />

      {/* AI Bar */}
      {showAi && (
        <div className="border-t border-border/30 px-3 py-2 bg-muted/20 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <Input
              className="h-7 text-xs flex-1"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Describe what you want to write..."
              onKeyDown={(e) => e.key === "Enter" && handleAiCompose()}
            />
            <Button
              variant="secondary"
              size="sm"
              className="h-7 text-xs"
              disabled={composeAi.isPending || !aiPrompt.trim()}
              onClick={handleAiCompose}
            >
              {composeAi.isPending ? "Writing..." : "Generate"}
            </Button>
          </div>
          <div className="flex gap-1">
            <span className="text-[10px] text-muted-foreground mr-1">Tone:</span>
            {(["formal", "casual", "friendly", "urgent"] as const).map((tone) => (
              <Badge
                key={tone}
                variant="outline"
                className="text-[9px] cursor-pointer hover:bg-muted/50"
                onClick={() => handleToneChange(tone)}
              >
                {tone}
              </Badge>
            ))}
            {adjustTone.isPending && (
              <span className="text-[10px] text-muted-foreground animate-pulse">
                Adjusting...
              </span>
            )}
          </div>
        </div>
      )}

      {/* Action Bar */}
      <div className="flex items-center gap-2 border-t border-border/50 px-3 py-2">
        <Button
          size="sm"
          className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={handleSend}
          disabled={sendEmail.isPending || !to.trim()}
        >
          <Send className="h-3 w-3" />
          {sendEmail.isPending ? "Sending..." : "Send"}
        </Button>
        <Button
          variant={showAi ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => setShowAi((p) => !p)}
        >
          <Sparkles className="h-3 w-3" />
          AI Write
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={handleSaveDraft}
        >
          Save draft
        </Button>
      </div>
    </div>
  );
}
