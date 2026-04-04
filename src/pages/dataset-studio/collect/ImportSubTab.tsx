import { useState } from "react";
import { Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBatchImport } from "@/hooks/useDataStudioExtended";

interface ImportSubTabProps {
  datasetId: string | null;
}

export function ImportSubTab({ datasetId }: ImportSubTabProps) {
  const [importPath, setImportPath] = useState("");
  const batchImport = useBatchImport();

  const handleImport = () => {
    if (!datasetId || !importPath) return;
    batchImport.mutate({
      datasetId,
      directoryPath: importPath,
      recursive: true,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Import Data
        </CardTitle>
        <CardDescription>Import files from a directory into your dataset</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!datasetId ? (
          <p className="text-muted-foreground">Select a dataset first (Datasets tab)</p>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">Directory Path</label>
              <Input
                value={importPath}
                onChange={(e) => setImportPath(e.target.value)}
                placeholder="C:\path\to\data"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleImport} disabled={batchImport.isPending}>
                {batchImport.isPending ? "Importing..." : "Start Import"}
              </Button>
            </div>
            {batchImport.isSuccess && (
              <div className="p-3 bg-green-50 dark:bg-green-950 rounded-md">
                <p className="text-sm text-green-700 dark:text-green-300">
                  Successfully imported {batchImport.data.imported} items
                  {batchImport.data.failed > 0 && ` (${batchImport.data.failed} failed)`}
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
