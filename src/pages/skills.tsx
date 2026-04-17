/**
 * Skills Page
 *
 * Three tabs: My Skills / Skill Store / Generate
 * - My Skills: grid of skill cards with enable/disable, edit, delete, publish
 * - Skill Store: browse marketplace skills (placeholder)
 * - Generate: NLP prompt to auto-generate a skill from plain English
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft,
  Sparkles,
  Plus,
  Trash2,
  Play,
  Download,
  Upload,
  Wand2,
  Search,
  Package,
  Code,
  MessageSquare,
  Workflow,
  Wrench,
  Loader2,
  Pencil,
} from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import type { Skill, CreateSkillParams } from "@/types/skill_types";
import type { AgentCapability } from "@/types/agent_factory_types";

const ipc = IpcClient.getInstance();

const CATEGORY_COLORS: Record<string, string> = {
  text_generation: "bg-blue-500/20 text-blue-400",
  code_generation: "bg-green-500/20 text-green-400",
  code_review: "bg-emerald-500/20 text-emerald-400",
  summarization: "bg-purple-500/20 text-purple-400",
  translation: "bg-indigo-500/20 text-indigo-400",
  question_answering: "bg-cyan-500/20 text-cyan-400",
  reasoning: "bg-amber-500/20 text-amber-400",
  math: "bg-red-500/20 text-red-400",
  vision: "bg-pink-500/20 text-pink-400",
  function_calling: "bg-teal-500/20 text-teal-400",
  web_search: "bg-sky-500/20 text-sky-400",
  file_operations: "bg-slate-500/20 text-slate-400",
  data_analysis: "bg-orange-500/20 text-orange-400",
  creative_writing: "bg-fuchsia-500/20 text-fuchsia-400",
  structured_output: "bg-lime-500/20 text-lime-400",
};

const IMPL_ICONS: Record<string, React.ReactNode> = {
  prompt: <MessageSquare className="h-3.5 w-3.5" />,
  function: <Code className="h-3.5 w-3.5" />,
  tool: <Wrench className="h-3.5 w-3.5" />,
  workflow: <Workflow className="h-3.5 w-3.5" />,
};

export default function SkillsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [activeTab, setActiveTab] = useState("my-skills");

  // Edit skill state
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [editSkillName, setEditSkillName] = useState("");
  const [editSkillDesc, setEditSkillDesc] = useState("");

  // ── Queries ──

  const { data: skills = [], isLoading } = useQuery({
    queryKey: ["skills", searchQuery],
    queryFn: () =>
      ipc.listSkills(searchQuery ? { query: searchQuery } : undefined),
  });

  // ── Mutations ──

  const createMutation = useMutation({
    mutationFn: (params: CreateSkillParams) => ipc.createSkill(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      toast.success("Skill created");
    },
    onError: (err) => toast.error(`Failed to create: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ipc.deleteSkill(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      setSelectedSkill(null);
      toast.success("Skill deleted");
    },
    onError: (err) => toast.error(`Failed to delete: ${err.message}`),
  });

  const toggleMutation = useMutation({
    mutationFn: (skill: Skill) =>
      ipc.updateSkill({ id: skill.id, enabled: !skill.enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: (err) => toast.error(`Toggle failed: ${err.message}`),
  });

  const updateSkillMutation = useMutation({
    mutationFn: (params: { id: number; name: string; description: string }) =>
      ipc.updateSkill(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      toast.success("Skill updated");
      setEditingSkill(null);
    },
    onError: (err) => toast.error(`Update failed: ${err.message}`),
  });

  const generateMutation = useMutation({
    mutationFn: (description: string) =>
      ipc.generateSkill({ description }),
    onSuccess: async (result) => {
      const skill = await ipc.createSkill(result.skill);
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      setSelectedSkill(skill);
      setGeneratePrompt("");
      setActiveTab("my-skills");
      toast.success(`Skill "${skill.name}" generated!`);
    },
    onError: (err) => toast.error(`Generation failed: ${err.message}`),
  });

  const executeMutation = useMutation({
    mutationFn: (params: { skillId: number; input: string }) =>
      ipc.executeSkill({ skillId: params.skillId, input: params.input }),
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Output: ${result.output.slice(0, 200)}`);
      } else {
        toast.error(`Execution failed: ${result.error}`);
      }
    },
    onError: (err) => toast.error(`Execute failed: ${err.message}`),
  });

  const exportMutation = useMutation({
    mutationFn: (id: number) => ipc.exportSkill(id),
    onSuccess: (json) => {
      navigator.clipboard.writeText(json);
      toast.success("Skill JSON copied to clipboard");
    },
    onError: (err) => toast.error(`Export failed: ${err.message}`),
  });

  const bootstrapMutation = useMutation({
    mutationFn: () => ipc.bootstrapSkills(),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      toast.success(
        count > 0
          ? `Bootstrapped ${count} core skills`
          : "All core skills already exist",
      );
    },
    onError: (err) => toast.error(`Bootstrap failed: ${err.message}`),
  });

  const exportMdMutation = useMutation({
    mutationFn: () => ipc.exportSkillsMd(),
    onSuccess: () => {
      toast.success("Skills exported to skills.md in app data folder");
    },
    onError: (err) => toast.error(`Export MD failed: ${err.message}`),
  });

  // ── Render ──

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-7xl">
        <Button
          onClick={() => router.history.back()}
          variant="outline"
          size="sm"
          className="flex items-center gap-2 mb-6 border-border/50 hover:border-primary/30 hover:bg-primary/5 transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>

        {/* Header */}
        <div className="mb-8 p-6 rounded-2xl bg-gradient-to-r from-orange-500/10 via-amber-500/10 to-yellow-500/10 border border-orange-500/20">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-orange-500/20 via-amber-500/20 to-yellow-500/20 border border-orange-500/20">
              <Sparkles className="h-7 w-7 text-orange-400" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-orange-400 via-amber-400 to-yellow-400 bg-clip-text text-transparent">
                Skill Center
              </h1>
              <p className="text-muted-foreground text-sm">
                Create, manage, and teach your bots new skills — powered by NLP
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => bootstrapMutation.mutate()}
                disabled={bootstrapMutation.isPending}
              >
                {bootstrapMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Package className="h-4 w-4 mr-1" />
                )}
                Bootstrap Core Skills
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportMdMutation.mutate()}
                disabled={exportMdMutation.isPending}
              >
                {exportMdMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-1" />
                )}
                Export SKILLS.md
              </Button>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="my-skills">My Skills</TabsTrigger>
            <TabsTrigger value="store">Skill Store</TabsTrigger>
            <TabsTrigger value="generate">Generate</TabsTrigger>
          </TabsList>

          {/* ── My Skills Tab ── */}
          <TabsContent value="my-skills" className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search skills..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button
                size="sm"
                onClick={() => setActiveTab("generate")}
              >
                <Plus className="h-4 w-4 mr-1" />
                New Skill
              </Button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : skills.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">
                <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">No skills yet</p>
                <p className="text-sm mt-1">
                  Create one manually or use the Generate tab to describe a
                  skill in plain English.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {skills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    selected={selectedSkill?.id === skill.id}
                    onSelect={() =>
                      setSelectedSkill(
                        selectedSkill?.id === skill.id ? null : skill,
                      )
                    }
                    onToggle={() => toggleMutation.mutate(skill)}
                    onDelete={() => deleteMutation.mutate(skill.id)}
                    onExecute={() =>
                      executeMutation.mutate({
                        skillId: skill.id,
                        input: "test",
                      })
                    }
                    onExport={() => exportMutation.mutate(skill.id)}
                    onEdit={() => {
                      setEditSkillName(skill.name);
                      setEditSkillDesc(skill.description);
                      setEditingSkill(skill);
                    }}
                  />
                ))}
              </div>
            )}

            {/* Selected skill detail */}
            {selectedSkill && (
              <SkillDetail
                skill={selectedSkill}
                onClose={() => setSelectedSkill(null)}
              />
            )}
          </TabsContent>

          {/* ── Skill Store Tab ── */}
          <TabsContent value="store">
            <div className="text-center py-20 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium">
                Skill Marketplace — Coming Soon
              </p>
              <p className="text-sm mt-1">
                Browse and install skills from the JoyMarketplace.
              </p>
            </div>
          </TabsContent>

          {/* ── Generate Tab ── */}
          <TabsContent value="generate" className="space-y-6">
            <div className="max-w-2xl mx-auto">
              <div className="p-6 rounded-xl border border-border/50 bg-card">
                <div className="flex items-center gap-3 mb-4">
                  <Wand2 className="h-5 w-5 text-orange-400" />
                  <h2 className="text-lg font-semibold">
                    Generate a Skill with AI
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Describe what you want the skill to do in plain English. The
                  AI will generate trigger patterns, implementation, and
                  examples.
                </p>
                <Textarea
                  placeholder='e.g. "Summarize emails into bullet points" or "Translate text to Spanish and back"'
                  value={generatePrompt}
                  onChange={(e) => setGeneratePrompt(e.target.value)}
                  className="min-h-[120px] mb-4"
                />
                <Button
                  onClick={() => generateMutation.mutate(generatePrompt)}
                  disabled={
                    !generatePrompt.trim() || generateMutation.isPending
                  }
                  className="w-full"
                >
                  {generateMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate Skill
                    </>
                  )}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit Skill Dialog */}
      <Dialog open={!!editingSkill} onOpenChange={(open) => { if (!open) setEditingSkill(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Skill</DialogTitle>
            <DialogDescription>Update the name and description of this skill.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={editSkillName} onChange={(e) => setEditSkillName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea value={editSkillDesc} onChange={(e) => setEditSkillDesc(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSkill(null)}>Cancel</Button>
            <Button
              disabled={!editSkillName.trim() || updateSkillMutation.isPending}
              onClick={() => editingSkill && updateSkillMutation.mutate({ id: editingSkill.id, name: editSkillName.trim(), description: editSkillDesc.trim() })}
            >
              {updateSkillMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Skill Card Component ──

function SkillCard({
  skill,
  selected,
  onSelect,
  onToggle,
  onDelete,
  onExecute,
  onExport,
  onEdit,
}: {
  skill: Skill;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onExecute: () => void;
  onExport: () => void;
  onEdit: () => void;
}) {
  const catColor =
    CATEGORY_COLORS[skill.category] ?? "bg-gray-500/20 text-gray-400";

  return (
    <div
      onClick={onSelect}
      className={`p-4 rounded-xl border cursor-pointer transition-all hover:border-orange-500/30 hover:bg-orange-500/5 ${
        selected
          ? "border-orange-500/50 bg-orange-500/5 ring-1 ring-orange-500/20"
          : "border-border/50 bg-card"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-orange-400">
            {IMPL_ICONS[skill.implementationType] ?? (
              <Sparkles className="h-3.5 w-3.5" />
            )}
          </span>
          <h3 className="font-medium text-sm truncate">{skill.name}</h3>
        </div>
        <Switch
          checked={skill.enabled}
          onCheckedChange={(e) => {
            e.preventDefault?.();
            onToggle();
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
        {skill.description}
      </p>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <Badge variant="secondary" className={`text-[10px] ${catColor}`}>
          {skill.category}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {skill.implementationType}
        </Badge>
        {skill.triggerPatterns.length > 0 && (
          <Badge variant="outline" className="text-[10px]">
            {skill.triggerPatterns.length} trigger
            {skill.triggerPatterns.length > 1 ? "s" : ""}
          </Badge>
        )}
      </div>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={(e) => {
            e.stopPropagation();
            onExecute();
          }}
        >
          <Play className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={(e) => {
            e.stopPropagation();
            onExport();
          }}
        >
          <Download className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-red-400 hover:text-red-300"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Skill Detail Panel ──

function SkillDetail({
  skill,
  onClose,
}: {
  skill: Skill;
  onClose: () => void;
}) {
  return (
    <div className="mt-6 p-6 rounded-xl border border-border/50 bg-card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{skill.name}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          ✕
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">Category:</span>{" "}
          {skill.category}
        </div>
        <div>
          <span className="text-muted-foreground">Type:</span> {skill.type}
        </div>
        <div>
          <span className="text-muted-foreground">Implementation:</span>{" "}
          {skill.implementationType}
        </div>
        <div>
          <span className="text-muted-foreground">Version:</span>{" "}
          {skill.version}
        </div>
        <div>
          <span className="text-muted-foreground">Enabled:</span>{" "}
          {skill.enabled ? "Yes" : "No"}
        </div>
        <div>
          <span className="text-muted-foreground">Publish status:</span>{" "}
          {skill.publishStatus}
        </div>
      </div>
      {skill.triggerPatterns.length > 0 && (
        <div className="mt-4">
          <span className="text-sm text-muted-foreground">
            Trigger patterns:
          </span>
          <div className="flex flex-wrap gap-2 mt-1">
            {skill.triggerPatterns.map((t, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {t.type}: {t.pattern}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {skill.implementationCode && (
        <div className="mt-4">
          <span className="text-sm text-muted-foreground">
            Implementation:
          </span>
          <pre className="mt-1 p-3 rounded-lg bg-muted/50 text-xs overflow-x-auto max-h-60">
            {skill.implementationCode}
          </pre>
        </div>
      )}
      {skill.examples.length > 0 && (
        <div className="mt-4">
          <span className="text-sm text-muted-foreground">Examples:</span>
          <div className="mt-1 space-y-2">
            {skill.examples.map((ex, i) => (
              <div key={i} className="p-2 rounded-lg bg-muted/30 text-xs">
                <div>
                  <strong>Input:</strong> {ex.input}
                </div>
                <div>
                  <strong>Output:</strong> {ex.expectedOutput}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {skill.tags.length > 0 && (
        <div className="mt-4">
          <span className="text-sm text-muted-foreground">Tags:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {skill.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
