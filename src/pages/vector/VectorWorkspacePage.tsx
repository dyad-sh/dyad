import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Archive,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  Database,
  FileSearch,
  FileText,
  FolderPlus,
  HardDrive,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";

import { ParticleBackground } from "@/components/home/ParticleBackground";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ipc, type VectorCollection } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

type VectorSection =
  | "overview"
  | "collections"
  | "sources"
  | "search"
  | "rag"
  | "models"
  | "settings";

const sections = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "collections", label: "Collections", icon: Database },
  { id: "sources", label: "Knowledge Sources", icon: FolderPlus },
  { id: "search", label: "Search", icon: Search },
  { id: "rag", label: "RAG Playground", icon: MessageSquareText },
  { id: "models", label: "Embedding Models", icon: BrainCircuit },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const satisfies ReadonlyArray<{
  id: VectorSection;
  label: string;
  icon: typeof Activity;
}>;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function friendlyDate(value?: string | null): string {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function StatusDot({ state }: { state?: string }) {
  const active = state === "ready" || state === "indexing";
  return (
    <span
      className={cn(
        "size-2 rounded-full",
        active ? "bg-emerald-400 shadow-[0_0_10px_#34d399]" : "bg-amber-400",
      )}
    />
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Database;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-cyan-400/20 bg-slate-950/30 px-8 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-xl border border-cyan-400/20 bg-cyan-400/8">
        <Icon className="size-6 text-cyan-300" />
      </div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function CollectionPicker({
  collections,
  value,
  onChange,
}: {
  collections: VectorCollection[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (collections.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {collections.map((collection) => (
        <button
          key={collection.id}
          type="button"
          onClick={() => onChange(collection.id)}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
            value === collection.id
              ? "border-cyan-400/60 bg-cyan-400/12 text-cyan-100"
              : "border-cyan-400/15 bg-slate-950/35 text-slate-400 hover:border-cyan-400/35 hover:text-white",
          )}
        >
          {value === collection.id && <Check className="size-3.5" />}
          {collection.name}
        </button>
      ))}
    </div>
  );
}

export default function VectorWorkspacePage() {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<VectorSection>("overview");
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    string | null
  >(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<
    Awaited<ReturnType<typeof ipc.vector.search>>
  >([]);
  const [ragQuestion, setRagQuestion] = useState("");
  const [ragAnswer, setRagAnswer] = useState<
    Awaited<ReturnType<typeof ipc.vector.ragQuery>> | undefined
  >();

  const overviewQuery = useQuery({
    queryKey: queryKeys.vector.overview,
    queryFn: async () => {
      await ipc.vector.start();
      return ipc.vector.getOverview();
    },
  });
  const collectionsQuery = useQuery({
    queryKey: queryKeys.vector.collections,
    queryFn: () => ipc.vector.listCollections(),
  });
  const collections = useMemo(
    () => collectionsQuery.data ?? [],
    [collectionsQuery.data],
  );

  useEffect(() => {
    if (!selectedCollectionId && collections[0]) {
      setSelectedCollectionId(collections[0].id);
    }
    if (
      selectedCollectionId &&
      !collections.some((collection) => collection.id === selectedCollectionId)
    ) {
      setSelectedCollectionId(collections[0]?.id ?? null);
    }
  }, [collections, selectedCollectionId]);

  const sourcesQuery = useQuery({
    queryKey: queryKeys.vector.sources({
      collectionId: selectedCollectionId,
    }),
    queryFn: () =>
      ipc.vector.listSources({ collectionId: selectedCollectionId! }),
    enabled: Boolean(selectedCollectionId),
  });

  const refreshWorkspace = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.vector.all });
  };

  const createCollection = async () => {
    if (!newName.trim()) return;
    setBusy("create");
    try {
      const created = await ipc.vector.createCollection({
        name: newName.trim(),
        description: newDescription.trim(),
      });
      setSelectedCollectionId(created.id);
      setNewName("");
      setNewDescription("");
      setCreateOpen(false);
      await refreshWorkspace();
      showSuccess(`Created ${created.name}`);
    } catch (error) {
      showError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const addSources = async () => {
    if (!selectedCollectionId) return;
    try {
      const selection = await ipc.vector.chooseSources({
        collectionId: selectedCollectionId,
      });
      if (selection.paths.length === 0) return;
      setBusy("index");
      await ipc.vector.indexPaths({
        collectionId: selectedCollectionId,
        paths: selection.paths,
      });
      await refreshWorkspace();
      showSuccess("Knowledge is indexed and ready to search");
    } catch (error) {
      showError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const runSearch = async () => {
    if (!selectedCollectionId || !searchText.trim()) return;
    setBusy("search");
    try {
      const results = await ipc.vector.search({
        query: searchText.trim(),
        collectionIds: [selectedCollectionId],
        limit: overviewQuery.data?.settings.defaultResultCount ?? 8,
        minimumScore: overviewQuery.data?.settings.minimumScore ?? 0.12,
      });
      setSearchResults(results);
    } catch (error) {
      showError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const runRag = async () => {
    if (!selectedCollectionId || !ragQuestion.trim()) return;
    setBusy("rag");
    try {
      setRagAnswer(
        await ipc.vector.ragQuery({
          query: ragQuestion.trim(),
          collectionIds: [selectedCollectionId],
          limit: 6,
          allowCloud: false,
        }),
      );
    } catch (error) {
      showError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const renderOverview = () => {
    const overview = overviewQuery.data;
    const metrics = [
      {
        label: "Collections",
        value: overview?.collectionCount ?? 0,
        icon: Database,
      },
      {
        label: "Knowledge sources",
        value: overview?.sourceCount ?? 0,
        icon: FileText,
      },
      {
        label: "Searchable chunks",
        value: overview?.chunkCount ?? 0,
        icon: FileSearch,
      },
      {
        label: "Local storage",
        value: formatBytes(overview?.storageBytes ?? 0),
        icon: HardDrive,
      },
    ];
    return (
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-xl border border-cyan-400/15 bg-slate-950/45 p-4"
            >
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xs font-medium tracking-wide uppercase">
                  {label}
                </span>
                <Icon className="size-4 text-cyan-300/70" />
              </div>
              <div className="mt-3 text-2xl font-semibold text-white">
                {value}
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-2xl border border-cyan-400/20 bg-slate-950/45 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <StatusDot state={overview?.status.state} />
                  <h3 className="font-semibold text-white">
                    Local Vector Engine
                  </h3>
                </div>
                <p className="mt-2 text-sm text-slate-400">
                  {overview?.status.message ?? "Checking the local index…"}
                </p>
              </div>
              <Badge
                variant="outline"
                className="border-emerald-400/25 bg-emerald-400/8 text-emerald-300"
              >
                <LockKeyhole className="mr-1 size-3" />
                Device only
              </Badge>
            </div>
            <div className="mt-5 rounded-xl border border-white/6 bg-white/3 p-4 text-sm leading-6 text-slate-400">
              Files are chunked, embedded, and searched on this Mac. The engine
              listens only inside the app and telemetry is disabled. Nothing is
              sent to an AI provider unless you explicitly enable cloud-assisted
              RAG.
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                New collection
              </Button>
              <Button
                variant="outline"
                onClick={() => setSection("sources")}
                disabled={collections.length === 0}
              >
                <FolderPlus className="size-4" />
                Add knowledge
              </Button>
            </div>
          </div>
          <div className="rounded-2xl border border-cyan-400/15 bg-slate-950/45 p-5">
            <h3 className="font-semibold text-white">Recent activity</h3>
            <div className="mt-4 space-y-4">
              {(overview?.activity ?? []).slice(0, 5).map((item) => (
                <div key={item.id} className="flex gap-3">
                  <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-cyan-300" />
                  <div>
                    <p className="text-sm text-slate-200">{item.message}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {friendlyDate(item.at)}
                    </p>
                  </div>
                </div>
              ))}
              {!overview?.activity.length && (
                <p className="text-sm leading-6 text-slate-500">
                  Your collection and indexing activity will appear here.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCollections = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-slate-400">
          Keep personal notes, projects, and reference material separated.
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          New collection
        </Button>
      </div>
      {collections.length === 0 ? (
        <EmptyState
          icon={Database}
          title="Create your first collection"
          body="A collection is a private, searchable knowledge space for a project or topic."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Create collection
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {collections.map((collection) => (
            <div
              key={collection.id}
              className="group flex items-center gap-4 rounded-xl border border-cyan-400/15 bg-slate-950/45 p-4 transition-colors hover:border-cyan-400/35"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-4 text-left"
                onClick={() => {
                  setSelectedCollectionId(collection.id);
                  setSection("sources");
                }}
              >
                <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-cyan-400/20 bg-cyan-400/8">
                  <Database className="size-5 text-cyan-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-semibold text-white">
                      {collection.name}
                    </h3>
                    <StatusDot state={collection.health} />
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-400">
                    {collection.description || "No description"}
                  </p>
                </div>
                <div className="hidden items-center gap-6 text-right text-xs text-slate-500 md:flex">
                  <div>
                    <div className="text-sm font-medium text-slate-200">
                      {collection.documentCount}
                    </div>
                    files
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-200">
                      {collection.chunkCount}
                    </div>
                    chunks
                  </div>
                  <ChevronRight className="size-4" />
                </div>
              </button>
              <Button
                size="icon"
                variant="ghost"
                className="text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-300"
                aria-label={`Delete ${collection.name}`}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Delete “${collection.name}” and its local index?`,
                    )
                  ) {
                    return;
                  }
                  try {
                    await ipc.vector.deleteCollection({
                      collectionId: collection.id,
                    });
                    await refreshWorkspace();
                  } catch (error) {
                    showError(errorMessage(error));
                  }
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderSources = () =>
    collections.length === 0 ? (
      <EmptyState
        icon={FolderPlus}
        title="A collection comes first"
        body="Create a collection, then add files or folders from this Mac."
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Create collection
          </Button>
        }
      />
    ) : (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CollectionPicker
            collections={collections}
            value={selectedCollectionId}
            onChange={setSelectedCollectionId}
          />
          <Button onClick={addSources} disabled={busy === "index"}>
            {busy === "index" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FolderPlus className="size-4" />
            )}
            {busy === "index" ? "Indexing…" : "Add files or folder"}
          </Button>
        </div>
        <div className="rounded-xl border border-cyan-400/15 bg-slate-950/45">
          {(sourcesQuery.data ?? []).map((source) => (
            <div
              key={source.id}
              className="flex items-center gap-4 border-b border-white/6 p-4 last:border-0"
            >
              <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/4">
                {source.kind === "folder" ? (
                  <FolderPlus className="size-5 text-cyan-300" />
                ) : (
                  <FileText className="size-5 text-cyan-300" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-white">
                    {source.name}
                  </p>
                  <Badge
                    variant="outline"
                    className="border-white/10 text-[10px] text-slate-400"
                  >
                    {source.status}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {source.path}
                </p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div className="text-sm text-slate-200">
                  {source.chunkCount} chunks
                </div>
                {source.fileCount} files
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove ${source.name}`}
                onClick={async () => {
                  if (!selectedCollectionId) return;
                  try {
                    await ipc.vector.removeSource({
                      collectionId: selectedCollectionId,
                      sourceId: source.id,
                    });
                    await refreshWorkspace();
                  } catch (error) {
                    showError(errorMessage(error));
                  }
                }}
              >
                <Trash2 className="size-4 text-slate-500" />
              </Button>
            </div>
          ))}
          {!sourcesQuery.data?.length && (
            <div className="p-10 text-center text-sm text-slate-500">
              No sources in this collection yet.
            </div>
          )}
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-4 text-sm text-emerald-100/75">
          <LockKeyhole className="mt-0.5 size-4 shrink-0 text-emerald-300" />
          Hidden folders, dependencies, environment files, keys, certificates,
          and binary files are skipped automatically.
        </div>
      </div>
    );

  const renderSearch = () =>
    collections.length === 0 ? (
      <EmptyState
        icon={Search}
        title="Nothing to search yet"
        body="Create a collection and index a folder to begin local semantic search."
      />
    ) : (
      <div className="space-y-5">
        <CollectionPicker
          collections={collections}
          value={selectedCollectionId}
          onChange={setSelectedCollectionId}
        />
        <div className="flex gap-2 rounded-xl border border-cyan-400/20 bg-slate-950/55 p-2">
          <Input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void runSearch();
            }}
            placeholder="Search meaning, not just keywords…"
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <Button onClick={runSearch} disabled={busy === "search"}>
            {busy === "search" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Search
          </Button>
        </div>
        <div className="space-y-3">
          {searchResults.map((result) => (
            <article
              key={`${result.collectionId}-${result.id}`}
              className="rounded-xl border border-cyan-400/15 bg-slate-950/45 p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <FileText className="size-4 shrink-0 text-cyan-300" />
                  <span className="truncate font-medium text-white">
                    {result.sourceName}
                  </span>
                  {result.lineStart && (
                    <span className="text-slate-500">
                      lines {result.lineStart}–{result.lineEnd}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-cyan-400/20 text-cyan-200"
                  >
                    {Math.round(result.score * 100)}% match
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Copy passage"
                    onClick={() => {
                      void navigator.clipboard.writeText(result.content);
                      showSuccess("Passage copied");
                    }}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                {result.content}
              </p>
              <p className="mt-3 truncate text-xs text-slate-600">
                {result.sourcePath}
              </p>
            </article>
          ))}
          {searchText && !busy && searchResults.length === 0 && (
            <p className="py-12 text-center text-sm text-slate-500">
              No matching passages yet.
            </p>
          )}
        </div>
      </div>
    );

  const renderRag = () => (
    <div className="space-y-5">
      {collections.length > 0 && (
        <CollectionPicker
          collections={collections}
          value={selectedCollectionId}
          onChange={setSelectedCollectionId}
        />
      )}
      <div className="rounded-2xl border border-cyan-400/20 bg-slate-950/50 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">Ask local knowledge</h3>
            <p className="mt-1 text-sm text-slate-500">
              Retrieval stays on this Mac. Answers include their source
              passages.
            </p>
          </div>
          <Badge
            variant="outline"
            className="border-emerald-400/20 text-emerald-300"
          >
            Offline
          </Badge>
        </div>
        <Textarea
          value={ragQuestion}
          onChange={(event) => setRagQuestion(event.target.value)}
          placeholder="What does my workspace say about…"
          className="min-h-28 bg-slate-950/60"
        />
        <div className="mt-3 flex justify-end">
          <Button
            onClick={runRag}
            disabled={
              busy === "rag" || !selectedCollectionId || !ragQuestion.trim()
            }
          >
            {busy === "rag" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Ask Vector
          </Button>
        </div>
      </div>
      {ragAnswer && (
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5">
          <h3 className="flex items-center gap-2 font-semibold text-white">
            <Sparkles className="size-4 text-cyan-300" />
            Answer
          </h3>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-200">
            {ragAnswer.answer}
          </p>
          {ragAnswer.results.length > 0 && (
            <div className="mt-5 border-t border-white/8 pt-4">
              <p className="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">
                Retrieved sources
              </p>
              <div className="flex flex-wrap gap-2">
                {ragAnswer.results.slice(0, 6).map((result, index) => (
                  <Badge
                    key={`${result.id}-${index}`}
                    variant="outline"
                    className="border-white/10 text-slate-300"
                  >
                    {index + 1}. {result.sourceName}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderModels = () => (
    <div className="space-y-4">
      <div className="rounded-2xl border border-cyan-400/30 bg-cyan-400/7 p-5">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-cyan-400/12">
            <BrainCircuit className="size-6 text-cyan-300" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-white">
                Built-in Local · Balanced
              </h3>
              <Badge className="bg-cyan-400 text-slate-950">Active</Badge>
              <Badge
                variant="outline"
                className="border-emerald-400/25 text-emerald-300"
              >
                No download
              </Badge>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              A lightweight 384-dimension local embedding profile. It works
              offline and requires no account, model server, or setup.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {["Local", "Offline", "Private", "384 dimensions"].map(
                (label) => (
                  <Badge
                    key={label}
                    variant="outline"
                    className="border-white/10 text-slate-400"
                  >
                    {label}
                  </Badge>
                ),
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-white/8 bg-white/3 p-4 text-sm leading-6 text-slate-500">
        Additional local embedding models will appear here after they are
        downloaded. Existing collections stay pinned to the model they were
        indexed with so search quality cannot silently change.
      </div>
    </div>
  );

  const renderSettings = () => {
    const settings = overviewQuery.data?.settings;
    if (!settings) return null;
    const persist = async (next: typeof settings) => {
      try {
        await ipc.vector.updateSettings(next);
        await refreshWorkspace();
        showSuccess("Vector settings saved");
      } catch (error) {
        showError(errorMessage(error));
      }
    };
    return (
      <div className="space-y-4">
        <div className="overflow-hidden rounded-xl border border-cyan-400/15 bg-slate-950/45">
          <div className="flex items-center justify-between gap-6 border-b border-white/6 p-4">
            <div>
              <h3 className="text-sm font-medium text-white">
                Cloud-assisted RAG
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Allow selected passages to be sent to the active Chat model only
                after you explicitly choose cloud answering.
              </p>
            </div>
            <Switch
              checked={settings.allowCloudRag}
              onCheckedChange={(checked) =>
                void persist({ ...settings, allowCloudRag: checked })
              }
            />
          </div>
          <div className="flex items-center justify-between gap-6 p-4">
            <div>
              <h3 className="text-sm font-medium text-white">
                Include hidden files
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Hidden items remain excluded by default. Secrets and key files
                are always blocked.
              </p>
            </div>
            <Switch
              checked={settings.includeHiddenFiles}
              onCheckedChange={(checked) =>
                void persist({ ...settings, includeHiddenFiles: checked })
              }
            />
          </div>
        </div>

        <div className="rounded-xl border border-cyan-400/15 bg-slate-950/45 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-white">Local backup</h3>
              <p className="mt-1 text-xs text-slate-500">
                Last backup: {friendlyDate(overviewQuery.data?.lastBackupAt)}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const backup = await ipc.vector.createBackup();
                  await refreshWorkspace();
                  showSuccess(`Backup created at ${backup.path}`);
                } catch (error) {
                  showError(errorMessage(error));
                }
              }}
            >
              <Archive className="size-4" />
              Back up metadata
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-amber-100">
                Engine recovery
              </h3>
              <p className="mt-1 text-xs leading-5 text-amber-100/55">
                Restart the private local engine if its health indicator becomes
                unavailable. Your collections are preserved.
              </p>
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await ipc.vector.restart();
                    await refreshWorkspace();
                    showSuccess("Vector restarted");
                  } catch (error) {
                    showError(errorMessage(error));
                  }
                }}
              >
                <RefreshCw className="size-4" />
                Restart Vector
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const currentSection = sections.find((item) => item.id === section)!;
  const sectionContent: Record<VectorSection, () => React.ReactNode> = {
    overview: renderOverview,
    collections: renderCollections,
    sources: renderSources,
    search: renderSearch,
    rag: renderRag,
    models: renderModels,
    settings: renderSettings,
  };

  return (
    <div
      className="relative min-h-full w-full overflow-hidden bg-[#020914] text-slate-100"
      data-testid="vector-workspace"
    >
      <ParticleBackground />
      <div className="relative z-10 mx-auto flex w-full max-w-[1500px] gap-5 px-5 py-6 lg:px-8">
        <aside className="sticky top-6 hidden h-fit w-56 shrink-0 lg:block">
          <div className="mb-5 px-2">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-cyan-300 uppercase">
              <Database className="size-4" />
              Vector
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Private local knowledge
            </p>
          </div>
          <nav className="space-y-1">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  section === id
                    ? "border-cyan-400/35 bg-cyan-400/10 text-white"
                    : "border-transparent text-slate-500 hover:bg-white/4 hover:text-slate-200",
                )}
              >
                <Icon
                  className={cn("size-4", section === id && "text-cyan-300")}
                />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs text-cyan-300/75 lg:hidden">
                <Database className="size-4" />
                VECTOR
              </div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
                {currentSection.label}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                {section === "overview" &&
                  "A private, searchable memory for your files and projects."}
                {section === "collections" &&
                  "Organise indexed knowledge into focused spaces."}
                {section === "sources" &&
                  "Choose exactly which local files and folders Vector may read."}
                {section === "search" &&
                  "Find passages by meaning across your local knowledge."}
                {section === "rag" &&
                  "Test retrieval and inspect the source passages behind every answer."}
                {section === "models" &&
                  "Manage the local models used to turn text into searchable vectors."}
                {section === "settings" &&
                  "Control privacy, indexing behaviour, backups, and engine health."}
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-cyan-400/15 bg-slate-950/55 px-3 py-2 text-xs text-slate-400">
              {overviewQuery.isLoading ? (
                <Loader2 className="size-3.5 animate-spin text-cyan-300" />
              ) : (
                <StatusDot state={overviewQuery.data?.status.state} />
              )}
              {overviewQuery.data?.status.message ?? "Starting Vector…"}
            </div>
          </header>

          <div className="mb-5 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {sections.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  "shrink-0 rounded-lg border px-3 py-2 text-xs",
                  section === id
                    ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100"
                    : "border-white/8 text-slate-500",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {overviewQuery.isError ? (
            <EmptyState
              icon={CircleAlert}
              title="Vector needs attention"
              body={errorMessage(overviewQuery.error)}
              action={
                <Button onClick={() => void overviewQuery.refetch()}>
                  <RefreshCw className="size-4" />
                  Try again
                </Button>
              }
            />
          ) : (
            sectionContent[section]()
          )}
        </main>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Vector collection</DialogTitle>
            <DialogDescription>
              Create a private knowledge space. You choose its files next.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Collection name"
              maxLength={80}
            />
            <Textarea
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              placeholder="What belongs here? (optional)"
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={createCollection}
              disabled={!newName.trim() || busy === "create"}
            >
              {busy === "create" && <Loader2 className="size-4 animate-spin" />}
              Create collection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
