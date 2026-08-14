import { useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
    <div className="bg-card/60 mx-auto max-w-lg rounded-xl border p-6 backdrop-blur">
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

/**
 * The three things you can do with a result.
 *
 * Shared by the tile and the preview so the buttons cannot drift apart, and so
 * saving from either place goes through the same library path.
 */
function ImageActions({
  image,
  saveLabel,
}: {
  image: StockImageResult;
  saveLabel: string;
}) {
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
    <div className="flex gap-2">
      <Button
        size="sm"
        className="flex-1"
        onClick={() => void saveToLibrary()}
        disabled={saving}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saveLabel}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        title="Copy image URL"
        onClick={() => void copyUrl()}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
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
  );
}

function ImageTile({
  image,
  onOpen,
}: {
  image: StockImageResult;
  onOpen: () => void;
}) {
  return (
    <div className="group bg-card/60 relative overflow-hidden rounded-xl border backdrop-blur">
      {/* A button, not a bare image: the preview has to be reachable from the
          keyboard as well as the mouse. */}
      <button
        type="button"
        onClick={onOpen}
        title="Open larger preview"
        className="focus-visible:ring-ring block w-full cursor-zoom-in focus-visible:ring-2 focus-visible:outline-none"
      >
        <img
          src={image.previewUrl}
          alt={image.tags.join(", ")}
          loading="lazy"
          className="h-44 w-full object-cover"
        />
      </button>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/85 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [&>*]:pointer-events-auto">
        <ImageActions image={image} saveLabel="Save to Library" />
        <p className="truncate text-xs text-white/80">
          {image.width}×{image.height} · {image.author}
        </p>
      </div>
    </div>
  );
}

/** The full-size look, opened by clicking a thumbnail. */
function ImagePreviewDialog({
  image,
  onClose,
}: {
  image: StockImageResult | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(image)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-4 sm:max-w-4xl">
        {image && (
          <>
            <DialogHeader>
              <DialogTitle className="truncate pr-8">
                {image.tags.slice(0, 5).join(", ") || "Stock image"}
              </DialogTitle>
              <DialogDescription>
                {image.width}×{image.height} · by {image.author} · Pixabay
              </DialogDescription>
            </DialogHeader>

            {/* min-h-0 so a tall image scrolls inside the dialog rather than
                pushing the actions off the bottom of the screen. */}
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
              <img
                src={image.imageUrl}
                alt={image.tags.join(", ")}
                className="max-h-[65vh] w-auto max-w-full rounded-lg object-contain"
              />
            </div>

            <ImageActions image={image} saveLabel="Save to Library" />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The gallery itself, without page chrome, so it can sit inside the Library's
 * Stock tab and on its own route without the two drifting apart.
 */
export function StockImageGallery() {
  const { hasKey, isLoading: authLoading, saveApiKey } = useStockImageAuth();

  const [draft, setDraft] = useState("");
  // Held separately from the input so every keystroke does not become a
  // request: only a submitted search does.
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [orientation, setOrientation] = useState<StockImageOrientation>("all");
  const [preview, setPreview] = useState<StockImageResult | null>(null);

  const { data, isFetching, error } = useStockImageSearch(
    { query, page, orientation },
    { enabled: hasKey },
  );

  const submit = () => {
    setQuery(draft);
    setPage(1);
  };

  const lastPage = data ? Math.ceil(data.total / PER_PAGE) : 1;

  if (authLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!hasKey) {
    return (
      <ApiKeyPrompt
        onSave={async (key) => {
          await saveApiKey.mutateAsync(key);
          toast.success("Pixabay connected.");
        }}
      />
    );
  }

  return (
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
          {error instanceof Error ? error.message : "That search did not work."}
        </div>
      ) : isFetching && !data ? (
        <div className="flex justify-center py-12">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : !query ? (
        <div className="text-muted-foreground py-12 text-center text-sm">
          Search Pixabay for photos to use with the assistant.
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
              <ImageTile
                key={image.id}
                image={image}
                onOpen={() => setPreview(image)}
              />
            ))}
          </div>

          <ImagePreviewDialog
            image={preview}
            onClose={() => setPreview(null)}
          />

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
  );
}
