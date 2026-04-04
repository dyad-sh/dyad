import { Code } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface ApiSubTabProps {
  datasetId: string | null;
}

export function ApiSubTab({ datasetId }: ApiSubTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code className="h-5 w-5" />
          API Endpoint
        </CardTitle>
        <CardDescription>Scrape data from a REST or JSON API</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!datasetId ? (
          <p className="text-muted-foreground">Select a dataset first (Datasets tab)</p>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">API Endpoint</label>
              <Input placeholder="https://api.example.com/data" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Headers (JSON)</label>
              <Textarea placeholder='{"Authorization": "Bearer xxx"}' rows={3} />
            </div>
            <Button>
              <Code className="h-4 w-4 mr-2" />
              Scrape API
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
