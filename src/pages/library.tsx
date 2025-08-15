import React, { useState } from "react";
import { usePrompts } from "@/hooks/usePrompts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Save, Edit2 } from "lucide-react";

export default function LibraryPage() {
  const { prompts, isLoading, createPrompt, updatePrompt, deletePrompt } =
    usePrompts();
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    content: "",
  });

  const resetDraft = () =>
    setDraft({ title: "", description: "", content: "" });

  const onCreate = async () => {
    if (!draft.title.trim() || !draft.content.trim()) return;
    await createPrompt({
      title: draft.title.trim(),
      description: draft.description.trim() || undefined,
      content: draft.content,
    });
    resetDraft();
    setIsCreating(false);
  };

  return (
    <div className="min-h-screen px-8 py-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">Library</h1>
          <Button onClick={() => setIsCreating((v) => !v)}>
            <Plus className="mr-2 h-4 w-4" /> New Prompt
          </Button>
        </div>

        {isCreating && (
          <div className="border rounded-lg p-4 mb-8 space-y-3 bg-(--background-lightest)">
            <Input
              placeholder="Title"
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
            />
            <Input
              placeholder="Description (optional)"
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
            />
            <Textarea
              rows={6}
              placeholder="Content"
              value={draft.content}
              onChange={(e) =>
                setDraft((d) => ({ ...d, content: e.target.value }))
              }
            />
            {null}
            <div className="flex gap-2">
              <Button onClick={onCreate}>
                <Save className="mr-2 h-4 w-4" /> Save
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  resetDraft();
                  setIsCreating(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div>Loading...</div>
        ) : prompts.length === 0 ? (
          <div className="text-muted-foreground">
            No prompts yet. Create one to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {prompts.map((p) => (
              <PromptCard
                key={p.id}
                prompt={p}
                onUpdate={updatePrompt}
                onDelete={deletePrompt}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PromptCard({
  prompt,
  onUpdate,
  onDelete,
}: {
  prompt: {
    id: number;
    title: string;
    description: string | null;
    content: string;
  };
  onUpdate: (p: {
    id: number;
    title: string;
    description?: string;
    content: string;
  }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(prompt.title);
  const [description, setDescription] = useState(prompt.description ?? "");
  const [content, setContent] = useState(prompt.content);

  const save = async () => {
    await onUpdate({
      id: prompt.id,
      title: title.trim(),
      description: description.trim() || undefined,
      content,
    });
    setEditing(false);
  };

  return (
    <div className="border rounded-lg p-4 bg-(--background-lightest)">
      {editing ? (
        <div className="space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Textarea
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          {null}
          <div className="flex gap-2">
            <Button onClick={save}>
              <Save className="mr-2 h-4 w-4" /> Save
            </Button>
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold">{prompt.title}</h3>
              {prompt.description && (
                <p className="text-sm text-muted-foreground">
                  {prompt.description}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setEditing(true)}
              >
                <Edit2 className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onDelete(prompt.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <pre className="text-sm whitespace-pre-wrap bg-transparent border rounded p-2 max-h-48 overflow-auto">
            {prompt.content}
          </pre>
          {null}
        </div>
      )}
    </div>
  );
}
