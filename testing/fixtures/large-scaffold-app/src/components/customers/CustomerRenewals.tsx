import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface CustomerRenewalsItem {
  id: string;
  name?: string;
  title?: string;
  status?: string;
  owner?: string;
  summary?: string;
  tags?: string[];
}

export function CustomerRenewals({ items = [], compact = false }: { items?: CustomerRenewalsItem[]; compact?: boolean }) {
  const visibleItems = items.slice(0, compact ? 3 : 6);
  const totalTags = visibleItems.reduce((sum, item) => sum + (item.tags?.length ?? 0), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-emerald-600" />
          Customer Renewals
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-md bg-slate-100 p-2">
            <div className="text-lg font-semibold">{items.length}</div>
            <div className="text-slate-500">customers</div>
          </div>
          <div className="rounded-md bg-emerald-50 p-2">
            <div className="text-lg font-semibold">{visibleItems.length}</div>
            <div className="text-slate-500">shown</div>
          </div>
          <div className="rounded-md bg-amber-50 p-2">
            <div className="text-lg font-semibold">{totalTags}</div>
            <div className="text-slate-500">tags</div>
          </div>
        </div>
        <div className="space-y-2">
          {visibleItems.map((item) => (
            <div key={item.id} className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium">{item.name ?? item.title ?? item.id}</p>
                {item.status ? <Badge variant="secondary">{item.status}</Badge> : null}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.summary ?? item.owner ?? "Operational record used by the fixture app."}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
