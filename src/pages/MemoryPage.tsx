/**
 * Memory Page
 * UI for managing the persistent AI memory system
 */

import { useState, useMemo } from "react";
import {
  useMemorySystem,
  useMemoryStats,
  useUserProfile,
  useUpdateProfile,
  useMemoryFullTextSearch,
  useDeleteMemory,
  useConsolidateMemories,
  useCreateMemory,
  type Memory,
  type MemoryType,
  type MemoryImportance,
} from "@/hooks/useMemory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Brain,
  Search,
  Trash2,
  RefreshCw,
  Plus,
  Settings,
  Database,
  Activity,
  User,
  Code,
  Star,
  Lightbulb,
  MessageSquare,
  Link2,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";

// =============================================================================
// MEMORY TYPE ICONS & COLORS
// =============================================================================

const MEMORY_TYPE_CONFIG: Record<MemoryType, { icon: React.ReactNode; color: string; label: string }> = {
  fact: { icon: <Lightbulb className="h-4 w-4" />, color: "bg-yellow-500/20 text-yellow-600", label: "Fact" },
  preference: { icon: <Star className="h-4 w-4" />, color: "bg-purple-500/20 text-purple-600", label: "Preference" },
  code_pattern: { icon: <Code className="h-4 w-4" />, color: "bg-blue-500/20 text-blue-600", label: "Code Pattern" },
  project: { icon: <Database className="h-4 w-4" />, color: "bg-green-500/20 text-green-600", label: "Project" },
  conversation: { icon: <MessageSquare className="h-4 w-4" />, color: "bg-gray-500/20 text-gray-600", label: "Conversation" },
  skill: { icon: <Activity className="h-4 w-4" />, color: "bg-orange-500/20 text-orange-600", label: "Skill" },
  entity: { icon: <User className="h-4 w-4" />, color: "bg-cyan-500/20 text-cyan-600", label: "Entity" },
  relationship: { icon: <Link2 className="h-4 w-4" />, color: "bg-pink-500/20 text-pink-600", label: "Relationship" },
};

const IMPORTANCE_CONFIG: Record<MemoryImportance, { color: string; label: string }> = {
  critical: { color: "bg-red-500/20 text-red-600", label: "Critical" },
  high: { color: "bg-orange-500/20 text-orange-600", label: "High" },
  medium: { color: "bg-yellow-500/20 text-yellow-600", label: "Medium" },
  low: { color: "bg-gray-500/20 text-gray-600", label: "Low" },
  trivial: { color: "bg-gray-300/20 text-gray-500", label: "Trivial" },
};

// =============================================================================
// MEMORY CARD COMPONENT
// =============================================================================

function MemoryCard({
  memory,
  onDelete,
}: {
  memory: Memory;
  onDelete: (id: string) => void;
}) {
  const typeConfig = MEMORY_TYPE_CONFIG[memory.type];
  const importanceConfig = IMPORTANCE_CONFIG[memory.importance];
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    await onDelete(memory.id);
    setIsDeleting(false);
  };

  return (
    <Card className="group relative">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={typeConfig.color}>
              {typeConfig.icon}
              <span className="ml-1">{typeConfig.label}</span>
            </Badge>
            <Badge variant="outline" className={importanceConfig.color}>
              {importanceConfig.label}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 text-destructive" />
            )}
          </Button>
        </div>
        {memory.summary && (
          <CardDescription className="text-sm font-medium">
            {memory.summary}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-3">
          {memory.content}
        </p>
        <div className="flex flex-wrap gap-1 mt-2">
          {memory.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <span>Accessed {memory.accessCount} times</span>
          <span>{new Date(memory.createdAt).toLocaleDateString()}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// CREATE MEMORY DIALOG
// =============================================================================

function CreateMemoryDialog({ onClose }: { onClose: () => void }) {
  const createMemory = useCreateMemory();
  const [formData, setFormData] = useState({
    type: "fact" as MemoryType,
    content: "",
    summary: "",
    importance: "medium" as MemoryImportance,
    tags: "",
  });

  const handleSubmit = async () => {
    await createMemory.mutateAsync({
      type: formData.type,
      content: formData.content,
      summary: formData.summary || undefined,
      importance: formData.importance,
      tags: formData.tags.split(",").map((t) => t.trim()).filter(Boolean),
      source: "user",
    });
    onClose();
  };

  return (
    <DialogContent className="sm:max-w-[500px]">
      <DialogHeader>
        <DialogTitle>Create Memory</DialogTitle>
        <DialogDescription>
          Add a new memory to help the AI remember important information.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <Label htmlFor="type">Type</Label>
          <Select
            value={formData.type}
            onValueChange={(v) => setFormData((f) => ({ ...f, type: v as MemoryType }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MEMORY_TYPE_CONFIG).map(([key, config]) => (
                <SelectItem key={key} value={key}>
                  <div className="flex items-center gap-2">
                    {config.icon}
                    {config.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="content">Content</Label>
          <Textarea
            id="content"
            placeholder="What should the AI remember?"
            value={formData.content}
            onChange={(e) => setFormData((f) => ({ ...f, content: e.target.value }))}
            rows={3}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="summary">Summary (optional)</Label>
          <Input
            id="summary"
            placeholder="Brief summary"
            value={formData.summary}
            onChange={(e) => setFormData((f) => ({ ...f, summary: e.target.value }))}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="importance">Importance</Label>
          <Select
            value={formData.importance}
            onValueChange={(v) => setFormData((f) => ({ ...f, importance: v as MemoryImportance }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(IMPORTANCE_CONFIG).map(([key, config]) => (
                <SelectItem key={key} value={key}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="tags">Tags (comma-separated)</Label>
          <Input
            id="tags"
            placeholder="react, typescript, preferences"
            value={formData.tags}
            onChange={(e) => setFormData((f) => ({ ...f, tags: e.target.value }))}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!formData.content || createMemory.isPending}>
          {createMemory.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create Memory
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// =============================================================================
// STATS PANEL
// =============================================================================

function StatsPanel() {
  const { data: stats, isLoading } = useMemoryStats();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Total Memories</CardDescription>
          <CardTitle className="text-2xl">{stats.totalMemories}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Total Accesses</CardDescription>
          <CardTitle className="text-2xl">{stats.totalAccessCount}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Storage Size</CardDescription>
          <CardTitle className="text-2xl">
            {(stats.storageSize / 1024).toFixed(1)} KB
          </CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Memory Types</CardDescription>
          <CardTitle className="text-2xl">
            {Object.values(stats.byType).filter((v) => v > 0).length}
          </CardTitle>
        </CardHeader>
      </Card>
    </div>
  );
}

// =============================================================================
// USER PROFILE PANEL
// =============================================================================

function ProfilePanel() {
  const { data: profile, isLoading } = useUserProfile();
  const updateProfile = useUpdateProfile();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          User Profile
        </CardTitle>
        <CardDescription>
          Your learned preferences and coding style
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label>Name</Label>
          <Input
            value={profile.name || ""}
            onChange={(e) => updateProfile.mutate({ name: e.target.value })}
            placeholder="Your name"
          />
        </div>

        <Separator />

        <div>
          <Label className="text-base">Communication Style</Label>
          <div className="grid grid-cols-2 gap-4 mt-2">
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Verbosity</Label>
              <Select
                value={profile.communicationStyle.verbosity}
                onValueChange={(v) =>
                  updateProfile.mutate({
                    communicationStyle: { ...profile.communicationStyle, verbosity: v as any },
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="concise">Concise</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="detailed">Detailed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Technical Level</Label>
              <Select
                value={profile.communicationStyle.technicalLevel}
                onValueChange={(v) =>
                  updateProfile.mutate({
                    communicationStyle: { ...profile.communicationStyle, technicalLevel: v as any },
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                  <SelectItem value="expert">Expert</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3">
            <Label className="text-sm">Show code examples</Label>
            <Switch
              checked={profile.communicationStyle.preferredExamples}
              onCheckedChange={(v) =>
                updateProfile.mutate({
                  communicationStyle: { ...profile.communicationStyle, preferredExamples: v },
                })
              }
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            <Label className="text-sm">Show reasoning</Label>
            <Switch
              checked={profile.communicationStyle.showReasoning}
              onCheckedChange={(v) =>
                updateProfile.mutate({
                  communicationStyle: { ...profile.communicationStyle, showReasoning: v },
                })
              }
            />
          </div>
        </div>

        <Separator />

        <div>
          <Label className="text-base">Code Style</Label>
          <div className="grid grid-cols-2 gap-4 mt-2">
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Naming Convention</Label>
              <Select
                value={profile.codeStyle.namingConventions}
                onValueChange={(v) =>
                  updateProfile.mutate({
                    codeStyle: { ...profile.codeStyle, namingConventions: v as any },
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="camelCase">camelCase</SelectItem>
                  <SelectItem value="snake_case">snake_case</SelectItem>
                  <SelectItem value="PascalCase">PascalCase</SelectItem>
                  <SelectItem value="kebab-case">kebab-case</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Indent Style</Label>
              <Select
                value={profile.codeStyle.indentStyle}
                onValueChange={(v) =>
                  updateProfile.mutate({
                    codeStyle: { ...profile.codeStyle, indentStyle: v as any },
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="spaces">Spaces</SelectItem>
                  <SelectItem value="tabs">Tabs</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <Label className="text-base">Learned Skills</Label>
          <div className="flex flex-wrap gap-1 mt-2">
            {profile.skills.length === 0 ? (
              <p className="text-sm text-muted-foreground">No skills learned yet</p>
            ) : (
              profile.skills.map((skill) => (
                <Badge key={skill} variant="secondary">
                  {skill}
                </Badge>
              ))
            )}
          </div>
        </div>

        <div>
          <Label className="text-base">Interests</Label>
          <div className="flex flex-wrap gap-1 mt-2">
            {profile.interests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No interests learned yet</p>
            ) : (
              profile.interests.map((interest) => (
                <Badge key={interest} variant="outline">
                  {interest}
                </Badge>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// MAIN PAGE COMPONENT
// =============================================================================

export default function MemoryPage() {
  const { isReady, isInitializing, initialize, shutdown } = useMemorySystem();
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const deleteMemory = useDeleteMemory();
  const consolidate = useConsolidateMemories();

  const { data: searchResults, isLoading: isSearching } = useMemoryFullTextSearch(
    searchQuery,
    50,
    isReady && searchQuery.length >= 2
  );

  const memories = useMemo(() => {
    return searchResults?.map((r) => r.memory) || [];
  }, [searchResults]);

  if (!isReady) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] gap-4">
        <Brain className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold">AI Memory System</h1>
        <p className="text-muted-foreground text-center max-w-md">
          The memory system helps the AI remember your preferences, code patterns,
          and important facts across conversations.
        </p>
        <Button onClick={initialize} disabled={isInitializing} size="lg">
          {isInitializing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Initialize Memory System
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">AI Memory</h1>
            <p className="text-sm text-muted-foreground">
              Persistent memory system for personalized AI assistance
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => consolidate.mutate()}
            disabled={consolidate.isPending}
          >
            {consolidate.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Consolidate
          </Button>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Memory
              </Button>
            </DialogTrigger>
            {showCreateDialog && (
              <CreateMemoryDialog onClose={() => setShowCreateDialog(false)} />
            )}
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <StatsPanel />

      {/* Main Content */}
      <Tabs defaultValue="memories" className="space-y-4">
        <TabsList>
          <TabsTrigger value="memories">
            <Database className="mr-2 h-4 w-4" />
            Memories
          </TabsTrigger>
          <TabsTrigger value="profile">
            <User className="mr-2 h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="memories" className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search memories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Memory List */}
          <ScrollArea className="h-[500px]">
            {isSearching ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : memories.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mb-2" />
                <p>
                  {searchQuery
                    ? "No memories match your search"
                    : "No memories yet. Start chatting to build your memory!"}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {memories.map((memory) => (
                  <MemoryCard
                    key={memory.id}
                    memory={memory}
                    onDelete={(id) => deleteMemory.mutate(id as any)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="profile">
          <ProfilePanel />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Memory System Settings</CardTitle>
              <CardDescription>
                Configure how the AI memory system behaves
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Memory System Status</Label>
                  <p className="text-sm text-muted-foreground">
                    The memory system is currently active
                  </p>
                </div>
                <Badge variant="outline" className="bg-green-500/20 text-green-600">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Active
                </Badge>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Danger Zone</Label>
                <p className="text-sm text-muted-foreground">
                  Shut down the memory system. All memories will be preserved but
                  won't be accessible until restarted.
                </p>
                <Button variant="destructive" onClick={() => shutdown()}>
                  Shutdown Memory System
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
