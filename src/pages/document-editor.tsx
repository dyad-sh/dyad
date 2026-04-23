import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { libreOfficeClient } from "@/ipc/libreoffice_client";
import { EditorToolbar } from "@/components/documents/EditorToolbar";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/documents/RichTextEditor";
import { SpreadsheetEditor } from "@/components/documents/SpreadsheetEditor";
import { PresentationEditor, type Slide } from "@/components/documents/PresentationEditor";
import { AiSidePanel } from "@/components/documents/AiSidePanel";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DocumentEditorPage() {
  const { docId } = useParams({ from: "/documents/$docId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const docIdNum = Number(docId);

  // ─── Load document metadata ────────────────────────────────────────────────
  const { data: doc, isLoading: isDocLoading, error: docError } = useQuery({
    queryKey: ["document", docIdNum],
    queryFn: () => libreOfficeClient.getDocument(docIdNum),
    enabled: !isNaN(docIdNum),
  });

  // ─── Load document content ─────────────────────────────────────────────────
  const { data: content, isLoading: isContentLoading, error: contentError } = useQuery({
    queryKey: ["document-content", docIdNum],
    queryFn: () => libreOfficeClient.readDocumentContent(docIdNum),
    enabled: !isNaN(docIdNum),
  });

  // ─── Local state ───────────────────────────────────────────────────────────
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  /** For text docs: current plain text. For sheets/presentations managed internally */
  const [textContent, setTextContent] = useState<string | null>(null);
  const [spreadsheetRows, setSpreadsheetRows] = useState<string[][] | null>(null);
  const [slides, setSlides] = useState<Slide[] | null>(null);

  const editorRef = useRef<RichTextEditorHandle>(null);

  // ─── Initialize content from query ────────────────────────────────────────
  useEffect(() => {
    if (!content) return;
    if (content.success) {
      if (content.text !== undefined && textContent === null) {
        setTextContent(content.text);
      }
      if (content.rows !== undefined && spreadsheetRows === null) {
        setSpreadsheetRows(content.rows);
      }
      if (content.slides !== undefined && slides === null) {
        setSlides(content.slides.map((s) => ({ title: s.title ?? "", content: s.content ?? "", notes: s.notes })));
      }
    } else {
      // File not found or unreadable — initialise editors with empty content so the
      // user can still write and save (which will recreate the file).
      if (textContent === null) setTextContent("");
      if (spreadsheetRows === null) setSpreadsheetRows([[""]]);
      if (slides === null) setSlides([{ title: "New Slide", content: "" }]);
    }
  }, [content]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Save mutation ─────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!doc) throw new Error("Document not loaded");
      const payload: Parameters<typeof libreOfficeClient.updateDocumentContent>[1] = {};
      if (doc.type === "spreadsheet") {
        payload.rows = spreadsheetRows ?? [];
      } else if (doc.type === "presentation") {
        payload.slides = slides ?? [];
      } else {
        payload.text = editorRef.current?.getText() ?? textContent ?? "";
      }
      const res = await libreOfficeClient.updateDocumentContent(docIdNum, payload);
      if (!res.success) throw new Error(res.error ?? "Save failed");
    },
    onSuccess: () => {
      toast.success("Document saved");
      queryClient.invalidateQueries({ queryKey: ["document-content", docIdNum] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to save: ${err.message}`);
    },
  });

  // ─── Keyboard shortcut: Ctrl+S ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveMutation.mutate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveMutation]);

  // ─── Track selection for AI panel ─────────────────────────────────────────
  const handleSelectionChange = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim()) {
      setSelectedText(sel.toString());
    }
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [handleSelectionChange]);

  // ─── AI insert/replace callbacks ───────────────────────────────────────────
  const handleAiInsert = useCallback(
    (text: string) => {
      if (doc?.type === "document") {
        editorRef.current?.focus();
        editorRef.current?.execCommand("insertText", `\n\n${text}`);
        setTextContent((prev) => `${prev ?? ""}\n\n${text}`);
      } else {
        toast.info("Copy the result and paste it where you need it.");
      }
    },
    [doc?.type]
  );

  const handleAiReplace = useCallback(
    (text: string) => {
      if (doc?.type === "document") {
        editorRef.current?.focus();
        document.execCommand("insertText", false, text);
      } else {
        toast.info("Copy the result and paste it where you need it.");
      }
    },
    [doc?.type]
  );

  // ─── Loading / error states ────────────────────────────────────────────────
  const isLoading = isDocLoading || isContentLoading;
  const error = docError || contentError;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background">
        <AlertTriangle className="size-10 text-destructive" />
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Document not found."}
        </p>
        <Button variant="outline" onClick={() => navigate({ to: "/documents" })}>
          Back to documents
        </Button>
      </div>
    );
  }

  const currentText = editorRef.current?.getText() ?? textContent ?? "";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <EditorToolbar
        docType={doc.type as "document" | "spreadsheet" | "presentation"}
        docName={doc.name}
        saving={saveMutation.isPending}
        aiPanelOpen={aiPanelOpen}
        onSave={() => saveMutation.mutate()}
        onBack={() => navigate({ to: "/documents" })}
        onToggleAiPanel={() => setAiPanelOpen((v) => !v)}
        onBold={() => editorRef.current?.execCommand("bold")}
        onItalic={() => editorRef.current?.execCommand("italic")}
        onUnderline={() => editorRef.current?.execCommand("underline")}
        onAlignLeft={() => editorRef.current?.execCommand("justifyLeft")}
        onAlignCenter={() => editorRef.current?.execCommand("justifyCenter")}
        onAlignRight={() => editorRef.current?.execCommand("justifyRight")}
        onBulletList={() => editorRef.current?.execCommand("insertUnorderedList")}
        onNumberedList={() => editorRef.current?.execCommand("insertOrderedList")}
      />

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor area */}
        <div className="flex-1 overflow-auto">
          {doc.type === "document" && textContent !== null && (
            <div className="mx-auto max-w-3xl px-16 py-12">
              <RichTextEditor
                ref={editorRef}
                initialText={textContent}
                onChange={setTextContent}
                placeholder="Start writing…"
                className="min-h-[calc(100vh-8rem)]"
              />
            </div>
          )}

          {doc.type === "spreadsheet" && (
            <SpreadsheetEditor
              initialRows={spreadsheetRows ?? []}
              onChange={setSpreadsheetRows}
              className="h-full"
            />
          )}

          {doc.type === "presentation" && (
            <PresentationEditor
              initialSlides={slides ?? []}
              onChange={setSlides}
              className="h-full"
            />
          )}
        </div>

        {/* AI Side Panel */}
        {aiPanelOpen && (
          <div className="w-80 shrink-0 overflow-hidden">
            <AiSidePanel
              docId={docIdNum}
              docText={currentText}
              selectedText={selectedText}
              onInsert={handleAiInsert}
              onReplace={handleAiReplace}
              className="h-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}
