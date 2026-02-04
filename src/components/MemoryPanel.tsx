import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Plus, X, Pencil, Check } from "lucide-react";
import { showError } from "@/lib/toast";
import { useMemories } from "@/hooks/useMemories";
import { useSettings } from "@/hooks/useSettings";

export function MemoryPanel() {
  const { settings } = useSettings();
  const { memories, isLoading, createMemory, updateMemory, deleteMemory } =
    useMemories();
  const [newContent, setNewContent] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState("");

  if (!settings?.enableMemory) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Memory is disabled. Enable it in Settings &gt; AI Settings to start
        saving memories.
      </div>
    );
  }

  const handleAdd = async () => {
    if (!newContent.trim()) return;
    try {
      await createMemory.mutateAsync(newContent.trim());
      setNewContent("");
      setIsAdding(false);
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Failed to create memory",
      );
    }
  };

  const handleUpdate = async (id: number) => {
    if (!editingContent.trim()) return;
    try {
      await updateMemory.mutateAsync({ id, content: editingContent.trim() });
      setEditingId(null);
      setEditingContent("");
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Failed to update memory",
      );
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMemory.mutateAsync(id);
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Failed to delete memory",
      );
    }
  };

  const startEditing = (id: number, content: string) => {
    setEditingId(id);
    setEditingContent(content);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Memories</h3>
        {!isAdding && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAdding(true)}
            className="h-7 text-xs"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        )}
      </div>

      {isAdding && (
        <div className="flex gap-2">
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="e.g. User prefers Tailwind CSS for styling"
            className="flex-1 min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <div className="flex flex-col gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAdd}
              disabled={!newContent.trim() || createMemory.isPending}
              className="h-7"
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsAdding(false);
                setNewContent("");
              }}
              className="h-7"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading memories...</div>
      ) : memories.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No memories yet. Add memories to help the AI remember your preferences
          across chats.
        </div>
      ) : (
        <ul className="space-y-2">
          {memories.map((memory) => (
            <li
              key={memory.id}
              className="group flex items-start gap-2 rounded-md border border-border p-2 text-sm"
            >
              {editingId === memory.id ? (
                <div className="flex-1 flex gap-2">
                  <textarea
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    className="flex-1 min-h-[40px] rounded-md border border-input bg-background px-2 py-1 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleUpdate(memory.id);
                      }
                      if (e.key === "Escape") {
                        setEditingId(null);
                      }
                    }}
                  />
                  <div className="flex flex-col gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUpdate(memory.id)}
                      disabled={
                        !editingContent.trim() || updateMemory.isPending
                      }
                      className="h-6 w-6 p-0"
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingId(null)}
                      className="h-6 w-6 p-0"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="flex-1 whitespace-pre-wrap">
                    {memory.content}
                  </span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startEditing(memory.id, memory.content)}
                      className="h-6 w-6 p-0"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(memory.id)}
                      disabled={deleteMemory.isPending}
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
