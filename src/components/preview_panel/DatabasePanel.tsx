import { useState, useEffect } from "react";
import { Database, Table2, Terminal } from "lucide-react";
import { useRunApp } from "@/hooks/useRunApp";
import { TableList } from "./TableList";
import { TableDetails } from "./TableDetails";
import { SqlEditor } from "./SqlEditor";
import { SqlResults } from "./SqlResults";
import { useSqlQuery } from "@/hooks/useSqlQuery";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ExecuteSqlResult } from "@/ipc/types/supabase";

const DEFAULT_LIMIT = 25;
const DEFAULT_OFFSET = 0;

export function DatabasePanel() {
  const { app } = useRunApp();
  const projectId = app?.supabaseProjectId ?? null;
  const organizationSlug = app?.supabaseOrganizationSlug ?? null;

  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [offset, setOffset] = useState(DEFAULT_OFFSET);
  const [activeTab, setActiveTab] = useState("tables");
  const [sqlResult, setSqlResult] = useState<ExecuteSqlResult | null>(null);

  const sqlMutation = useSqlQuery({ projectId, organizationSlug });

  // Reset selectedTable when projectId changes to prevent querying stale table against new project
  useEffect(() => {
    setSelectedTable(null);
    setOffset(DEFAULT_OFFSET);
    setSqlResult(null);
  }, [projectId]);

  // Reset offset when table changes to prevent showing stale data
  useEffect(() => {
    setOffset(DEFAULT_OFFSET);
  }, [selectedTable]);

  const handleExecuteSql = (query: string) => {
    sqlMutation.mutate(query, {
      onSuccess: (result) => {
        setSqlResult(result);
      },
      onError: (error) => {
        setSqlResult({
          columns: [],
          rows: [],
          rowCount: 0,
          error: error.message,
        });
      },
    });
  };

  // Not connected state
  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <Database className="w-12 h-12 text-muted-foreground" />
        <div>
          <h3 className="text-lg font-medium mb-2">No Database Connected</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Connect Supabase to view tables. Go to the Configure panel to link a
            Supabase project to this app.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="flex flex-col h-full"
    >
      {/* Tab bar */}
      <div className="border-b border-border px-2 py-1.5 bg-muted/30">
        <TabsList className="h-8">
          <TabsTrigger value="tables" className="gap-1.5 text-xs px-3 h-7">
            <Table2 className="h-3.5 w-3.5" />
            Tables
          </TabsTrigger>
          <TabsTrigger value="sql" className="gap-1.5 text-xs px-3 h-7">
            <Terminal className="h-3.5 w-3.5" />
            SQL
          </TabsTrigger>
        </TabsList>
      </div>

      {/* Tables tab content */}
      <TabsContent value="tables" className="flex-1 m-0 overflow-hidden">
        <div className="flex h-full">
          {/* Left pane: Table list */}
          <div className="w-1/3 border-r border-border overflow-hidden flex flex-col min-h-0">
            <TableList
              projectId={projectId}
              organizationSlug={organizationSlug}
              selectedTable={selectedTable}
              onSelectTable={setSelectedTable}
            />
          </div>

          {/* Right pane: Table details (schema + rows) */}
          <div className="w-2/3 overflow-hidden flex flex-col min-h-0">
            <TableDetails
              projectId={projectId}
              organizationSlug={organizationSlug}
              table={selectedTable}
              limit={limit}
              offset={offset}
              onLimitChange={setLimit}
              onOffsetChange={setOffset}
            />
          </div>
        </div>
      </TabsContent>

      {/* SQL tab content */}
      <TabsContent value="sql" className="flex-1 m-0 overflow-hidden">
        <div className="flex flex-col h-full">
          {/* SQL Editor - top half */}
          <div className="h-1/3 min-h-[150px] border-b border-border">
            <SqlEditor
              onExecute={handleExecuteSql}
              isExecuting={sqlMutation.isPending}
            />
          </div>

          {/* Results - bottom half */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <SqlResults result={sqlResult} isLoading={sqlMutation.isPending} />
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}
