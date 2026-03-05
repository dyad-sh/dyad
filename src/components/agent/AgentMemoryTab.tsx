/**
 * AgentMemoryTab — Memory settings & management tab for the Agent Editor
 */

import { useState } from "react";
import {
  Brain,
  Plus,
  Trash2,
  Edit2,
  Search,
  Clock,
  Tag,
  Lightbulb,
  BookOpen,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  useAgentMemoryConfig,
  useUpsertAgentMemoryConfig,
  useLongTermMemories,
  useCreateLongTermMemory,
  useUpdateLongTermMemory,
  useDeleteLongTermMemory,
} from "@/hooks/useAgentMemory";
import type {
  LongTermMemory,
  LongTermMemoryCategory,
} from "@/types/agent_memory";

const CATEGORY_COLORS: Record<LongTermMemoryCategory, string> = {
  fact: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  preference:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  instruction:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  context:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  skill: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  relationship:
    "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
};

const CATEGORY_ICONS: Record<LongTermMemoryCategory, typeof Brain> = {
  fact: BookOpen,
  preference: Lightbulb,
  instruction: Tag,
  context: Brain,
  skill: Edit2,
  relationship: Clock,
};

interface AgentMemoryTabProps {
  agentId: number;
}

export default function AgentMemoryTab({ agentId }: AgentMemoryTabProps) {
  const { data: config, isLoading: configLoading } =
    useAgentMemoryConfig(agentId);
  const upsertConfig = useUpsertAgentMemoryConfig();

  const [filterCategory, setFilterCategory] = useState<
    LongTermMemoryCategory | "all"
  >("all");
  const { data: memories = [], isLoading: memoriesLoading } =
    useLongTermMemories(
      agentId,
      filterCategory === "all" ? undefined : filterCategory,
    );
  const createMemory = useCreateLongTermMemory();
  const updateMemory = useUpdateLongTermMemory(agentId);
  const deleteMemory = useDeleteLongTermMemory(agentId);

  // Dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [editMemory, setEditMemory] = useState<LongTermMemory | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // Form state
  const [newCategory, setNewCategory] =
    useState<LongTermMemoryCategory>("fact");
  const [newContent, setNewContent] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newImportance, setNewImportance] = useState(0.5);

  // Local config state for immediate feedback
  const [localLtEnabled, setLocalLtEnabled] = useState<boolean | null>(null);
  const [localStEnabled, setLocalStEnabled] = useState<boolean | null>(null);
  const [localAutoExtract, setLocalAutoExtract] = useState<boolean | null>(
    null,
  );
  const [localLtMaxCtx, setLocalLtMaxCtx] = useState<number | null>(null);
  const [localStMaxEntries, setLocalStMaxEntries] = useState<number | null>(
    null,
  );

  const ltEnabled = localLtEnabled ?? config?.longTermEnabled ?? false;
  const stEnabled = localStEnabled ?? config?.shortTermEnabled ?? false;
  const autoExtract = localAutoExtract ?? config?.autoExtract ?? false;
  const ltMaxCtx = localLtMaxCtx ?? config?.longTermMaxContext ?? 10;
  const stMaxEntries =
    localStMaxEntries ?? config?.shortTermMaxEntries ?? 50;

  const handleSaveConfig = () => {
    upsertConfig.mutate({
      agentId,
      longTermEnabled: ltEnabled,
      shortTermEnabled: stEnabled,
      autoExtract,
      longTermMaxContext: ltMaxCtx,
      shortTermMaxEntries: stMaxEntries,
    });
  };

  const handleCreate = () => {
    if (!newContent.trim()) return;
    createMemory.mutate(
      {
        agentId,
        category: newCategory,
        content: newContent.trim(),
        key: newKey.trim() || undefined,
        importance: newImportance,
      },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setNewContent("");
          setNewKey("");
          setNewImportance(0.5);
        },
      },
    );
  };

  const handleUpdate = () => {
    if (!editMemory) return;
    updateMemory.mutate(
      {
        id: editMemory.id,
        category: editMemory.category,
        content: editMemory.content,
        key: editMemory.key,
        importance: editMemory.importance,
      },
      { onSuccess: () => setEditMemory(null) },
    );
  };

  const handleDelete = (id: number) => {
    deleteMemory.mutate(id, {
      onSuccess: () => setDeleteConfirmId(null),
    });
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading memory settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Agent Memory
        </h2>
        <p className="text-sm text-muted-foreground">
          Configure what your agent remembers across and within conversations
        </p>
      </div>

      {/* ── Settings Card ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Memory Settings</CardTitle>
          <CardDescription>
            Enable and configure long-term and short-term memory
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Long-Term Memory */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">
                  Long-Term Memory
                </Label>
                <p className="text-xs text-muted-foreground">
                  Remember information across different conversations
                </p>
              </div>
              <Switch
                checked={ltEnabled}
                onCheckedChange={(v) => setLocalLtEnabled(v)}
              />
            </div>
            {ltEnabled && (
              <div className="pl-4 border-l-2 border-muted space-y-3">
                <div>
                  <Label className="text-xs">
                    Max memories in context: {ltMaxCtx}
                  </Label>
                  <Slider
                    min={1}
                    max={50}
                    step={1}
                    value={[ltMaxCtx]}
                    onValueChange={([v]) => setLocalLtMaxCtx(v)}
                    className="mt-1"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Short-Term Memory */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">
                  Short-Term Memory
                </Label>
                <p className="text-xs text-muted-foreground">
                  Track structured information within a single conversation
                </p>
              </div>
              <Switch
                checked={stEnabled}
                onCheckedChange={(v) => setLocalStEnabled(v)}
              />
            </div>
            {stEnabled && (
              <div className="pl-4 border-l-2 border-muted space-y-3">
                <div>
                  <Label className="text-xs">
                    Max entries per conversation: {stMaxEntries}
                  </Label>
                  <Slider
                    min={10}
                    max={200}
                    step={5}
                    value={[stMaxEntries]}
                    onValueChange={([v]) => setLocalStMaxEntries(v)}
                    className="mt-1"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Auto-Extract */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">
                Auto-Extract Memories
              </Label>
              <p className="text-xs text-muted-foreground">
                Automatically detect &quot;remember&quot; / &quot;prefer&quot;
                patterns and save them
              </p>
            </div>
            <Switch
              checked={autoExtract}
              onCheckedChange={(v) => setLocalAutoExtract(v)}
            />
          </div>

          <Button onClick={handleSaveConfig} disabled={upsertConfig.isPending}>
            <Save className="h-4 w-4 mr-2" />
            {upsertConfig.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </CardContent>
      </Card>

      {/* ── Long-Term Memories List ──────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">
                Long-Term Memories
              </CardTitle>
              <CardDescription>
                Facts, preferences, and instructions your agent will remember
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Memory
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filter */}
          <div className="flex items-center gap-2 mb-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Select
              value={filterCategory}
              onValueChange={(v) =>
                setFilterCategory(v as LongTermMemoryCategory | "all")
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                <SelectItem value="fact">Facts</SelectItem>
                <SelectItem value="preference">Preferences</SelectItem>
                <SelectItem value="instruction">Instructions</SelectItem>
                <SelectItem value="context">Context</SelectItem>
                <SelectItem value="skill">Skills</SelectItem>
                <SelectItem value="relationship">Relationships</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-auto">
              {memories.length} memor{memories.length === 1 ? "y" : "ies"}
            </span>
          </div>

          {memoriesLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Loading memories...
            </p>
          ) : memories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Brain className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                No memories yet. Add facts and preferences your agent should
                remember.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {memories.map((mem) => {
                const Icon =
                  CATEGORY_ICONS[mem.category as LongTermMemoryCategory] ??
                  Brain;
                return (
                  <div
                    key={mem.id}
                    className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors"
                  >
                    <Icon className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          className={`text-[10px] px-1.5 py-0 ${
                            CATEGORY_COLORS[
                              mem.category as LongTermMemoryCategory
                            ] ?? ""
                          }`}
                          variant="secondary"
                        >
                          {mem.category}
                        </Badge>
                        {mem.key && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {mem.key}
                          </span>
                        )}
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          importance: {(mem.importance * 100).toFixed(0)}%
                        </span>
                      </div>
                      <p className="text-sm">{mem.content}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setEditMemory({ ...mem })}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => setDeleteConfirmId(mem.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Create Dialog ──────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Long-Term Memory</DialogTitle>
            <DialogDescription>
              Add a fact, preference, or instruction your agent should remember
              across conversations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Category</Label>
              <Select
                value={newCategory}
                onValueChange={(v) =>
                  setNewCategory(v as LongTermMemoryCategory)
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fact">Fact</SelectItem>
                  <SelectItem value="preference">Preference</SelectItem>
                  <SelectItem value="instruction">Instruction</SelectItem>
                  <SelectItem value="context">Context</SelectItem>
                  <SelectItem value="skill">Skill</SelectItem>
                  <SelectItem value="relationship">Relationship</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Content</Label>
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="e.g. The user prefers TypeScript over JavaScript"
                className="mt-1"
                rows={3}
              />
            </div>
            <div>
              <Label>Key (optional, for deduplication)</Label>
              <Input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="e.g. user-language-preference"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Importance: {(newImportance * 100).toFixed(0)}%</Label>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[newImportance]}
                onValueChange={([v]) => setNewImportance(v)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newContent.trim() || createMemory.isPending}
            >
              {createMemory.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ────────────────────────────────────────── */}
      <Dialog
        open={!!editMemory}
        onOpenChange={(open) => !open && setEditMemory(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Memory</DialogTitle>
          </DialogHeader>
          {editMemory && (
            <div className="space-y-4 py-2">
              <div>
                <Label>Category</Label>
                <Select
                  value={editMemory.category}
                  onValueChange={(v) =>
                    setEditMemory({
                      ...editMemory,
                      category: v as LongTermMemoryCategory,
                    })
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fact">Fact</SelectItem>
                    <SelectItem value="preference">Preference</SelectItem>
                    <SelectItem value="instruction">Instruction</SelectItem>
                    <SelectItem value="context">Context</SelectItem>
                    <SelectItem value="skill">Skill</SelectItem>
                    <SelectItem value="relationship">Relationship</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Content</Label>
                <Textarea
                  value={editMemory.content}
                  onChange={(e) =>
                    setEditMemory({
                      ...editMemory,
                      content: e.target.value,
                    })
                  }
                  className="mt-1"
                  rows={3}
                />
              </div>
              <div>
                <Label>Key</Label>
                <Input
                  value={editMemory.key ?? ""}
                  onChange={(e) =>
                    setEditMemory({
                      ...editMemory,
                      key: e.target.value || undefined,
                    })
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label>
                  Importance:{" "}
                  {(editMemory.importance * 100).toFixed(0)}%
                </Label>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={[editMemory.importance]}
                  onValueChange={([v]) =>
                    setEditMemory({ ...editMemory, importance: v })
                  }
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditMemory(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={updateMemory.isPending}
            >
              {updateMemory.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ────────────────────────────────── */}
      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Memory</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this memory? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              disabled={deleteMemory.isPending}
            >
              {deleteMemory.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
