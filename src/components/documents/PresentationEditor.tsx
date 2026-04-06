import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, ChevronLeft, ChevronRight, Image } from "lucide-react";

export interface Slide {
  title: string;
  content: string;
  notes?: string;
}

interface PresentationEditorProps {
  initialSlides: Slide[];
  onChange?: (slides: Slide[]) => void;
  className?: string;
}

export function PresentationEditor({ initialSlides, onChange, className }: PresentationEditorProps) {
  const [slides, setSlides] = useState<Slide[]>(
    initialSlides.length > 0 ? initialSlides : [{ title: "Slide 1", content: "" }]
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [showNotes, setShowNotes] = useState(false);

  const updateSlide = useCallback(
    (idx: number, patch: Partial<Slide>) => {
      setSlides((prev) => {
        const next = prev.map((s, i) => (i === idx ? { ...s, ...patch } : s));
        onChange?.(next);
        return next;
      });
    },
    [onChange]
  );

  const addSlide = useCallback(() => {
    setSlides((prev) => {
      const next = [...prev, { title: `Slide ${prev.length + 1}`, content: "" }];
      onChange?.(next);
      setActiveIdx(next.length - 1);
      return next;
    });
  }, [onChange]);

  const deleteSlide = useCallback(
    (idx: number) => {
      if (slides.length <= 1) return;
      setSlides((prev) => {
        const next = prev.filter((_, i) => i !== idx);
        onChange?.(next);
        setActiveIdx((a) => Math.min(a, next.length - 1));
        return next;
      });
    },
    [slides.length, onChange]
  );

  const active = slides[activeIdx] ?? { title: "", content: "" };

  return (
    <div className={cn("flex h-full gap-0 overflow-hidden", className)}>
      {/* Slide thumbnails panel */}
      <div className="w-44 shrink-0 border-r bg-muted/20 flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between p-2 border-b shrink-0">
          <span className="text-xs font-medium text-muted-foreground">Slides</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={addSlide} title="Add slide">
            <Plus className="size-3.5" />
          </Button>
        </div>

        {slides.map((slide, idx) => (
          <button
            key={idx}
            onClick={() => setActiveIdx(idx)}
            className={cn(
              "group relative text-left p-2 border-b hover:bg-muted/50 transition-colors",
              activeIdx === idx && "bg-primary/10 border-l-2 border-l-primary"
            )}
          >
            {/* Thumbnail */}
            <div className="w-full aspect-video rounded bg-background border flex flex-col p-1.5 mb-1 overflow-hidden relative">
              <div className="text-[6px] font-semibold leading-tight truncate text-foreground">
                {slide.title || "Untitled"}
              </div>
              <div className="text-[5px] leading-tight text-muted-foreground mt-0.5 line-clamp-3">
                {slide.content}
              </div>
              {!slide.title && !slide.content && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Image className="size-4 text-muted-foreground/30" />
                </div>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">{idx + 1}. {slide.title || "Untitled"}</div>

            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1 right-1 h-4 w-4 opacity-0 group-hover:opacity-100 text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                deleteSlide(idx);
              }}
            >
              <Trash2 className="size-2.5" />
            </Button>
          </button>
        ))}
      </div>

      {/* Main editor area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Navigation bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/10 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
            disabled={activeIdx === 0}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {activeIdx + 1} / {slides.length}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setActiveIdx((i) => Math.min(slides.length - 1, i + 1))}
            disabled={activeIdx === slides.length - 1}
          >
            <ChevronRight className="size-4" />
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => setShowNotes((v) => !v)}>
            {showNotes ? "Hide Notes" : "Speaker Notes"}
          </Button>
        </div>

        {/* Slide canvas */}
        <div className="flex-1 overflow-auto flex items-start justify-center bg-muted/30 p-8">
          <div className="w-full max-w-3xl aspect-video bg-white dark:bg-zinc-900 rounded-lg shadow-xl border flex flex-col p-10 gap-4 overflow-hidden">
            {/* Title */}
            <div
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) =>
                updateSlide(activeIdx, { title: e.currentTarget.textContent ?? "" })
              }
              className={cn(
                "text-2xl font-bold text-foreground outline-none border-b border-transparent",
                "hover:border-border focus:border-primary transition-colors pb-1",
                "empty:before:content-['Click_to_add_title'] empty:before:text-muted-foreground/60 empty:before:font-normal"
              )}
              dangerouslySetInnerHTML={{ __html: active.title }}
              key={`title-${activeIdx}`}
            />

            {/* Content */}
            <div
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) =>
                updateSlide(activeIdx, { content: e.currentTarget.textContent ?? "" })
              }
              className={cn(
                "flex-1 text-base text-foreground/80 outline-none",
                "empty:before:content-['Click_to_add_content'] empty:before:text-muted-foreground/50",
                "whitespace-pre-wrap"
              )}
              dangerouslySetInnerHTML={{ __html: active.content }}
              key={`content-${activeIdx}`}
            />
          </div>
        </div>

        {/* Speaker notes */}
        {showNotes && (
          <div className="h-28 border-t bg-muted/20 flex flex-col overflow-hidden shrink-0">
            <div className="text-xs text-muted-foreground px-3 py-1 border-b">Speaker Notes</div>
            <textarea
              value={active.notes ?? ""}
              onChange={(e) => updateSlide(activeIdx, { notes: e.target.value })}
              placeholder="Add speaker notes…"
              className="flex-1 bg-transparent px-3 py-2 text-sm text-foreground outline-none resize-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}
