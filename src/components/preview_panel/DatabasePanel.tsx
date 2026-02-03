import { useState, useEffect } from "react";
import { Database } from "lucide-react";
import { useRunApp } from "@/hooks/useRunApp";
import { TableList } from "./TableList";
import { TableDetails } from "./TableDetails";

const DEFAULT_LIMIT = 25;
const DEFAULT_OFFSET = 0;

export function DatabasePanel() {
  const { app } = useRunApp();
  const projectId = app?.supabaseProjectId ?? null;
  const organizationSlug = app?.supabaseOrganizationSlug ?? null;

  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [offset, setOffset] = useState(DEFAULT_OFFSET);

  // Reset selectedTable when projectId changes to prevent querying stale table against new project
  useEffect(() => {
    setSelectedTable(null);
    setOffset(DEFAULT_OFFSET);
  }, [projectId]);

  // Reset offset when table changes to prevent showing stale data
  useEffect(() => {
    setOffset(DEFAULT_OFFSET);
  }, [selectedTable]);

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
  );
}
