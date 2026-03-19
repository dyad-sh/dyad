/**
 * useExport — React hook for document export operations
 * Provides TanStack Query mutations for spreadsheet and document exports,
 * plus a capabilities query to check which formats are available.
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { exportClient } from "@/ipc/export_client";
import type { ExportFormat, DocumentSection } from "@/types/libreoffice_types";

export function useExport() {
  const capabilities = useQuery({
    queryKey: ["export-capabilities"],
    queryFn: () => exportClient.getCapabilities(),
    staleTime: 60_000,
  });

  const exportToSpreadsheet = useMutation({
    mutationFn: ({
      name,
      headers,
      rows,
      format,
    }: {
      name: string;
      headers: string[];
      rows: (string | number)[][];
      format: ExportFormat;
    }) => exportClient.exportToSpreadsheet(name, headers, rows, format),
    onSuccess: (result) => {
      toast.success(`Exported to ${result.filePath?.split(/[/\\]/).pop() || "file"}`);
    },
    onError: (error: Error) => {
      toast.error(`Export failed: ${error.message}`);
    },
  });

  const exportToDocument = useMutation({
    mutationFn: ({
      name,
      sections,
      format,
      title,
      subtitle,
    }: {
      name: string;
      sections: DocumentSection[];
      format: ExportFormat;
      title?: string;
      subtitle?: string;
    }) => exportClient.exportToDocument(name, sections, format, { title, subtitle }),
    onSuccess: (result) => {
      toast.success(`Exported to ${result.filePath?.split(/[/\\]/).pop() || "file"}`);
    },
    onError: (error: Error) => {
      toast.error(`Export failed: ${error.message}`);
    },
  });

  const hasLibreOffice = capabilities.data?.installed ?? false;

  return {
    capabilities: capabilities.data,
    isCapabilitiesLoading: capabilities.isLoading,
    hasLibreOffice,
    exportToSpreadsheet,
    exportToDocument,
    isExporting: exportToSpreadsheet.isPending || exportToDocument.isPending,
  };
}
