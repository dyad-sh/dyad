import { FileEditor } from "./FileEditor";
import { FileTree } from "./FileTree";
import { RefreshCw } from "lucide-react";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useAtomValue } from "jotai";
import { selectedFileAtom } from "@/atoms/viewAtoms";

interface App {
  id?: number;
  files?: string[];
}

export interface CodeViewProps {
  loading: boolean;
  app: App | null;
}

// Code view component that displays app files or status messages
export const CodeView = ({ loading, app }: CodeViewProps) => {
  const selectedFile = useAtomValue(selectedFileAtom);
  const { refreshApp } = useLoadApp(app?.id ?? null);

  if (loading) {
    return <div className="text-center py-4">Loading files...</div>;
  }

  if (!app) {
    return (
      <div className="text-center py-4 text-gray-500">No app selected</div>
    );
  }

  if (app.files && app.files.length > 0) {
    return (
      <div className="flex flex-col h-full">
        {/* Toolbar */}
        <div className="flex items-center p-2 border-b space-x-2">
          <button
            onClick={() => refreshApp()}
            className="p-1 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={loading || !app.id}
            title="Refresh Files"
          >
            <RefreshCw size={16} />
          </button>
          <div className="text-sm text-gray-500">{app.files.length} files</div>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          <div className="w-1/3 overflow-auto border-r">
            <FileTree files={app.files} />
          </div>
          <div className="w-2/3">
            {selectedFile ? (
              <FileEditor appId={app.id ?? null} filePath={selectedFile.path} />
            ) : (
              <div className="text-center py-4 text-gray-500">
                Select a file to view
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <div className="text-center py-4 text-gray-500">No files found</div>;
};
