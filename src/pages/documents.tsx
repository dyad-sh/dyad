/**
 * Documents Page
 * Create, manage, and export documents using LibreOffice
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  FileSpreadsheet,
  Presentation,
  Plus,
  Trash2,
  Download,
  ExternalLink,
  Search,
  Grid,
  List,
  Sparkles,
  AlertCircle,
  RefreshCw,
  FolderOpen,
  MoreHorizontal,
  FileDown,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { libreOfficeClient } from "@/ipc/libreoffice_client";
import { showError, showSuccess } from "@/lib/toast";

import type {
  DocumentType,
  BaseDocument,
  CreateDocumentRequest,
  ExportFormat,
  AIGenerationOptions,
} from "@/types/libreoffice_types";

const DOCUMENT_TYPE_ICONS: Record<DocumentType, React.ReactNode> = {
  document: <FileText className="h-5 w-5" />,
  spreadsheet: <FileSpreadsheet className="h-5 w-5" />,
  presentation: <Presentation className="h-5 w-5" />,
};

const DOCUMENT_TYPE_COLORS: Record<DocumentType, string> = {
  document: "from-blue-500/10 via-cyan-500/10 to-teal-500/10 hover:from-blue-500/20 hover:via-cyan-500/20 hover:to-teal-500/20",
  spreadsheet: "from-emerald-500/10 via-green-500/10 to-lime-500/10 hover:from-emerald-500/20 hover:via-green-500/20 hover:to-lime-500/20",
  presentation: "from-orange-500/10 via-amber-500/10 to-yellow-500/10 hover:from-orange-500/20 hover:via-amber-500/20 hover:to-yellow-500/20",
};

const DOCUMENT_TYPE_ICON_COLORS: Record<DocumentType, string> = {
  document: "text-blue-500",
  spreadsheet: "text-emerald-500",
  presentation: "text-orange-500",
};

const EXPORT_FORMATS: Record<DocumentType, ExportFormat[]> = {
  document: ["pdf", "docx", "odt", "html", "txt"],
  spreadsheet: ["pdf", "xlsx", "ods", "csv"],
  presentation: ["pdf", "pptx", "odp"],
};

export default function DocumentsPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [activeTab, setActiveTab] = useState("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);

  // New document form state
  const [newDocName, setNewDocName] = useState("");
  const [newDocType, setNewDocType] = useState<DocumentType>("document");

  // AI generation state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiDocType, setAiDocType] = useState<DocumentType>("document");
  const [aiDocName, setAiDocName] = useState("");
  const [aiTone, setAiTone] = useState<"formal" | "casual" | "professional" | "creative">("professional");

  // Query LibreOffice status
  const { data: loStatus, isLoading: isStatusLoading } = useQuery({
    queryKey: ["libreoffice-status"],
    queryFn: () => libreOfficeClient.getStatus(),
  });

  // Query documents
  const { data: documents = [], isLoading: isDocsLoading, refetch: refetchDocs } = useQuery({
    queryKey: ["documents", activeTab],
    queryFn: () =>
      libreOfficeClient.listDocuments({
        type: activeTab !== "all" ? (activeTab as DocumentType) : undefined,
      }),
  });

  // Create document mutation
  const createDocMutation = useMutation({
    mutationFn: (request: CreateDocumentRequest) => libreOfficeClient.createDocument(request),
    onSuccess: (result) => {
      if (result.success) {
        showSuccess(`Document "${result.document?.name}" created`);
        queryClient.invalidateQueries({ queryKey: ["documents"] });
        setCreateDialogOpen(false);
        resetCreateForm();
      } else {
        showError(result.error || "Failed to create document");
      }
    },
    onError: (error) => {
      showError(`Error: ${error}`);
    },
  });

  // Delete document mutation
  const deleteDocMutation = useMutation({
    mutationFn: (id: number) => libreOfficeClient.deleteDocument(id),
    onSuccess: (result, id) => {
      if (result.success) {
        showSuccess("Document deleted");
        queryClient.invalidateQueries({ queryKey: ["documents"] });
      } else {
        showError(result.error || "Failed to delete document");
      }
    },
  });

  // Export document mutation
  const exportDocMutation = useMutation({
    mutationFn: ({ id, format }: { id: number; format: ExportFormat }) =>
      libreOfficeClient.exportDocument({ documentId: id, format }),
    onSuccess: (result) => {
      if (result.success) {
        showSuccess(`Exported to ${result.filePath}`);
      } else {
        showError(result.error || "Failed to export document");
      }
    },
  });

  // Open document mutation
  const openDocMutation = useMutation({
    mutationFn: (id: number) => libreOfficeClient.openDocument(id),
    onSuccess: (result) => {
      if (!result.success) {
        showError(result.error || "Failed to open document");
      }
    },
  });

  const resetCreateForm = () => {
    setNewDocName("");
    setNewDocType("document");
  };

  const handleCreateDocument = () => {
    if (!newDocName.trim()) {
      showError("Please enter a document name");
      return;
    }
    createDocMutation.mutate({
      name: newDocName,
      type: newDocType,
    });
  };

  const handleAiGenerate = () => {
    if (!aiPrompt.trim() || !aiDocName.trim()) {
      showError("Please enter both a name and description");
      return;
    }
    createDocMutation.mutate({
      name: aiDocName,
      type: aiDocType,
      aiGenerate: {
        prompt: aiPrompt,
        tone: aiTone,
      },
    });
    setAiDialogOpen(false);
    setAiPrompt("");
    setAiDocName("");
  };

  // Filter documents based on search
  const filteredDocs = documents.filter((doc) =>
    doc.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderDocumentCard = (doc: BaseDocument) => (
    <Card
      key={doc.id}
      className={`group relative overflow-hidden border-border/50 transition-all duration-300 cursor-pointer
        bg-gradient-to-br ${DOCUMENT_TYPE_COLORS[doc.type]}
        hover:shadow-xl hover:shadow-violet-500/5 hover:border-violet-500/30 hover:scale-[1.02]`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-background/80 via-background/60 to-background/80 backdrop-blur-sm" />
      <CardHeader className="relative pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-lg bg-gradient-to-br ${DOCUMENT_TYPE_COLORS[doc.type]} border border-border/50`}
            >
              <span className={DOCUMENT_TYPE_ICON_COLORS[doc.type]}>
                {DOCUMENT_TYPE_ICONS[doc.type]}
              </span>
            </div>
            <div>
              <CardTitle className="text-base font-semibold">{doc.name}</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {doc.format.toUpperCase()} • {new Date(doc.createdAt).toLocaleDateString()}
              </CardDescription>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-border/50 bg-background/95 backdrop-blur-sm">
              <DropdownMenuItem onClick={() => openDocMutation.mutate(doc.id)}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in LibreOffice
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {EXPORT_FORMATS[doc.type].map((format) => (
                <DropdownMenuItem
                  key={format}
                  onClick={() => exportDocMutation.mutate({ id: doc.id, format })}
                >
                  <FileDown className="h-4 w-4 mr-2" />
                  Export as {format.toUpperCase()}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => deleteDocMutation.mutate(doc.id)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="relative pt-0">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs bg-background/80 border border-border/50">
            {doc.type}
          </Badge>
          <Badge
            className={`text-xs border-0 ${
              doc.status === "ready"
                ? "bg-emerald-500/20 text-emerald-600"
                : doc.status === "generating"
                ? "bg-amber-500/20 text-amber-600"
                : doc.status === "error"
                ? "bg-red-500/20 text-red-600"
                : "bg-gray-500/20 text-gray-600"
            }`}
          >
            {doc.status}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );

  // Show installation prompt if LibreOffice is not installed
  if (!isStatusLoading && !loStatus?.installed) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b border-border/50 p-6 bg-gradient-to-r from-blue-500/5 via-cyan-500/5 to-teal-500/5">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500/20 via-cyan-500/20 to-teal-500/20 border border-blue-500/20">
              <FileText className="h-7 w-7 text-blue-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-cyan-600 to-teal-600 bg-clip-text text-transparent">
                Document Studio
              </h1>
              <p className="text-sm text-muted-foreground">
                Create documents, spreadsheets, and presentations with AI
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center p-8">
          <Card className="max-w-md border-border/50 bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-red-500/5">
            <CardHeader className="text-center">
              <div className="mx-auto p-4 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/20 mb-4">
                <AlertCircle className="h-10 w-10 text-amber-500" />
              </div>
              <CardTitle className="text-xl">LibreOffice Required</CardTitle>
              <CardDescription>
                Install LibreOffice to create and edit documents, spreadsheets, and presentations.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                JoyCreate uses LibreOffice Headless to power the Document Studio. It's free and
                open-source.
              </p>
              <Button
                className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 border-0"
                onClick={() => window.open("https://www.libreoffice.org/download/", "_blank")}
              >
                <Download className="h-4 w-4 mr-2" />
                Download LibreOffice
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border/50 p-6 bg-gradient-to-r from-blue-500/5 via-cyan-500/5 to-teal-500/5">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500/20 via-cyan-500/20 to-teal-500/20 border border-blue-500/20">
              <FileText className="h-7 w-7 text-blue-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-cyan-600 to-teal-600 bg-clip-text text-transparent">
                Document Studio
              </h1>
              <p className="text-sm text-muted-foreground">
                Create documents, spreadsheets, and presentations with AI
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* LibreOffice Status */}
            <Badge
              variant="secondary"
              className="bg-emerald-500/20 text-emerald-600 border-emerald-500/30"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2 animate-pulse" />
              LibreOffice {loStatus?.version}
            </Badge>

            {/* AI Generate Button */}
            <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 text-violet-600"
                >
                  <Wand2 className="h-4 w-4 mr-2" />
                  AI Generate
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg border-border/50 bg-background/95 backdrop-blur-sm">
                <DialogHeader>
                  <DialogTitle className="text-xl bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                    Generate with AI
                  </DialogTitle>
                  <DialogDescription>
                    Describe what you want to create and AI will generate it for you
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Document Name</Label>
                    <Input
                      placeholder="Q4 Sales Report"
                      value={aiDocName}
                      onChange={(e) => setAiDocName(e.target.value)}
                      className="border-border/50"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Type</Label>
                      <Select value={aiDocType} onValueChange={(v) => setAiDocType(v as DocumentType)}>
                        <SelectTrigger className="border-border/50">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="document">Document</SelectItem>
                          <SelectItem value="spreadsheet">Spreadsheet</SelectItem>
                          <SelectItem value="presentation">Presentation</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Tone</Label>
                      <Select value={aiTone} onValueChange={(v) => setAiTone(v as any)}>
                        <SelectTrigger className="border-border/50">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="professional">Professional</SelectItem>
                          <SelectItem value="formal">Formal</SelectItem>
                          <SelectItem value="casual">Casual</SelectItem>
                          <SelectItem value="creative">Creative</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      placeholder="Create a quarterly sales report with sections for revenue breakdown, top customers, regional performance, and growth projections..."
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      className="min-h-[120px] border-border/50"
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setAiDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAiGenerate}
                    disabled={createDocMutation.isPending}
                    className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 border-0"
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    {createDocMutation.isPending ? "Generating..." : "Generate"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Create Button */}
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 shadow-lg shadow-blue-500/20 border-0">
                  <Plus className="h-4 w-4 mr-2" />
                  New Document
                </Button>
              </DialogTrigger>
              <DialogContent className="border-border/50 bg-background/95 backdrop-blur-sm">
                <DialogHeader>
                  <DialogTitle className="text-xl bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                    Create New Document
                  </DialogTitle>
                  <DialogDescription>Choose a document type to get started</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      placeholder="My Document"
                      value={newDocName}
                      onChange={(e) => setNewDocName(e.target.value)}
                      className="border-border/50"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Type</Label>
                    <div className="grid grid-cols-3 gap-3">
                      {(["document", "spreadsheet", "presentation"] as DocumentType[]).map((type) => (
                        <button
                          key={type}
                          onClick={() => setNewDocType(type)}
                          className={`p-4 rounded-xl border transition-all duration-200 ${
                            newDocType === type
                              ? `border-${DOCUMENT_TYPE_ICON_COLORS[type].split("-")[1]}-500/50 bg-gradient-to-br ${DOCUMENT_TYPE_COLORS[type]}`
                              : "border-border/50 hover:border-border"
                          }`}
                        >
                          <div
                            className={`mx-auto mb-2 ${
                              newDocType === type
                                ? DOCUMENT_TYPE_ICON_COLORS[type]
                                : "text-muted-foreground"
                            }`}
                          >
                            {DOCUMENT_TYPE_ICONS[type]}
                          </div>
                          <div className="text-sm font-medium capitalize">{type}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateDocument}
                    disabled={createDocMutation.isPending}
                    className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 border-0"
                  >
                    {createDocMutation.isPending ? "Creating..." : "Create"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 border-border/50 bg-background/50 backdrop-blur-sm focus:border-blue-500/50"
            />
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-background/50 backdrop-blur-sm border border-border/50">
              <TabsTrigger
                value="all"
                className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-600"
              >
                All
              </TabsTrigger>
              <TabsTrigger
                value="document"
                className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-600"
              >
                <FileText className="h-4 w-4 mr-1" />
                Documents
              </TabsTrigger>
              <TabsTrigger
                value="spreadsheet"
                className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-600"
              >
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                Spreadsheets
              </TabsTrigger>
              <TabsTrigger
                value="presentation"
                className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-600"
              >
                <Presentation className="h-4 w-4 mr-1" />
                Presentations
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Button variant="ghost" size="icon" onClick={() => refetchDocs()}>
            <RefreshCw className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-1 border border-border/50 rounded-lg p-1 bg-background/50 backdrop-blur-sm">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className={`h-8 w-8 ${viewMode === "grid" ? "bg-blue-500/20 text-blue-600" : ""}`}
              onClick={() => setViewMode("grid")}
            >
              <Grid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className={`h-8 w-8 ${viewMode === "list" ? "bg-blue-500/20 text-blue-600" : ""}`}
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Document List */}
      <div className="flex-1 overflow-auto p-6">
        {isDocsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3 text-muted-foreground">
              <Sparkles className="h-5 w-5 animate-pulse text-blue-500" />
              <span>Loading documents...</span>
            </div>
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/10 via-cyan-500/10 to-teal-500/10 border border-blue-500/20 mb-4">
              <FolderOpen className="h-8 w-8 text-blue-500/60" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No documents yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first document to get started
            </p>
            <Button
              onClick={() => setCreateDialogOpen(true)}
              className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 border-0"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Document
            </Button>
          </div>
        ) : (
          <div
            className={
              viewMode === "grid"
                ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                : "space-y-3"
            }
          >
            {filteredDocs.map(renderDocumentCard)}
          </div>
        )}
      </div>
    </div>
  );
}
