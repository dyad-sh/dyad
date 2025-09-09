import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "./ui/command";
import { useState, useEffect } from "react";
import { useSearchChats } from "@/hooks/useSearchChats";
import type { ChatSummary, ChatSearchResult } from "@/lib/schemas";

type ChatSearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectChat: ({ chatId, appId }: { chatId: number; appId: number }) => void;
  appId: number | null;
  allChats: ChatSummary[];
};

export function ChatSearchDialog({
  open,
  onOpenChange,
  appId,
  onSelectChat,
  allChats,
}: ChatSearchDialogProps) {
  const [searchQuery, setSearchQuery] = useState<string>("");
  function useDebouncedValue<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState<T>(value);
    useEffect(() => {
      const handle = setTimeout(() => setDebounced(value), delay);
      return () => clearTimeout(handle);
    }, [value, delay]);
    return debounced;
  }

  const debouncedQuery = useDebouncedValue(searchQuery, 150);
  const { chats: searchResults } = useSearchChats(appId, debouncedQuery);

  // Show all chats if search is empty, otherwise show search results
  const chatsToShow = debouncedQuery.trim() === "" ? allChats : searchResults;

  const commandFilter = (
    value: string,
    search: string,
    keywords?: string[],
  ): number => {
    const q = search.trim().toLowerCase();
    if (!q) return 1;
    const v = (value || "").toLowerCase();
    if (v.includes(q)) {
      // Higher score for earlier match in title/value
      return 100 - Math.max(0, v.indexOf(q));
    }
    const foundInKeywords = (keywords || []).some((k) =>
      (k || "").toLowerCase().includes(q),
    );
    return foundInKeywords ? 50 : 0;
  };

  function getSnippet(
    text: string,
    query: string,
    radius = 50,
  ): {
    before: string;
    match: string;
    after: string;
    raw: string;
  } {
    const q = query.trim();
    const lowerText = text;
    const lowerQuery = q.toLowerCase();
    const idx = lowerText.toLowerCase().indexOf(lowerQuery);
    if (idx === -1) {
      const raw =
        text.length > radius * 2 ? text.slice(0, radius * 2) + "…" : text;
      return { before: "", match: "", after: "", raw };
    }
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + q.length + radius);
    const before = (start > 0 ? "…" : "") + text.slice(start, idx);
    const match = text.slice(idx, idx + q.length);
    const after =
      text.slice(idx + q.length, end) + (end < text.length ? "…" : "");
    return { before, match, after, raw: before + match + after };
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      data-testid="chat-search-dialog"
      filter={commandFilter}
    >
      <CommandInput
        placeholder="Search chats"
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Chats">
          {chatsToShow.map((chat) => {
            const isSearch = searchQuery.trim() !== "";
            const hasSnippet =
              isSearch &&
              "matchedMessageContent" in chat &&
              (chat as ChatSearchResult).matchedMessageContent;
            const snippet = hasSnippet
              ? getSnippet(
                  (chat as ChatSearchResult).matchedMessageContent as string,
                  searchQuery,
                )
              : null;
            return (
              <CommandItem
                key={chat.id}
                onSelect={() =>
                  onSelectChat({ chatId: chat.id, appId: chat.appId })
                }
                value={
                  (chat.title || "Untitled Chat") +
                  (snippet ? ` ${snippet.raw}` : "")
                }
                keywords={snippet ? [snippet.raw] : []}
              >
                <div className="flex flex-col">
                  <span>{chat.title || "Untitled Chat"}</span>
                  {snippet && (
                    <span className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {snippet.before}
                      <mark className="bg-transparent underline decoration-2 decoration-primary">
                        {snippet.match}
                      </mark>
                      {snippet.after}
                    </span>
                  )}
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
