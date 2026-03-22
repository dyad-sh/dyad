/**
 * AI Learning Mode Page
 * User interface for managing learning profiles, patterns, feedback, and preferences
 */

import React, { useState, useMemo } from "react";
import {
  useAILearningManager,
  useLearningProfiles,
  useLearnedPatterns,
  useFeedbackHistory,
  useSearchPatterns,
  type ProfileId,
  type PatternId,
  type LearningProfile,
  type LearnedPattern,
  type UserFeedback,
  type LearningDomain,
  type PatternType,
  type FeedbackType,
  type StyleGuide,
  type CommunicationPreferences,
  type PatternExample,
} from "../hooks/useAILearning";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { Slider } from "../components/ui/slider";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import {
  Brain,
  Plus,
  Trash2,
  Edit,
  Search,
  User,
  Code,
  MessageSquare,
  Settings,
  BarChart3,
  Sparkles,
  CheckCircle,
  XCircle,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Copy,
  BookOpen,
  Palette,
  Zap,
  Clock,
  Target,
  FileCode,
  Layout,
  Terminal,
  GitBranch,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "../lib/utils";
import { ScrollArea } from "../components/ui/scroll-area";
import { Separator } from "../components/ui/separator";

// Domain configuration
const DOMAIN_CONFIG: Record<LearningDomain, { label: string; icon: React.ComponentType<any>; color: string }> = {
  coding_style: { label: "Coding Style", icon: Code, color: "bg-blue-500" },
  communication: { label: "Communication", icon: MessageSquare, color: "bg-green-500" },
  preferences: { label: "Preferences", icon: Settings, color: "bg-purple-500" },
  workflow: { label: "Workflow", icon: GitBranch, color: "bg-orange-500" },
  terminology: { label: "Terminology", icon: BookOpen, color: "bg-pink-500" },
  tools: { label: "Tools", icon: Terminal, color: "bg-cyan-500" },
  architecture: { label: "Architecture", icon: Layout, color: "bg-yellow-500" },
};

const ALL_DOMAINS: LearningDomain[] = [
  "coding_style",
  "communication",
  "preferences",
  "workflow",
  "terminology",
  "tools",
  "architecture",
];

const PATTERN_TYPE_CONFIG: Record<PatternType, { label: string }> = {
  code_format: { label: "Code Format" },
  naming_convention: { label: "Naming Convention" },
  comment_style: { label: "Comment Style" },
  error_handling: { label: "Error Handling" },
  import_order: { label: "Import Order" },
  response_length: { label: "Response Length" },
  formality: { label: "Formality" },
  explanation_depth: { label: "Explanation Depth" },
  tool_preference: { label: "Tool Preference" },
  framework_preference: { label: "Framework Preference" },
  language_preference: { label: "Language Preference" },
  shortcut: { label: "Shortcut" },
  custom: { label: "Custom" },
};

const FEEDBACK_TYPE_CONFIG: Record<FeedbackType, { label: string; icon: React.ComponentType<any>; color: string }> = {
  positive: { label: "Positive", icon: ThumbsUp, color: "text-green-500" },
  negative: { label: "Negative", icon: ThumbsDown, color: "text-red-500" },
  correction: { label: "Correction", icon: Edit, color: "text-yellow-500" },
  preference: { label: "Preference", icon: Target, color: "text-blue-500" },
};

// ============ Main Page Component ============

export default function AILearningPage() {
  const manager = useAILearningManager();
  const [activeTab, setActiveTab] = useState("profiles");

  if (manager.isLoading && !manager.activeProfile) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <Brain className="w-12 h-12 text-primary animate-pulse" />
          <p className="text-muted-foreground">Loading AI Learning Mode...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b">
        <div className="flex items-center gap-3">
          <Brain className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">AI Learning Mode</h1>
            <p className="text-sm text-muted-foreground">
              Teach the AI your preferences and coding style
            </p>
          </div>
        </div>
        {manager.activeProfile && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <User className="w-3 h-3" />
              {manager.activeProfile.name}
            </Badge>
            {manager.stats && (
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="w-3 h-3" />
                {manager.stats.totalPatterns} patterns
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <div className="border-b px-6">
          <TabsList className="h-12">
            <TabsTrigger value="profiles" className="gap-2">
              <User className="w-4 h-4" />
              Profiles
            </TabsTrigger>
            <TabsTrigger value="patterns" className="gap-2">
              <Code className="w-4 h-4" />
              Patterns
            </TabsTrigger>
            <TabsTrigger value="feedback" className="gap-2">
              <MessageSquare className="w-4 h-4" />
              Feedback
            </TabsTrigger>
            <TabsTrigger value="style" className="gap-2">
              <Palette className="w-4 h-4" />
              Style Guide
            </TabsTrigger>
            <TabsTrigger value="preferences" className="gap-2">
              <Settings className="w-4 h-4" />
              Preferences
            </TabsTrigger>
            <TabsTrigger value="stats" className="gap-2">
              <BarChart3 className="w-4 h-4" />
              Stats
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="profiles" className="h-full m-0">
            <ProfilesTab manager={manager} />
          </TabsContent>
          <TabsContent value="patterns" className="h-full m-0">
            <PatternsTab manager={manager} />
          </TabsContent>
          <TabsContent value="feedback" className="h-full m-0">
            <FeedbackTab manager={manager} />
          </TabsContent>
          <TabsContent value="style" className="h-full m-0">
            <StyleGuideTab manager={manager} />
          </TabsContent>
          <TabsContent value="preferences" className="h-full m-0">
            <PreferencesTab manager={manager} />
          </TabsContent>
          <TabsContent value="stats" className="h-full m-0">
            <StatsTab manager={manager} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

// ============ Profiles Tab ============

function ProfilesTab({ manager }: { manager: ReturnType<typeof useAILearningManager> }) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingProfile, setEditingProfile] = useState<LearningProfile | null>(null);

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Create profile button */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold">Learning Profiles</h2>
            <p className="text-sm text-muted-foreground">
              Create profiles for different contexts or projects
            </p>
          </div>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                New Profile
              </Button>
            </DialogTrigger>
            <DialogContent>
              <CreateProfileForm
                onSuccess={() => setShowCreateDialog(false)}
                onCreate={manager.createProfile}
              />
            </DialogContent>
          </Dialog>
        </div>

        {/* Profile list */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {manager.profiles.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              isActive={manager.activeProfile?.id === profile.id}
              onActivate={() => manager.activateProfile(profile.id)}
              onEdit={() => setEditingProfile(profile)}
              onDelete={() => manager.deleteProfile(profile.id)}
            />
          ))}
          {manager.profiles.length === 0 && (
            <Card className="col-span-full">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Brain className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground text-center">
                  No learning profiles yet. Create one to start teaching the AI your preferences.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Edit dialog */}
        <Dialog open={!!editingProfile} onOpenChange={(open) => !open && setEditingProfile(null)}>
          <DialogContent>
            {editingProfile && (
              <EditProfileForm
                profile={editingProfile}
                onSuccess={() => setEditingProfile(null)}
                onUpdate={manager.updateProfile}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ScrollArea>
  );
}

function ProfileCard({
  profile,
  isActive,
  onActivate,
  onEdit,
  onDelete,
}: {
  profile: LearningProfile;
  isActive: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className={cn(isActive && "border-primary ring-1 ring-primary")}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-muted-foreground" />
            <CardTitle className="text-base">{profile.name}</CardTitle>
          </div>
          {isActive && (
            <Badge variant="default" className="text-xs">
              Active
            </Badge>
          )}
        </div>
        {profile.description && (
          <CardDescription className="line-clamp-2">{profile.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Domains */}
        <div className="flex flex-wrap gap-1">
          {profile.domains.map((domain) => {
            const config = DOMAIN_CONFIG[domain];
            return (
              <Badge key={domain} variant="secondary" className="text-xs gap-1">
                <div className={cn("w-2 h-2 rounded-full", config.color)} />
                {config.label}
              </Badge>
            );
          })}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{profile.patternCount} patterns</span>
          <span>{profile.feedbackCount} feedback</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {!isActive && (
            <Button variant="outline" size="sm" className="flex-1" onClick={onActivate}>
              <Zap className="w-4 h-4 mr-1" />
              Activate
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onEdit}>
            <Edit className="w-4 h-4" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                <Trash2 className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Profile</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete "{profile.name}"? This will also delete all associated
                  patterns and feedback.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateProfileForm({
  onSuccess,
  onCreate,
}: {
  onSuccess: () => void;
  onCreate: (params: { name: string; description?: string; domains?: LearningDomain[] }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [domains, setDomains] = useState<LearningDomain[]>(ALL_DOMAINS);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Please enter a profile name");
      return;
    }
    onCreate({ name: name.trim(), description: description.trim() || undefined, domains });
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Create Learning Profile</DialogTitle>
        <DialogDescription>
          Create a new profile to teach the AI your preferences for a specific context.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="name">Profile Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Work Projects, Personal Style"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this profile is for..."
            rows={2}
          />
        </div>
        <div className="space-y-2">
          <Label>Learning Domains</Label>
          <div className="grid grid-cols-2 gap-2">
            {ALL_DOMAINS.map((domain) => {
              const config = DOMAIN_CONFIG[domain];
              const Icon = config.icon;
              const isSelected = domains.includes(domain);
              return (
                <Button
                  key={domain}
                  type="button"
                  variant={isSelected ? "secondary" : "outline"}
                  className="justify-start gap-2"
                  onClick={() =>
                    setDomains(
                      isSelected ? domains.filter((d) => d !== domain) : [...domains, domain]
                    )
                  }
                >
                  <div className={cn("w-3 h-3 rounded-full", config.color)} />
                  <Icon className="w-4 h-4" />
                  {config.label}
                </Button>
              );
            })}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button type="submit">Create Profile</Button>
      </DialogFooter>
    </form>
  );
}

function EditProfileForm({
  profile,
  onSuccess,
  onUpdate,
}: {
  profile: LearningProfile;
  onSuccess: () => void;
  onUpdate: (params: {
    profileId: ProfileId;
    updates: Partial<{ name: string; description: string; domains: LearningDomain[] }>;
  }) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [description, setDescription] = useState(profile.description || "");
  const [domains, setDomains] = useState<LearningDomain[]>(profile.domains);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Please enter a profile name");
      return;
    }
    onUpdate({
      profileId: profile.id,
      updates: { name: name.trim(), description: description.trim() || undefined, domains },
    });
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Edit Profile</DialogTitle>
        <DialogDescription>Update your learning profile settings.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="edit-name">Profile Name</Label>
          <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-description">Description</Label>
          <Textarea
            id="edit-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>
        <div className="space-y-2">
          <Label>Learning Domains</Label>
          <div className="grid grid-cols-2 gap-2">
            {ALL_DOMAINS.map((domain) => {
              const config = DOMAIN_CONFIG[domain];
              const Icon = config.icon;
              const isSelected = domains.includes(domain);
              return (
                <Button
                  key={domain}
                  type="button"
                  variant={isSelected ? "secondary" : "outline"}
                  className="justify-start gap-2"
                  onClick={() =>
                    setDomains(
                      isSelected ? domains.filter((d) => d !== domain) : [...domains, domain]
                    )
                  }
                >
                  <div className={cn("w-3 h-3 rounded-full", config.color)} />
                  <Icon className="w-4 h-4" />
                  {config.label}
                </Button>
              );
            })}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button type="submit">Save Changes</Button>
      </DialogFooter>
    </form>
  );
}

// ============ Patterns Tab ============

function PatternsTab({ manager }: { manager: ReturnType<typeof useAILearningManager> }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState<LearningDomain | "all">("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedPattern, setSelectedPattern] = useState<LearnedPattern | null>(null);

  const { data: searchResults } = useSearchPatterns(
    searchQuery,
    manager.activeProfile?.id
  );

  const filteredPatterns = useMemo(() => {
    const patterns = searchQuery ? searchResults : manager.patterns;
    if (!patterns) return [];
    if (domainFilter === "all") return patterns;
    return patterns.filter((p) => p.domain === domainFilter);
  }, [searchQuery, searchResults, manager.patterns, domainFilter]);

  if (!manager.activeProfile) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <User className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Please activate a profile to manage patterns</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Pattern list */}
      <div className="w-1/2 border-r flex flex-col">
        <div className="p-4 border-b space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search patterns..."
                className="pl-9"
              />
            </div>
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogTrigger asChild>
                <Button size="icon">
                  <Plus className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <AddPatternForm
                  profileId={manager.activeProfile.id}
                  onSuccess={() => setShowAddDialog(false)}
                  onLearn={manager.learnPattern}
                />
              </DialogContent>
            </Dialog>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Button
              variant={domainFilter === "all" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setDomainFilter("all")}
            >
              All
            </Button>
            {ALL_DOMAINS.map((domain) => {
              const config = DOMAIN_CONFIG[domain];
              return (
                <Button
                  key={domain}
                  variant={domainFilter === domain ? "secondary" : "outline"}
                  size="sm"
                  className="gap-1 whitespace-nowrap"
                  onClick={() => setDomainFilter(domain)}
                >
                  <div className={cn("w-2 h-2 rounded-full", config.color)} />
                  {config.label}
                </Button>
              );
            })}
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-2">
            {filteredPatterns.map((pattern) => (
              <PatternListItem
                key={pattern.id}
                pattern={pattern}
                isSelected={selectedPattern?.id === pattern.id}
                onClick={() => setSelectedPattern(pattern)}
              />
            ))}
            {filteredPatterns.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery ? "No patterns found matching your search" : "No patterns learned yet"}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Pattern detail */}
      <div className="w-1/2 flex flex-col">
        {selectedPattern ? (
          <PatternDetail
            pattern={selectedPattern}
            onUpdate={manager.updatePattern}
            onDelete={() => {
              manager.deletePattern(selectedPattern.id);
              setSelectedPattern(null);
            }}
            onAddExample={manager.addPatternExample}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a pattern to view details
          </div>
        )}
      </div>
    </div>
  );
}

function PatternListItem({
  pattern,
  isSelected,
  onClick,
}: {
  pattern: LearnedPattern;
  isSelected: boolean;
  onClick: () => void;
}) {
  const domainConfig = DOMAIN_CONFIG[pattern.domain];

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg border transition-colors",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-transparent hover:border-border hover:bg-muted/50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{pattern.name}</span>
            {!pattern.isEnabled && (
              <Badge variant="outline" className="text-xs">
                Disabled
              </Badge>
            )}
          </div>
          {pattern.description && (
            <p className="text-sm text-muted-foreground truncate mt-0.5">{pattern.description}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="secondary" className="text-xs gap-1">
              <div className={cn("w-2 h-2 rounded-full", domainConfig.color)} />
              {domainConfig.label}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {PATTERN_TYPE_CONFIG[pattern.type]?.label || pattern.type}
            </Badge>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium">{Math.round(pattern.confidence * 100)}%</div>
          <div className="text-xs text-muted-foreground">confidence</div>
        </div>
      </div>
    </button>
  );
}

function PatternDetail({
  pattern,
  onUpdate,
  onDelete,
  onAddExample,
}: {
  pattern: LearnedPattern;
  onUpdate: (params: { patternId: PatternId; updates: Partial<{ name: string; description: string; pattern: string; confidence: number; weight: number; isEnabled: boolean }> }) => void;
  onDelete: () => void;
  onAddExample: (params: { patternId: PatternId; example: PatternExample }) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedPattern, setEditedPattern] = useState(pattern);

  const domainConfig = DOMAIN_CONFIG[pattern.domain];

  const handleSave = () => {
    onUpdate({
      patternId: pattern.id,
      updates: {
        name: editedPattern.name,
        description: editedPattern.description,
        pattern: editedPattern.pattern,
        confidence: editedPattern.confidence,
        weight: editedPattern.weight,
        isEnabled: editedPattern.isEnabled,
      },
    });
    setIsEditing(false);
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            {isEditing ? (
              <Input
                value={editedPattern.name}
                onChange={(e) => setEditedPattern({ ...editedPattern, name: e.target.value })}
                className="text-lg font-semibold mb-2"
              />
            ) : (
              <h2 className="text-lg font-semibold">{pattern.name}</h2>
            )}
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="secondary" className="gap-1">
                <div className={cn("w-2 h-2 rounded-full", domainConfig.color)} />
                {domainConfig.label}
              </Badge>
              <Badge variant="outline">{PATTERN_TYPE_CONFIG[pattern.type]?.label || pattern.type}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <Button variant="outline" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave}>Save</Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="icon" onClick={() => setIsEditing(true)}>
                  <Edit className="w-4 h-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="icon" className="text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Pattern</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete this pattern?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label>Description</Label>
          {isEditing ? (
            <Textarea
              value={editedPattern.description || ""}
              onChange={(e) => setEditedPattern({ ...editedPattern, description: e.target.value })}
              rows={2}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {pattern.description || "No description provided"}
            </p>
          )}
        </div>

        {/* Pattern */}
        <div className="space-y-2">
          <Label>Pattern</Label>
          {isEditing ? (
            <Textarea
              value={editedPattern.pattern}
              onChange={(e) => setEditedPattern({ ...editedPattern, pattern: e.target.value })}
              rows={4}
              className="font-mono text-sm"
            />
          ) : (
            <pre className="p-3 bg-muted rounded-lg text-sm font-mono overflow-x-auto">
              {pattern.pattern}
            </pre>
          )}
        </div>

        {/* Settings */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Confidence ({Math.round((isEditing ? editedPattern : pattern).confidence * 100)}%)</Label>
            <Slider
              value={[(isEditing ? editedPattern : pattern).confidence * 100]}
              onValueChange={([value]) =>
                isEditing && setEditedPattern({ ...editedPattern, confidence: value / 100 })
              }
              max={100}
              step={1}
              disabled={!isEditing}
            />
          </div>
          <div className="space-y-2">
            <Label>Weight ({(isEditing ? editedPattern : pattern).weight.toFixed(1)})</Label>
            <Slider
              value={[(isEditing ? editedPattern : pattern).weight * 10]}
              onValueChange={([value]) =>
                isEditing && setEditedPattern({ ...editedPattern, weight: value / 10 })
              }
              max={20}
              step={1}
              disabled={!isEditing}
            />
          </div>
        </div>

        {/* Enabled toggle */}
        <div className="flex items-center justify-between">
          <div>
            <Label>Enabled</Label>
            <p className="text-sm text-muted-foreground">Include this pattern in AI context</p>
          </div>
          <Switch
            checked={(isEditing ? editedPattern : pattern).isEnabled}
            onCheckedChange={(checked) =>
              isEditing
                ? setEditedPattern({ ...editedPattern, isEnabled: checked })
                : onUpdate({ patternId: pattern.id, updates: { isEnabled: checked } })
            }
          />
        </div>

        <Separator />

        {/* Examples */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Examples ({pattern.examples.length})</Label>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1">
                  <Plus className="w-3 h-3" />
                  Add Example
                </Button>
              </DialogTrigger>
              <DialogContent>
                <AddExampleForm
                  patternId={pattern.id}
                  onAdd={onAddExample}
                />
              </DialogContent>
            </Dialog>
          </div>
          <div className="space-y-3">
            {pattern.examples.map((example, index) => (
              <div key={index} className="p-3 border rounded-lg space-y-2">
                <div>
                  <span className="text-xs text-muted-foreground">Input:</span>
                  <p className="text-sm">{example.input}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Output:</span>
                  <p className="text-sm">{example.output}</p>
                </div>
                {example.context && (
                  <div>
                    <span className="text-xs text-muted-foreground">Context:</span>
                    <p className="text-sm text-muted-foreground">{example.context}</p>
                  </div>
                )}
              </div>
            ))}
            {pattern.examples.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No examples added yet
              </p>
            )}
          </div>
        </div>

        {/* Metadata */}
        <Separator />
        <div className="text-xs text-muted-foreground space-y-1">
          <p>Created: {new Date(pattern.createdAt).toLocaleString()}</p>
          <p>Updated: {new Date(pattern.updatedAt).toLocaleString()}</p>
          <p>Times matched: {pattern.frequency}</p>
        </div>
      </div>
    </ScrollArea>
  );
}

function AddPatternForm({
  profileId,
  onSuccess,
  onLearn,
}: {
  profileId: string;
  onSuccess: () => void;
  onLearn: (params: any) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState<LearningDomain>("coding_style");
  const [type, setType] = useState<PatternType>("custom");
  const [pattern, setPattern] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !pattern.trim()) {
      toast.error("Please fill in required fields");
      return;
    }
    onLearn({
      profileId,
      domain,
      type,
      name: name.trim(),
      description: description.trim() || undefined,
      pattern: pattern.trim(),
    });
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Add Pattern</DialogTitle>
        <DialogDescription>Teach the AI a new pattern or preference.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label>Name *</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Prefer arrow functions"
          />
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe when this pattern should be applied..."
            rows={2}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Domain</Label>
            <Select value={domain} onValueChange={(v) => setDomain(v as LearningDomain)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_DOMAINS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {DOMAIN_CONFIG[d].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as PatternType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PATTERN_TYPE_CONFIG).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Pattern *</Label>
          <Textarea
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="Describe the pattern, preference, or rule..."
            rows={4}
            className="font-mono text-sm"
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="submit">Add Pattern</Button>
      </DialogFooter>
    </form>
  );
}

function AddExampleForm({
  patternId,
  onAdd,
}: {
  patternId: PatternId;
  onAdd: (params: { patternId: PatternId; example: PatternExample }) => void;
}) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [context, setContext] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !output.trim()) {
      toast.error("Please fill in input and output");
      return;
    }
    onAdd({
      patternId,
      example: {
        input: input.trim(),
        output: output.trim(),
        context: context.trim() || undefined,
        timestamp: Date.now(),
      },
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Add Example</DialogTitle>
        <DialogDescription>Add an example to help the AI understand this pattern.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label>Input *</Label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What the AI might receive..."
            rows={2}
          />
        </div>
        <div className="space-y-2">
          <Label>Expected Output *</Label>
          <Textarea
            value={output}
            onChange={(e) => setOutput(e.target.value)}
            placeholder="What the AI should produce..."
            rows={2}
          />
        </div>
        <div className="space-y-2">
          <Label>Context (optional)</Label>
          <Input
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Additional context..."
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="submit">Add Example</Button>
      </DialogFooter>
    </form>
  );
}

// ============ Feedback Tab ============

function FeedbackTab({ manager }: { manager: ReturnType<typeof useAILearningManager> }) {
  const [typeFilter, setTypeFilter] = useState<FeedbackType | "all">("all");

  const filteredFeedback = useMemo(() => {
    if (typeFilter === "all") return manager.feedback;
    return manager.feedback.filter((f) => f.type === typeFilter);
  }, [manager.feedback, typeFilter]);

  if (!manager.activeProfile) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <User className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Please activate a profile to view feedback</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Filter */}
        <div className="flex items-center gap-2">
          <Button
            variant={typeFilter === "all" ? "secondary" : "outline"}
            size="sm"
            onClick={() => setTypeFilter("all")}
          >
            All
          </Button>
          {(Object.keys(FEEDBACK_TYPE_CONFIG) as FeedbackType[]).map((type) => {
            const config = FEEDBACK_TYPE_CONFIG[type];
            const Icon = config.icon;
            return (
              <Button
                key={type}
                variant={typeFilter === type ? "secondary" : "outline"}
                size="sm"
                className="gap-1"
                onClick={() => setTypeFilter(type)}
              >
                <Icon className={cn("w-4 h-4", config.color)} />
                {config.label}
              </Button>
            );
          })}
        </div>

        {/* Feedback list */}
        <div className="space-y-4">
          {filteredFeedback.map((feedback) => (
            <FeedbackCard key={feedback.id} feedback={feedback} />
          ))}
          {filteredFeedback.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <MessageSquare className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  No feedback recorded yet. Give feedback on AI responses to help it learn.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

function FeedbackCard({ feedback }: { feedback: UserFeedback }) {
  const typeConfig = FEEDBACK_TYPE_CONFIG[feedback.type];
  const domainConfig = DOMAIN_CONFIG[feedback.domain];
  const Icon = typeConfig.icon;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Icon className={cn("w-5 h-5", typeConfig.color)} />
            <CardTitle className="text-base">{typeConfig.label} Feedback</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1 text-xs">
              <div className={cn("w-2 h-2 rounded-full", domainConfig.color)} />
              {domainConfig.label}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {new Date(feedback.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <span className="text-xs text-muted-foreground">Original Response:</span>
          <p className="text-sm mt-1 line-clamp-3">{feedback.originalResponse}</p>
        </div>
        {feedback.correctedResponse && (
          <div>
            <span className="text-xs text-muted-foreground">Corrected Response:</span>
            <p className="text-sm mt-1 line-clamp-3">{feedback.correctedResponse}</p>
          </div>
        )}
        {feedback.feedbackText && (
          <div>
            <span className="text-xs text-muted-foreground">Notes:</span>
            <p className="text-sm mt-1 text-muted-foreground">{feedback.feedbackText}</p>
          </div>
        )}
        {feedback.appliedToPattern && (
          <Badge variant="outline" className="text-xs gap-1">
            <CheckCircle className="w-3 h-3 text-green-500" />
            Applied to Pattern
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

// ============ Style Guide Tab ============

function StyleGuideTab({ manager }: { manager: ReturnType<typeof useAILearningManager> }) {
  const [localStyle, setLocalStyle] = useState<Partial<StyleGuide>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const currentStyle = { ...manager.styleGuide, ...localStyle };

  const handleChange = <K extends keyof StyleGuide>(key: K, value: StyleGuide[K]) => {
    setLocalStyle((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    manager.updateStyleGuide(localStyle);
    setLocalStyle({});
    setHasChanges(false);
  };

  const handleReset = () => {
    setLocalStyle({});
    setHasChanges(false);
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Code Style Guide</h2>
            <p className="text-sm text-muted-foreground">
              Configure your preferred coding style
            </p>
          </div>
          {hasChanges && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleReset}>
                Reset
              </Button>
              <Button onClick={handleSave}>Save Changes</Button>
            </div>
          )}
        </div>

        {/* Indentation */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Indentation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Label className="w-24">Type</Label>
              <Select
                value={currentStyle.indentation}
                onValueChange={(v) => handleChange("indentation", v as "spaces" | "tabs")}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="spaces">Spaces</SelectItem>
                  <SelectItem value="tabs">Tabs</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4">
              <Label className="w-24">Size</Label>
              <Select
                value={String(currentStyle.indentSize || 2)}
                onValueChange={(v) => handleChange("indentSize", parseInt(v))}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="4">4</SelectItem>
                  <SelectItem value="8">8</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Quotes & Semicolons */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Syntax Preferences</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Label className="w-24">Quotes</Label>
              <Select
                value={currentStyle.quotes}
                onValueChange={(v) => handleChange("quotes", v as "single" | "double")}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single</SelectItem>
                  <SelectItem value="double">Double</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Semicolons</Label>
                <p className="text-sm text-muted-foreground">Use semicolons at end of statements</p>
              </div>
              <Switch
                checked={currentStyle.semicolons}
                onCheckedChange={(v) => handleChange("semicolons", v)}
              />
            </div>
            <div className="flex items-center gap-4">
              <Label className="w-32">Trailing Comma</Label>
              <Select
                value={currentStyle.trailingComma}
                onValueChange={(v) => handleChange("trailingComma", v as "none" | "es5" | "all")}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="es5">ES5</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Bracket Spacing</Label>
                <p className="text-sm text-muted-foreground">Add spaces inside object braces</p>
              </div>
              <Switch
                checked={currentStyle.bracketSpacing}
                onCheckedChange={(v) => handleChange("bracketSpacing", v)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Naming Conventions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Naming Conventions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Label className="w-24">Variables</Label>
              <Select
                value={currentStyle.namingConventions?.variables}
                onValueChange={(v) =>
                  handleChange("namingConventions", {
                    ...currentStyle.namingConventions!,
                    variables: v as "camelCase" | "snake_case" | "PascalCase",
                  })
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="camelCase">camelCase</SelectItem>
                  <SelectItem value="snake_case">snake_case</SelectItem>
                  <SelectItem value="PascalCase">PascalCase</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4">
              <Label className="w-24">Functions</Label>
              <Select
                value={currentStyle.namingConventions?.functions}
                onValueChange={(v) =>
                  handleChange("namingConventions", {
                    ...currentStyle.namingConventions!,
                    functions: v as "camelCase" | "snake_case" | "PascalCase",
                  })
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="camelCase">camelCase</SelectItem>
                  <SelectItem value="snake_case">snake_case</SelectItem>
                  <SelectItem value="PascalCase">PascalCase</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4">
              <Label className="w-24">Files</Label>
              <Select
                value={currentStyle.namingConventions?.files}
                onValueChange={(v) =>
                  handleChange("namingConventions", {
                    ...currentStyle.namingConventions!,
                    files: v as "kebab-case" | "camelCase" | "snake_case" | "PascalCase",
                  })
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kebab-case">kebab-case</SelectItem>
                  <SelectItem value="camelCase">camelCase</SelectItem>
                  <SelectItem value="snake_case">snake_case</SelectItem>
                  <SelectItem value="PascalCase">PascalCase</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Comments */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comment Style</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Prefer JSDoc</Label>
                <p className="text-sm text-muted-foreground">Use JSDoc style for documentation</p>
              </div>
              <Switch
                checked={currentStyle.commentStyle?.preferJSDoc}
                onCheckedChange={(v) =>
                  handleChange("commentStyle", {
                    ...currentStyle.commentStyle!,
                    preferJSDoc: v,
                  })
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Inline Comments</Label>
                <p className="text-sm text-muted-foreground">Use inline // comments</p>
              </div>
              <Switch
                checked={currentStyle.commentStyle?.inlineComments}
                onCheckedChange={(v) =>
                  handleChange("commentStyle", {
                    ...currentStyle.commentStyle!,
                    inlineComments: v,
                  })
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Line Width */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Line Width</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Label className="w-24">Max Width</Label>
              <Input
                type="number"
                value={currentStyle.lineWidth || 100}
                onChange={(e) => handleChange("lineWidth", parseInt(e.target.value))}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">characters</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

// ============ Preferences Tab ============

function PreferencesTab({ manager }: { manager: ReturnType<typeof useAILearningManager> }) {
  const [localPrefs, setLocalPrefs] = useState<Partial<CommunicationPreferences>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const currentPrefs = { ...manager.communicationPrefs, ...localPrefs };

  const handleChange = <K extends keyof CommunicationPreferences>(
    key: K,
    value: CommunicationPreferences[K]
  ) => {
    setLocalPrefs((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    manager.updateCommunicationPrefs(localPrefs);
    setLocalPrefs({});
    setHasChanges(false);
  };

  const handleReset = () => {
    setLocalPrefs({});
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Communication Preferences</h2>
            <p className="text-sm text-muted-foreground">
              Configure how the AI communicates with you
            </p>
          </div>
          {hasChanges && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleReset}>
                Reset
              </Button>
              <Button onClick={handleSave}>Save Changes</Button>
            </div>
          )}
        </div>

        {/* Response Length */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Response Length</CardTitle>
            <CardDescription>How detailed should responses be?</CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={currentPrefs.responseLength}
              onValueChange={(v) =>
                handleChange("responseLength", v as CommunicationPreferences["responseLength"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="concise">Concise - Brief and to the point</SelectItem>
                <SelectItem value="moderate">Moderate - Balanced detail</SelectItem>
                <SelectItem value="detailed">Detailed - Comprehensive explanations</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Formality */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Formality Level</CardTitle>
            <CardDescription>The tone of AI responses</CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={currentPrefs.formality}
              onValueChange={(v) =>
                handleChange("formality", v as CommunicationPreferences["formality"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="casual">Casual - Friendly and relaxed</SelectItem>
                <SelectItem value="neutral">Neutral - Professional but approachable</SelectItem>
                <SelectItem value="formal">Formal - Professional and precise</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Explanation Depth */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Explanation Depth</CardTitle>
            <CardDescription>How much detail in explanations?</CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={currentPrefs.explanationDepth}
              onValueChange={(v) =>
                handleChange("explanationDepth", v as CommunicationPreferences["explanationDepth"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="brief">Brief - Just the essentials</SelectItem>
                <SelectItem value="moderate">Moderate - Key concepts explained</SelectItem>
                <SelectItem value="comprehensive">Comprehensive - Full context and reasoning</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Code Comments */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Code Comments</CardTitle>
            <CardDescription>How much code should be commented?</CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={currentPrefs.codeComments}
              onValueChange={(v) =>
                handleChange("codeComments", v as CommunicationPreferences["codeComments"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minimal">Minimal - Only when necessary</SelectItem>
                <SelectItem value="moderate">Moderate - Important sections</SelectItem>
                <SelectItem value="verbose">Verbose - Detailed documentation</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Boolean preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Additional Preferences</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Include Examples</Label>
                <p className="text-sm text-muted-foreground">Show code examples in explanations</p>
              </div>
              <Switch
                checked={currentPrefs.includeExamples}
                onCheckedChange={(v) => handleChange("includeExamples", v)}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label>Include Alternatives</Label>
                <p className="text-sm text-muted-foreground">Suggest alternative approaches</p>
              </div>
              <Switch
                checked={currentPrefs.includeAlternatives}
                onCheckedChange={(v) => handleChange("includeAlternatives", v)}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label>Show Step-by-Step</Label>
                <p className="text-sm text-muted-foreground">Break down complex tasks into steps</p>
              </div>
              <Switch
                checked={currentPrefs.showStepByStep}
                onCheckedChange={(v) => handleChange("showStepByStep", v)}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

// ============ Stats Tab ============

function StatsTab({ manager }: { manager: ReturnType<typeof useAILearningManager> }) {
  const [generatedContext, setGeneratedContext] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateContext = async () => {
    setIsGenerating(true);
    try {
      const context = await manager.generateContext({});
      setGeneratedContext(context);
    } catch (error) {
      toast.error("Failed to generate context");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyContext = () => {
    if (generatedContext) {
      navigator.clipboard.writeText(generatedContext);
      toast.success("Context copied to clipboard");
    }
  };

  const stats = manager.stats;

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Learning Statistics</h2>
          <p className="text-sm text-muted-foreground">
            Overview of your AI learning data
          </p>
        </div>

        {/* Stats cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Profiles</CardDescription>
              <CardTitle className="text-3xl">{stats?.totalProfiles ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Patterns</CardDescription>
              <CardTitle className="text-3xl">{stats?.totalPatterns ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Feedback</CardDescription>
              <CardTitle className="text-3xl">{stats?.totalFeedback ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Avg. Confidence</CardDescription>
              <CardTitle className="text-3xl">{stats?.averageConfidence ? Math.round(stats.averageConfidence * 100) : 0}%</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Patterns by domain */}
        {stats?.patternsByDomain && Object.keys(stats.patternsByDomain).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Patterns by Domain</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(stats.patternsByDomain).map(([domain, count]) => {
                  const config = DOMAIN_CONFIG[domain as LearningDomain];
                  const percentage = stats.totalPatterns
                    ? Math.round((count / stats.totalPatterns) * 100)
                    : 0;
                  return (
                    <div key={domain} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className={cn("w-3 h-3 rounded-full", config?.color)} />
                          <span>{config?.label || domain}</span>
                        </div>
                        <span className="text-muted-foreground">
                          {count} ({percentage}%)
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full", config?.color)}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Context preview */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Generated AI Context</CardTitle>
                <CardDescription>
                  Preview the context that will be sent to the AI
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {generatedContext && (
                  <Button variant="outline" size="sm" onClick={handleCopyContext}>
                    <Copy className="w-4 h-4 mr-1" />
                    Copy
                  </Button>
                )}
                <Button onClick={handleGenerateContext} disabled={isGenerating}>
                  {isGenerating ? (
                    <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-1" />
                  )}
                  Generate
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {generatedContext ? (
              <pre className="p-4 bg-muted rounded-lg text-sm font-mono whitespace-pre-wrap overflow-x-auto max-h-96">
                {generatedContext}
              </pre>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Click "Generate" to see the AI context based on your learning data
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
