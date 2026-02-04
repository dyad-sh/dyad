import { useState } from "react";
import { Users, AlertCircle, Loader2 } from "lucide-react";
import { useAuthUsers } from "@/hooks/useAuthUsers";
import { PaginationControls } from "../PaginationControls";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCellValue } from "@/lib/supabase_utils";

interface UsersSectionProps {
  projectId: string;
  organizationSlug: string | null;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 25;

export function UsersSection({
  projectId,
  organizationSlug,
}: UsersSectionProps) {
  const [page, setPage] = useState(DEFAULT_PAGE);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);

  const { data, isLoading, error, isFetching } = useAuthUsers({
    projectId,
    organizationSlug,
    page,
    perPage,
  });

  const users = data?.users ?? [];
  const total = data?.total ?? null;

  // Calculate offset for pagination controls
  const offset = (page - 1) * perPage;

  const handleOffsetChange = (newOffset: number) => {
    setPage(Math.floor(newOffset / perPage) + 1);
  };

  const handleLimitChange = (newLimit: number) => {
    setPerPage(newLimit);
    setPage(1); // Reset to first page when changing limit
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="p-4 space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load users</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          <h3 className="text-sm font-medium">
            Auth Users{" "}
            {total !== null && (
              <span className="text-muted-foreground">({total})</span>
            )}
          </h3>
        </div>
        {isFetching && !isLoading && (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {users.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
            <Users className="w-12 h-12 text-muted-foreground" />
            <div>
              <h3 className="text-lg font-medium mb-2">No Users Yet</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Users will appear here once they sign up to your application.
              </p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-mono text-xs">id</TableHead>
                <TableHead className="font-mono text-xs">email</TableHead>
                <TableHead className="font-mono text-xs">created_at</TableHead>
                <TableHead className="font-mono text-xs">
                  last_sign_in_at
                </TableHead>
                <TableHead className="font-mono text-xs">provider</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-mono text-xs">
                    {formatCellValue(user.id)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatCellValue(user.email)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatCellValue(user.created_at)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatCellValue(user.last_sign_in_at)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatCellValue(user.app_metadata?.provider ?? "email")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {users.length > 0 && (
        <PaginationControls
          total={total}
          limit={perPage}
          offset={offset}
          onLimitChange={handleLimitChange}
          onOffsetChange={handleOffsetChange}
          isLoading={isFetching}
        />
      )}
    </div>
  );
}
