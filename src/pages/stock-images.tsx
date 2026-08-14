import { useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Images,
  KeyRound,
  Loader2,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { PageContainer } from "@/components/PageContainer";
import { ParticleBackground } from "@/components/home/ParticleBackground";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ipc } from "@/ipc/types";
import type { StockImageResult } from "@/ipc/types/stock_images";
import type { StockImageOrientation } from "@/lib/stock_images/pixabay";
import { useStockImageAuth, useStockImageSearch } from "@/hooks/useStockImages";

const PER_PAGE = 30;

/**
 * Asked for once, when there is no key.
 *
 * The key is sent straight to the main process and never held in a query
 * cache, so the only copy in the renderer is the one being typed.
 */
function ApiKeyPrompt({ onSave }: { onSave: (key: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await onSave(value.trim());
      setValue("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg rounded-xl border bg-card/60 p-6 backdrop-blur">
      <div className="mb-2 flex items-center gap-2 text-lg font-semibold">
        <KeyRound className="h-5 w-5" />
        Connect Pixabay
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Stock image search uses your own free Pixabay API key. Get one from{" "}
        <button
          type="button"
          className="text-primary underline underline-offset-2"
          onClick={() =>
            ipc.system.openExternalUrl("https://pixabay.com/api/docs/")
          }
        >
          pixabay.com/api/docs
        </button>
        . It is stored encrypted on this Mac and never leaves it except to
        Pixabay.
      </p>
      <div className="flex gap-2">
        <Input
          type="password"
          autoComplete="off"
          placeholder="Pixabay API key"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
        />
        <Button onClick={() => void save()} disabled={!value.trim() || saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}

function ImageTile({ image }: { image: StockImageResult }) {
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  /**
   * Saves through the existing library path, which already accepts an HTTPS
   * URL, so the image lands wherever generated images land and is available to
   * the assistant the same way.
   */
  const saveToLibrary = async () => {
    setSaving(true);
    try {
      const saved = await ipc.imageGeneration.saveImageToLibrary({
        image: image.largeImageUrl,
        prompt: image.tags.join(", ") || "stock image",
      });
      toast.success(`Saved ${saved.fileName} to ${saved.appName}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save that image.",
      );
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    await navigator.clipboard.writeText(image.largeImageUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group bg-card/60 relative overflow-hidden rounded-xl border backdrop-blur">
      <img
        src={image.previewUrl}
        alt={image.tags.join(", ")}
        loading="lazy"
        className="h-44 w-full object-cover"
      />

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/85 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            onClick={() => void saveToLibrary()}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Save to Library"
            )}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            title="Copy image URL"
            onClick={() => void copyUrl()}
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            title="Open on Pixabay"
            onClick={() => ipc.system.openExternalUrl(image.pageUrl)}
            disabled={!image.pageUrl}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
        <p className="truncate text-xs text-white/80">
          {image.width}×{image.height} · {image.author}
        </p>
      </div>
    </div>
  );
}

export default function StockImagesPage() {
  const { hasKey, isLoading: authLoading, saveApiKey } = useStockImageAuth();

  const [draft, setDraft] = useState("");
  // Held separately from the input so every keystroke does not become a
  // request: only a submitted search does.
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [orientation, setOrientation] = useState<StockImageOrientation>("all");

  const { data, isFetching, error } = useStockImageSearch(
    { query, page, orientation },
    { enabled: hasKey },
  );

  const submit = () => {
    setQuery(draft);
    setPage(1);
  };

  const lastPage = data ? Math.ceil(data.total / PER_PAGE) : 1;

  return (
    <div className="home-jarvis relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ParticleBackground className="z-0" />
      <div
        className="relative z-10 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
        data-reset-scroll-on-route
      >
        <PageContainer size="xl" className="py-6">
          <div className="mb-6">
            <h1 className="flex items-center gap-2 text-3xl font-bold">
              <Images className="h-8 w-8" />
              Stock Images
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Search Pixabay and save what you find into your Library, where the
              assistant can use it.
            </p>
          </div>

          {authLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
            </div>
          ) : !hasKey ? (
            <ApiKeyPrompt
              onSave={async (key) => {
                await saveApiKey.mutateAsync(key);
                toast.success("Pixabay connected.");
              }}
            />
          ) : (
            <>
              <div className="mb-6 flex gap-2">
                <div className="relative flex-1">
                  <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                  <Input
                    className="pl-9"
                    placeholder="Search photos: mountains, circuit board, office…"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submit();
                    }}
                  />
                </div>
                <Select
                  value={orientation}
                  onValueChange={(value) => {
                    setOrientation(value as StockImageOrientation);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any shape</SelectItem>
                    <SelectItem value="horizontal">Landscape</SelectItem>
                    <SelectItem value="vertical">Portrait</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={submit} disabled={!draft.trim()}>
                  Search
                </Button>
              </div>

              {error ? (
                <div className="text-destructive py-12 text-center text-sm">
                  {error instanceof Error
                    ? error.message
                    : "That search did not work."}
                </div>
              ) : isFetching && !data ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
                </div>
              ) : !query ? (
                <div className="text-muted-foreground py-12 text-center text-sm">
                  Search for something to get started.
                </div>
              ) : data && data.images.length === 0 ? (
                <div className="text-muted-foreground py-12 text-center text-sm">
                  Nothing matched “{query}”.
                </div>
              ) : (
                <>
                  <div
                    data-testid="stock-image-grid"
                    className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4"
                  >
                    {data?.images.map((image) => (
                      <ImageTile key={image.id} image={image} />
                    ))}
                  </div>

                  {lastPage > 1 && (
                    <div className="mt-6 flex items-center justify-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((current) => current - 1)}
                        disabled={page <= 1 || isFetching}
                      >
                        Previous
                      </Button>
                      <span className="text-muted-foreground text-sm">
                        Page {page} of {lastPage}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((current) => current + 1)}
                        disabled={page >= lastPage || isFetching}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </PageContainer>
      </div>
    </div>
  );
}
