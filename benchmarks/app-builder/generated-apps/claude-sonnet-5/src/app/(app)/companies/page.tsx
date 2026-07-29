"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { Company } from "@/lib/types";
import { useMe } from "@/lib/use-me";

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { activeRole } = useMe();
  const canWrite = activeRole === "owner" || activeRole === "member";

  useEffect(() => {
    fetch("/api/companies")
      .then((res) => (res.ok ? res.json() : []))
      .then(setCompanies)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Companies</h1>
        {canWrite && (
          <Button asChild data-testid="company-new-button">
            <Link href="/companies/new">New company</Link>
          </Button>
        )}
      </div>

      {!isLoading && companies.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-500">
          No companies found.
        </p>
      ) : (
        <div
          data-testid="companies-list"
          className="overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Domain</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr
                  key={company.id}
                  data-testid="company-row"
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td data-testid="company-row-name" className="px-4 py-3 text-slate-900">
                    {company.name}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{company.domain ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/companies/${company.id}`}
                      className="font-medium text-slate-900 underline-offset-4 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
