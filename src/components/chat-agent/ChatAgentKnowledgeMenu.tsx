import { useQuery } from "@tanstack/react-query";
import { BookOpen, Database } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

export function ChatAgentKnowledgeMenu({
  disabled,
  selectedCollectionIds,
  onChange,
}: {
  disabled?: boolean;
  selectedCollectionIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const collectionsQuery = useQuery({
    queryKey: queryKeys.vector.collections,
    queryFn: () => ipc.vector.listCollections(),
  });
  const collections = collectionsQuery.data ?? [];
  const active = selectedCollectionIds.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "chat-agent-composer-icon-btn",
          active && "chat-agent-composer-icon-btn--active",
        )}
        aria-label="Use Vector knowledge"
        title="Use Vector knowledge"
        data-testid="chat-agent-knowledge-menu"
      >
        <BookOpen className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-72 p-1.5">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Database className="size-4 text-cyan-500" />
          Vector knowledge
        </DropdownMenuLabel>
        <p className="px-2 pb-2 text-xs leading-5 text-muted-foreground">
          Selected collections are searched for each message. Relevant passages
          are sent to your Chat model only when cloud-assisted RAG is allowed.
        </p>
        <DropdownMenuSeparator />
        {collections.map((collection) => {
          const checked = selectedCollectionIds.includes(collection.id);
          return (
            <DropdownMenuCheckboxItem
              key={collection.id}
              checked={checked}
              closeOnClick={false}
              onCheckedChange={(nextChecked) => {
                onChange(
                  nextChecked
                    ? [...selectedCollectionIds, collection.id]
                    : selectedCollectionIds.filter(
                        (id) => id !== collection.id,
                      ),
                );
              }}
            >
              <span className="min-w-0">
                <span className="block truncate">{collection.name}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {collection.chunkCount} searchable chunks
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          );
        })}
        {!collections.length && (
          <div className="px-2 py-3 text-xs leading-5 text-muted-foreground">
            Create and index a collection in Vector first.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
