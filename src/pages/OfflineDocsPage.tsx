/**
 * Offline Documentation Hub Page
 * Browse, search, and manage offline documentation
 */

import React, { useState, useEffect } from "react";
import DOMPurify from "dompurify";
import { toast } from "sonner";
import {
  useOfflineDocsManager,
  useCollections,
  useCollection,
  useDocuments,
  useDocument,
  useDocsSearch,
} from "../hooks/useOfflineDocs";
import type {
  CollectionId,
  DocId,
  DocCategory,
  DocSource,
} from "../ipc/offline_docs_client";

// =============================================================================
// CONSTANTS
// =============================================================================

const DOC_CATEGORIES: { value: DocCategory; label: string; icon: string }[] = [
  { value: "language", label: "Languages", icon: "📖" },
  { value: "framework", label: "Frameworks", icon: "🏗️" },
  { value: "library", label: "Libraries", icon: "📚" },
  { value: "api", label: "APIs", icon: "🔌" },
  { value: "tool", label: "Tools", icon: "🔧" },
  { value: "tutorial", label: "Tutorials", icon: "📝" },
  { value: "reference", label: "Reference", icon: "📋" },
  { value: "guide", label: "Guides", icon: "🗺️" },
  { value: "custom", label: "Custom", icon: "📁" },
];

const DOC_SOURCES: { value: DocSource; label: string }[] = [
  { value: "local", label: "Local Folder" },
  { value: "url", label: "URL" },
  { value: "github", label: "GitHub" },
  { value: "npm", label: "npm Package" },
  { value: "bundled", label: "Bundled" },
];

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function OfflineDocsPage() {
  const docsManager = useOfflineDocsManager();
  const [activeTab, setActiveTab] = useState<"browse" | "search" | "add">("browse");
  const [selectedCollection, setSelectedCollection] = useState<CollectionId | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<DocId | null>(null);

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            📚 Offline Docs Hub
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Searchable documentation available offline
          </p>
        </div>
        {docsManager.stats && (
          <div className="text-sm text-muted-foreground">
            {docsManager.stats.totalCollections} collections •{" "}
            {docsManager.stats.totalDocuments} documents •{" "}
            {formatSize(docsManager.stats.totalSize)}
          </div>
        )}
      </header>

      {/* Tabs */}
      <div className="border-b px-6">
        <nav className="flex gap-4">
          {[
            { id: "browse" as const, label: "Browse", icon: "📁" },
            { id: "search" as const, label: "Search", icon: "🔍" },
            { id: "add" as const, label: "Add Docs", icon: "➕" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "browse" && (
          <BrowseTab
            docsManager={docsManager}
            selectedCollection={selectedCollection}
            setSelectedCollection={setSelectedCollection}
            selectedDoc={selectedDoc}
            setSelectedDoc={setSelectedDoc}
          />
        )}
        {activeTab === "search" && <SearchTab docsManager={docsManager} setSelectedDoc={setSelectedDoc} />}
        {activeTab === "add" && <AddDocsTab docsManager={docsManager} />}
      </div>
    </div>
  );
}

// =============================================================================
// BROWSE TAB
// =============================================================================

function BrowseTab({
  docsManager,
  selectedCollection,
  setSelectedCollection,
  selectedDoc,
  setSelectedDoc,
}: {
  docsManager: ReturnType<typeof useOfflineDocsManager>;
  selectedCollection: CollectionId | null;
  setSelectedCollection: (id: CollectionId | null) => void;
  selectedDoc: DocId | null;
  setSelectedDoc: (id: DocId | null) => void;
}) {
  const [categoryFilter, setCategoryFilter] = useState<DocCategory | "">("");
  const { data: collections = [], isLoading: loadingCollections } = useCollections(
    categoryFilter ? { category: categoryFilter } : undefined
  );
  const { data: documents = [], isLoading: loadingDocs } = useDocuments(
    selectedCollection
  );

  return (
    <div className="h-full flex">
      {/* Collections Panel */}
      <div className="w-64 border-r flex flex-col">
        <div className="p-4 border-b">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as DocCategory | "")}
            className="w-full px-3 py-2 border rounded-lg bg-background text-sm"
          >
            <option value="">All Categories</option>
            {DOC_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingCollections ? (
            <div className="p-4 text-center text-muted-foreground">Loading...</div>
          ) : collections.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              <div className="text-3xl mb-2">📚</div>
              <p>No collections yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {collections.map((collection) => {
                const category = DOC_CATEGORIES.find((c) => c.value === collection.category);
                return (
                  <button
                    key={collection.id}
                    onClick={() => {
                      setSelectedCollection(collection.id);
                      setSelectedDoc(null);
                    }}
                    className={`w-full p-3 text-left hover:bg-muted/50 transition-colors ${
                      selectedCollection === collection.id ? "bg-muted" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span>{collection.icon || category?.icon || "📄"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{collection.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {collection.documentCount} docs • {formatSize(collection.totalSize)}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Documents Panel */}
      <div className="w-72 border-r flex flex-col">
        {selectedCollection ? (
          <>
            <div className="p-4 border-b">
              <h3 className="font-medium">Documents</h3>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingDocs ? (
                <div className="p-4 text-center text-muted-foreground">Loading...</div>
              ) : documents.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">No documents</div>
              ) : (
                <div className="divide-y">
                  {documents.map((doc) => (
                    <button
                      key={doc.id}
                      onClick={() => setSelectedDoc(doc.id)}
                      className={`w-full p-3 text-left hover:bg-muted/50 transition-colors ${
                        selectedDoc === doc.id ? "bg-muted" : ""
                      }`}
                    >
                      <div className="font-medium truncate">{doc.title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {doc.path}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground p-4 text-center">
            <div>
              <div className="text-3xl mb-2">👈</div>
              <p>Select a collection</p>
            </div>
          </div>
        )}
      </div>

      {/* Document Viewer */}
      <div className="flex-1">
        {selectedDoc ? (
          <DocumentViewer docId={selectedDoc} />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <div className="text-4xl mb-2">📄</div>
              <p>Select a document to view</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DocumentViewer({ docId }: { docId: DocId }) {
  const { data: doc, isLoading } = useDocument(docId);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Loading document...</p>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Document not found</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        <h2 className="text-xl font-bold">{doc.title}</h2>
        <div className="text-sm text-muted-foreground mt-1">
          {doc.path} • {formatSize(doc.size)} • {doc.format.toUpperCase()}
        </div>
      </div>

      {/* Table of Contents */}
      {doc.headings.length > 0 && (
        <div className="border-b">
          <details className="p-4">
            <summary className="cursor-pointer font-medium">
              Table of Contents ({doc.headings.length} sections)
            </summary>
            <nav className="mt-2 space-y-1">
              {doc.headings.map((h, i) => (
                <a
                  key={i}
                  href={`#${h.anchor}`}
                  className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                  style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
                >
                  {h.text}
                </a>
              ))}
            </nav>
          </details>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {doc.format === "markdown" ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <MarkdownRenderer content={doc.content} />
          </div>
        ) : doc.format === "html" ? (
          <div
            className="prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(doc.content) }}
          />
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-sm">{doc.content}</pre>
        )}
      </div>
    </div>
  );
}

function MarkdownRenderer({ content }: { content: string }) {
  // Simple markdown rendering
  const html = content
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-6 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-8 mb-3">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-8 mb-4">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-muted rounded text-sm">$1</code>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-muted p-4 rounded-lg overflow-x-auto my-4"><code>$2</code></pre>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary hover:underline" target="_blank" rel="noopener">$1</a>')
    .replace(/^\- (.+)$/gm, '<li class="ml-4">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    .split("\n\n")
    .map((p) => (p.startsWith("<") ? p : `<p class="my-2">${p}</p>`))
    .join("\n");

  return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />;
}

// =============================================================================
// SEARCH TAB
// =============================================================================

function SearchTab({
  docsManager,
  setSelectedDoc,
}: {
  docsManager: ReturnType<typeof useOfflineDocsManager>;
  setSelectedDoc: (id: DocId | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<DocCategory | "">("");
  
  const { data: results = [], isLoading } = useDocsSearch(query, {
    category: categoryFilter || undefined,
    limit: 50,
  });

  return (
    <div className="h-full flex flex-col">
      {/* Search Input */}
      <div className="p-4 border-b">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documentation..."
            className="flex-1 px-4 py-2 border rounded-lg bg-background"
            autoFocus
          />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as DocCategory | "")}
            className="px-4 py-2 border rounded-lg bg-background"
          >
            <option value="">All Categories</option>
            {DOC_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4">
        {!query ? (
          <div className="text-center text-muted-foreground py-12">
            <div className="text-4xl mb-2">🔍</div>
            <p>Enter a search query to find documentation</p>
          </div>
        ) : isLoading ? (
          <div className="text-center text-muted-foreground py-12">
            Searching...
          </div>
        ) : results.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            <div className="text-4xl mb-2">😢</div>
            <p>No results found for "{query}"</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Found {results.length} results
            </p>
            {results.map((result) => (
              <button
                key={result.docId}
                onClick={() => setSelectedDoc(result.docId)}
                className="w-full p-4 border rounded-lg text-left hover:bg-muted/50 transition-colors"
              >
                <div className="font-medium">{result.title}</div>
                <div className="text-sm text-muted-foreground mb-2">
                  {result.collectionName} • {result.path}
                </div>
                <div
                  className="text-sm"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(result.snippet) }}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// ADD DOCS TAB
// =============================================================================

function AddDocsTab({
  docsManager,
}: {
  docsManager: ReturnType<typeof useOfflineDocsManager>;
}) {
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<DocCategory>("library");
  const [source, setSource] = useState<DocSource>("local");
  const [icon, setIcon] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [url, setUrl] = useState("");

  const handleCreate = async () => {
    if (!name) {
      toast.error("Name is required");
      return;
    }

    try {
      const collection = await docsManager.createCollection({
        name,
        description: description || undefined,
        category,
        source,
        icon: icon || undefined,
      });

      toast.success(`Created collection: ${name}`);

      // If source is provided, start import
      if (source === "local" && folderPath) {
        toast.info("Importing documents...");
        await docsManager.importFromFolder({
          collectionId: collection.id,
          folderPath,
        });
        toast.success("Import complete");
      } else if (source === "url" && url) {
        toast.info("Fetching document...");
        await docsManager.importFromUrl({
          collectionId: collection.id,
          url,
        });
        toast.success("Import complete");
      }

      // Reset form
      setName("");
      setDescription("");
      setFolderPath("");
      setUrl("");
      setShowNewCollection(false);
    } catch (error) {
      toast.error("Failed to create collection");
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto space-y-8">
        {/* Bundled Docs */}
        <section>
          <h2 className="text-xl font-bold mb-4">📦 Pre-bundled Documentation</h2>
          <p className="text-muted-foreground mb-4">
            Popular documentation sets ready to download
          </p>
          <div className="grid grid-cols-2 gap-4">
            {docsManager.bundledDocs.map((doc) => {
              const category = DOC_CATEGORIES.find((c) => c.value === doc.category);
              return (
                <div
                  key={doc.id}
                  className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{doc.icon}</span>
                    <div className="flex-1">
                      <div className="font-medium">{doc.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {doc.description}
                      </div>
                      <div className="mt-2">
                        <span className="text-xs px-2 py-0.5 bg-muted rounded-full">
                          {category?.label}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setName(doc.name);
                      setCategory(doc.category);
                      setSource(doc.source);
                      setIcon(doc.icon);
                      if (doc.sourceUrl) setUrl(doc.sourceUrl);
                      setShowNewCollection(true);
                    }}
                    className="mt-3 w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 transition-colors"
                  >
                    Add to Library
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Create Custom Collection */}
        <section>
          <h2 className="text-xl font-bold mb-4">➕ Add Custom Documentation</h2>
          
          {!showNewCollection ? (
            <button
              onClick={() => setShowNewCollection(true)}
              className="w-full p-6 border-2 border-dashed rounded-lg text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
            >
              <div className="text-3xl mb-2">📁</div>
              <p>Click to create a new documentation collection</p>
            </button>
          ) : (
            <div className="p-6 border rounded-lg space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg bg-background"
                  placeholder="e.g., React Documentation"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg bg-background"
                  placeholder="Brief description..."
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as DocCategory)}
                    className="w-full px-4 py-2 border rounded-lg bg-background"
                  >
                    {DOC_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.icon} {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Source</label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value as DocSource)}
                    className="w-full px-4 py-2 border rounded-lg bg-background"
                  >
                    {DOC_SOURCES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Icon (emoji)</label>
                <input
                  type="text"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg bg-background"
                  placeholder="📚"
                  maxLength={4}
                />
              </div>

              {source === "local" && (
                <div>
                  <label className="block text-sm font-medium mb-1">Folder Path</label>
                  <input
                    type="text"
                    value={folderPath}
                    onChange={(e) => setFolderPath(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg bg-background"
                    placeholder="C:\docs\my-docs or /home/user/docs"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Will import .md, .mdx, .txt, .html, .rst files
                  </p>
                </div>
              )}

              {(source === "url" || source === "github") && (
                <div>
                  <label className="block text-sm font-medium mb-1">URL</label>
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg bg-background"
                    placeholder="https://..."
                  />
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <button
                  onClick={handleCreate}
                  disabled={docsManager.isCreatingCollection || docsManager.isImporting}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {docsManager.isCreatingCollection
                    ? "Creating..."
                    : docsManager.isImporting
                    ? "Importing..."
                    : "Create Collection"}
                </button>
                <button
                  onClick={() => {
                    setShowNewCollection(false);
                    setName("");
                    setDescription("");
                    setFolderPath("");
                    setUrl("");
                  }}
                  className="px-4 py-2 border rounded-lg hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// =============================================================================
// UTILITIES
// =============================================================================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default OfflineDocsPage;
