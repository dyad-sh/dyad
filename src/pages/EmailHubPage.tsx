/**
 * Email Hub Page
 *
 * Main 3-column layout for the Email Agent system:
 *   Left: Folder sidebar with accounts & folders
 *   Center: Message list for the selected folder
 *   Right: Message viewer / Daily Digest / Agent Queue
 */

import { useState, useCallback } from "react";
import { Mail, Bot, Newspaper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEmailAccounts,
  useEmailSyncEvents,
  useEmailPendingActionEvents,
} from "@/hooks/useEmail";
import { EmailFolderSidebar } from "@/pages/email/EmailFolderSidebar";
import { EmailMessageList } from "@/pages/email/EmailMessageList";
import { EmailMessageView } from "@/pages/email/EmailMessageView";
import { EmailCompose } from "@/pages/email/EmailCompose";
import { AccountSetupDialog } from "@/pages/email/AccountSetupDialog";
import { DailyDigestPanel } from "@/pages/email/DailyDigestPanel";
import { AgentActionQueue } from "@/pages/email/AgentActionQueue";
import type { EmailMessage } from "@/types/email_types";

type RightPanel = "message" | "digest" | "agent";

interface ComposeState {
  open: boolean;
  mode: "new" | "reply" | "forward";
  replyTo?: EmailMessage;
  forwardMsg?: EmailMessage;
}

export function EmailHubPage() {
  // ── selection state ──
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string>("INBOX");
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);

  // ── panel state ──
  const [rightPanel, setRightPanel] = useState<RightPanel>("message");
  const [showAccountSetup, setShowAccountSetup] = useState(false);
  const [compose, setCompose] = useState<ComposeState>({
    open: false,
    mode: "new",
  });

  // ── accounts ──
  const { data: accounts = [] } = useEmailAccounts();
  const defaultAccountId = accounts[0]?.id ?? "";
  const queryClient = useQueryClient();

  // ── real-time sync events ──
  useEmailSyncEvents(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ["email"] });
    }, [queryClient]),
  );
  useEmailPendingActionEvents(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ["email", "pending-actions"] });
    }, [queryClient]),
  );

  // ── folder sidebar callbacks ──
  const handleSelectFolder = useCallback(
    (folder: string, accountId: string) => {
      setSelectedFolder(folder);
      setSelectedAccountId(accountId);
      setSelectedMessageId(null);
      setRightPanel("message");
    },
    [],
  );

  const handleSelectAccount = useCallback((accountId: string | null) => {
    setSelectedAccountId(accountId);
    setSelectedMessageId(null);
  }, []);

  // ── compose callbacks ──
  const handleNewCompose = useCallback(() => {
    setCompose({ open: true, mode: "new" });
  }, []);

  const handleReply = useCallback((msg: EmailMessage) => {
    setCompose({ open: true, mode: "reply", replyTo: msg });
  }, []);

  const handleForward = useCallback((msg: EmailMessage) => {
    setCompose({ open: true, mode: "forward", forwardMsg: msg });
  }, []);

  const handleCloseCompose = useCallback(() => {
    setCompose({ open: false, mode: "new" });
  }, []);

  // ── active account for compose / panels ──
  const activeAccountId = selectedAccountId ?? defaultAccountId;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-emerald-500" />
          <h1 className="text-base font-semibold">Email Hub</h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Right panel tabs */}
          <Tabs
            value={rightPanel}
            onValueChange={(v) => setRightPanel(v as RightPanel)}
          >
            <TabsList className="h-7">
              <TabsTrigger value="message" className="h-6 px-2 text-xs">
                <Mail className="mr-1 h-3 w-3" />
                Message
              </TabsTrigger>
              <TabsTrigger value="digest" className="h-6 px-2 text-xs">
                <Newspaper className="mr-1 h-3 w-3" />
                Digest
              </TabsTrigger>
              <TabsTrigger value="agent" className="h-6 px-2 text-xs">
                <Bot className="mr-1 h-3 w-3" />
                Agent
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            size="sm"
            className="h-7 bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700"
            onClick={handleNewCompose}
          >
            Compose
          </Button>
        </div>
      </div>

      {/* 3-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Folder sidebar */}
        <div className="w-56 shrink-0 border-r border-border/40">
          <EmailFolderSidebar
            selectedAccountId={selectedAccountId}
            selectedFolder={selectedFolder}
            onSelectAccount={handleSelectAccount}
            onSelectFolder={handleSelectFolder}
            onAddAccount={() => setShowAccountSetup(true)}
            onManageAccounts={() => setShowAccountSetup(true)}
          />
        </div>

        {/* Center: Message list */}
        <div className="w-80 shrink-0 border-r border-border/40">
          <EmailMessageList
            accountId={selectedAccountId}
            folder={selectedFolder}
            selectedMessageId={selectedMessageId}
            onSelectMessage={(id) => {
              setSelectedMessageId(id);
              setRightPanel("message");
            }}
          />
        </div>

        {/* Right: Message view / Digest / Agent */}
        <div className="flex-1 overflow-hidden">
          {rightPanel === "message" && (
            <EmailMessageView
              messageId={selectedMessageId}
              onReply={handleReply}
              onForward={handleForward}
            />
          )}
          {rightPanel === "digest" && activeAccountId && (
            <DailyDigestPanel accountId={activeAccountId} />
          )}
          {rightPanel === "agent" && activeAccountId && (
            <AgentActionQueue accountId={activeAccountId} />
          )}
        </div>
      </div>

      {/* Compose dialog */}
      {compose.open && activeAccountId && (
        <EmailCompose
          accountId={activeAccountId}
          replyTo={compose.replyTo}
          forwardMsg={compose.forwardMsg}
          onClose={handleCloseCompose}
        />
      )}

      {/* Account setup dialog */}
      <AccountSetupDialog
        open={showAccountSetup}
        onClose={() => setShowAccountSetup(false)}
      />
    </div>
  );
}
