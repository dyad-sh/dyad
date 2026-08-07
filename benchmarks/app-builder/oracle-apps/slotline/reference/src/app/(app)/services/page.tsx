import Link from "next/link";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui-bits";
import { sessionUser } from "@/lib/auth/server";
import { listServices } from "@/lib/queries";
import { roleOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const user = (await sessionUser())!;
  const [role, services] = await Promise.all([roleOf(user.id), listServices()]);
  const isStaff = role === "staff";

  return (
    <div>
      <PageHeader
        title="Services"
        subtitle="Each service has a fixed length; slots are gridded from it."
        action={
          isStaff ? (
            <LinkButton href="/services/new" testId="service-new-button">
              New service
            </LinkButton>
          ) : undefined
        }
      />
      {services.length === 0 ? (
        <EmptyState
          testId="services-empty"
          title="No services yet"
          hint="Clinic staff add the services patients can book."
        />
      ) : (
        <Card>
          <ul data-testid="services-list" className="divide-y divide-slate-100">
            {services.map((s) => (
              <li
                key={s.id}
                data-testid="service-row"
                data-service-id={s.id}
                className="flex flex-wrap items-center gap-3 px-5 py-4"
              >
                <span
                  data-testid="service-row-name"
                  className="font-medium text-slate-900"
                >
                  {s.name}
                </span>
                <span
                  data-testid="service-row-duration"
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
                >
                  {Number(s.duration_minutes)} min
                </span>
                <Link
                  href={`/services/${s.id}`}
                  data-testid="service-row-link"
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
