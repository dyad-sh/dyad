import Link from "next/link";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui-bits";
import { sessionUser } from "@/lib/auth/server";
import { listPractitioners } from "@/lib/queries";
import { roleOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function PractitionersPage() {
  const user = (await sessionUser())!;
  const [role, practitioners] = await Promise.all([
    roleOf(user.id),
    listPractitioners(),
  ]);
  const isStaff = role === "staff";

  return (
    <div>
      <PageHeader
        title="Practitioners"
        subtitle="Everyone in the clinic sees the same practitioners."
        action={
          isStaff ? (
            <LinkButton href="/practitioners/new" testId="practitioner-new-button">
              New practitioner
            </LinkButton>
          ) : undefined
        }
      />
      {practitioners.length === 0 ? (
        <EmptyState
          testId="practitioners-empty"
          title="No practitioners yet"
          hint="Clinic staff add the practitioners patients can book with."
        />
      ) : (
        <Card>
          <ul data-testid="practitioners-list" className="divide-y divide-slate-100">
            {practitioners.map((p) => (
              <li
                key={p.id}
                data-testid="practitioner-row"
                data-practitioner-id={p.id}
                className="flex flex-wrap items-center gap-3 px-5 py-4"
              >
                <span
                  data-testid="practitioner-row-name"
                  className="font-medium text-slate-900"
                >
                  {p.name}
                </span>
                <span
                  data-testid="practitioner-row-specialty"
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
                >
                  {p.specialty}
                </span>
                <Link
                  href={`/practitioners/${p.id}`}
                  data-testid="practitioner-row-link"
                  className="ml-auto text-sm font-medium text-slate-900 underline-offset-4 hover:underline"
                >
                  View
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
