import { useEffect, useMemo, useState } from "react";
import { useAtom } from "jotai";
import {
  FileText,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import { notesVaultAtom, type VaultNote } from "@/atoms/notesVaultAtoms";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createVaultNote,
  noteDisplayTitle,
  searchVaultNotes,
} from "@/lib/notes_vault";
import { cn } from "@/lib/utils";

function notePreview(note: VaultNote) {
  return note.body.trim().replace(/\s+/g, " ") || "No additional text";
}

function countWords(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export default function NotesVaultPage() {
  const [notes, setNotes] = useAtom(notesVaultAtom);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const visibleNotes = useMemo(
    () => searchVaultNotes(notes, query),
    [notes, query],
  );
  const selected = notes.find((note) => note.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && notes.some((note) => note.id === selectedId)) return;
    setSelectedId(visibleNotes[0]?.id ?? null);
  }, [notes, selectedId, visibleNotes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "n"
      ) {
        return;
      }
      event.preventDefault();
      const note = createVaultNote();
      setNotes((current) => [note, ...current]);
      setSelectedId(note.id);
      setQuery("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setNotes]);

  const createNote = () => {
    const note = createVaultNote();
    setNotes((current) => [note, ...current]);
    setSelectedId(note.id);
    setQuery("");
  };

  const updateSelected = (
    patch: Partial<Pick<VaultNote, "title" | "body" | "pinned">>,
  ) => {
    if (!selectedId) return;
    setNotes((current) =>
      current.map((note) =>
        note.id === selectedId
          ? { ...note, ...patch, updatedAt: Date.now() }
          : note,
      ),
    );
  };

  const deleteSelected = () => {
    if (!selected) return;
    const next = notes.filter((note) => note.id !== selected.id);
    setNotes(next);
    setSelectedId(searchVaultNotes(next, query)[0]?.id ?? null);
    setDeleteOpen(false);
  };

  return (
    <div
      className="notes-vault mx-auto flex h-full min-h-[32rem] w-full max-w-6xl overflow-hidden p-3 sm:p-5"
      data-testid="notes-vault"
    >
      <div className="flex min-h-0 w-full overflow-hidden rounded-3xl border border-border/70 bg-card/90 text-card-foreground shadow-xl backdrop-blur-xl">
        <aside
          className={cn(
            "min-h-0 shrink-0 border-r border-border/70 bg-muted/25 transition-[width] duration-200",
            sidebarOpen ? "w-72" : "w-0 overflow-hidden border-r-0",
          )}
        >
          <div className="flex h-full min-w-72 flex-col">
            <div className="border-b border-border/70 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-xl bg-primary/12 text-primary">
                    <NotebookPen className="size-4" />
                  </span>
                  <div>
                    <h1 className="text-sm font-semibold">Notes Vault</h1>
                    <p className="text-[10px] text-muted-foreground">
                      {notes.length} saved{" "}
                      {notes.length === 1 ? "note" : "notes"}
                    </p>
                  </div>
                </div>
                <Button
                  size="icon"
                  className="size-8"
                  onClick={createNote}
                  aria-label="New note"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search notes"
                  className="h-8 pl-8 text-xs"
                  aria-label="Search notes"
                />
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {visibleNotes.length ? (
                <div className="space-y-1">
                  {visibleNotes.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => setSelectedId(note.id)}
                      className={cn(
                        "group w-full rounded-xl border px-3 py-2.5 text-left transition",
                        selectedId === note.id
                          ? "border-primary/30 bg-primary/10"
                          : "border-transparent hover:border-border hover:bg-accent/50",
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        {note.pinned && (
                          <Pin className="size-3 shrink-0 fill-primary/20 text-primary" />
                        )}
                        <span className="truncate text-sm font-medium">
                          {noteDisplayTitle(note)}
                        </span>
                      </span>
                      <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-muted-foreground">
                        {notePreview(note)}
                      </span>
                      <span className="mt-1.5 block text-[10px] text-muted-foreground/70">
                        {new Intl.DateTimeFormat(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(note.updatedAt)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid h-full place-items-center px-5 text-center">
                  <div>
                    <FileText className="mx-auto size-7 text-muted-foreground/45" />
                    <p className="mt-2 text-xs text-muted-foreground">
                      {query ? "No matching notes" : "Your vault is empty"}
                    </p>
                    {!query && (
                      <Button variant="link" size="sm" onClick={createNote}>
                        Create your first note
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-3 sm:px-4">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label={sidebarOpen ? "Hide notes list" : "Show notes list"}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="size-4" />
              ) : (
                <PanelLeftOpen className="size-4" />
              )}
            </Button>
            {selected && (
              <>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  Edited{" "}
                  {new Intl.RelativeTimeFormat(undefined, {
                    numeric: "auto",
                  }).format(
                    -Math.max(
                      0,
                      Math.round((Date.now() - selected.updatedAt) / 60_000),
                    ),
                    "minute",
                  )}
                </span>
                <span className="text-[11px] text-emerald-600">
                  Saved locally
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("size-8", selected.pinned && "text-primary")}
                  onClick={() => updateSelected({ pinned: !selected.pinned })}
                  aria-label={selected.pinned ? "Unpin note" : "Pin note"}
                >
                  <Pin
                    className={cn("size-4", selected.pinned && "fill-current")}
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                  aria-label="Delete note"
                >
                  <Trash2 className="size-4" />
                </Button>
              </>
            )}
          </div>

          {selected ? (
            <div className="flex min-h-0 flex-1 flex-col px-5 py-4 sm:px-10 sm:py-7">
              <input
                value={selected.title}
                onChange={(event) =>
                  updateSelected({ title: event.target.value })
                }
                placeholder="Untitled note"
                className="w-full border-0 bg-transparent text-2xl font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/45"
                aria-label="Note title"
              />
              <textarea
                value={selected.body}
                onChange={(event) =>
                  updateSelected({ body: event.target.value })
                }
                placeholder="Start typing…"
                className="mt-4 min-h-0 flex-1 resize-none border-0 bg-transparent font-mono text-[14px] leading-7 text-foreground/90 outline-none placeholder:text-muted-foreground/45"
                aria-label="Note body"
                spellCheck
              />
              <div className="flex shrink-0 items-center justify-between border-t border-border/60 pt-3 text-[10px] text-muted-foreground">
                <span>
                  {countWords(selected.body)} words · {selected.body.length}{" "}
                  characters
                </span>
                <span>⌘N new note · autosaved</span>
              </div>
            </div>
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div>
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <NotebookPen className="size-6" />
                </span>
                <h2 className="mt-4 text-lg font-semibold">
                  A quiet place for your thoughts
                </h2>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Capture ideas, snippets, checklists, or anything you want to
                  keep close.
                </p>
                <Button className="mt-4" onClick={createNote}>
                  <Plus className="size-4" /> New note
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this note?</DialogTitle>
            <DialogDescription>
              “{selected ? noteDisplayTitle(selected) : "Untitled note"}” will
              be permanently removed from this Mac.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteSelected}>
              Delete note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
