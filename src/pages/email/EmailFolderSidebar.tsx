/**
 * Email Folder Sidebar
 *
 * Left column showing folder tree per account, with unread badges.
 */

import { useState } from "react";
import {
  Inbox,
  Send,
  FileEdit,
  Trash2,
  AlertTriangle,
  Archive,
  Star,
  Folder,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Plus,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useEmailAccounts,
  useEmailFolders,
  useSyncNow,
  useEmailStats,
} from "@/hooks/useEmail";
import type { EmailFolder, EmailFolderType } from "@/types/email_types";

const FOLDER_ICONS: Record<EmailFolderType, typeof Inbox> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileEdit,
  trash: Trash2,
  spam: AlertTriangle,
  archive: Archive,
  starred: Star,
  custom: Folder,
};

const FOLDER_ORDER: EmailFolderType[] = [
  "inbox",
  "starred",
  "sent",
  "drafts",
  "archive",
  "spam",
  "trash",
  "custom",
];

interface EmailFolderSidebarProps {
  selectedAccountId: string | null;
  selectedFolder: string | null;
  onSelectAccount: (accountId: string | null) => void;
  onSelectFolder: (folder: string, accountId: string) => void;
  onAddAccount: () => void;
  onManageAccounts: () => void;
}

export function EmailFolderSidebar({
  selectedAccountId,
  selectedFolder,
  onSelectAccount,
  onSelectFolder,
  onAddAccount,
  onManageAccounts,
}: EmailFolderSidebarProps) {
  const { data: accounts = [] } = useEmailAccounts();
  const syncNow = useSyncNow();
  const { data: stats } = useEmailStats();
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(
    new Set(),
  );

  const toggleAccount = (id: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    onSelectAccount(id);
  };

  return (
    <div className="flex h-full flex-col border-r border-border/50 bg-background/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <span className="text-sm font-semibold text-foreground/80">Mail</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onAddAccount}
            title="Add account"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onManageAccounts}
            title="Settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5 text-xs text-muted-foreground">
          <span>{stats.unread} unread</span>
          <span>·</span>
          <span>{stats.total} total</span>
        </div>
      )}

      {/* Unified Inbox */}
      <button
        type="button"
        className={cn(
          "flex items-center gap-2 px-3 py-2 text-sm transition-colors",
          "hover:bg-muted/50",
          !selectedAccountId && selectedFolder === "INBOX"
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium"
            : "text-foreground/70",
        )}
        onClick={() => {
          onSelectAccount(null);
          onSelectFolder("INBOX", "");
        }}
      >
        <Inbox className="h-4 w-4" />
        Unified Inbox
        {stats && stats.unread > 0 && (
          <Badge
            variant="secondary"
            className="ml-auto h-5 min-w-5 justify-center text-[10px] bg-emerald-500/20 text-emerald-600"
          >
            {stats.unread}
          </Badge>
        )}
      </button>

      <ScrollArea className="flex-1">
        <div className="space-y-0.5 py-1">
          {accounts.map((acct) => (
            <AccountSection
              key={acct.id}
              accountId={acct.id}
              displayName={acct.displayName}
              email={acct.email as string}
              expanded={expandedAccounts.has(acct.id)}
              selectedFolder={
                selectedAccountId === acct.id ? selectedFolder : null
              }
              onToggle={() => toggleAccount(acct.id)}
              onSelectFolder={(folder) => onSelectFolder(folder, acct.id)}
              onSync={() => syncNow.mutate(acct.id)}
              isSyncing={syncNow.isPending}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function AccountSection({
  accountId,
  displayName,
  email,
  expanded,
  selectedFolder,
  onToggle,
  onSelectFolder,
  onSync,
  isSyncing,
}: {
  accountId: string;
  displayName: string;
  email: string;
  expanded: boolean;
  selectedFolder: string | null;
  onToggle: () => void;
  onSelectFolder: (folder: string) => void;
  onSync: () => void;
  isSyncing: boolean;
}) {
  const { data: folders = [] } = useEmailFolders(accountId);

  const sortedFolders = [...folders].sort((a, b) => {
    const aIdx = FOLDER_ORDER.indexOf(a.type as EmailFolderType);
    const bIdx = FOLDER_ORDER.indexOf(b.type as EmailFolderType);
    return aIdx - bIdx;
  });

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs font-semibold text-foreground/60 hover:text-foreground/80 transition-colors"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <span className="truncate">{displayName}</span>
        <span className="ml-auto text-[10px] text-muted-foreground truncate max-w-[100px]">
          {email}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 ml-1"
          onClick={(e) => {
            e.stopPropagation();
            onSync();
          }}
          disabled={isSyncing}
        >
          <RefreshCw
            className={cn("h-3 w-3", isSyncing && "animate-spin")}
          />
        </Button>
      </button>

      {expanded && (
        <div className="ml-2 space-y-0.5">
          {sortedFolders.map((folder) => {
            const Icon =
              FOLDER_ICONS[folder.type as EmailFolderType] || Folder;
            const isActive = selectedFolder === folder.path;

            return (
              <button
                key={folder.path}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-1 text-sm transition-colors",
                  isActive
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium"
                    : "text-foreground/60 hover:bg-muted/50 hover:text-foreground/80",
                )}
                onClick={() => onSelectFolder(folder.path)}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="truncate">{folder.name}</span>
                {folder.unreadCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-auto h-4 min-w-4 justify-center text-[10px]"
                  >
                    {folder.unreadCount}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
