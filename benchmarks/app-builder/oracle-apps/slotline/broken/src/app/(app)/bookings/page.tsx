import Link from "next/link";
import { sessionUser } from "@/lib/auth/server";
import {
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
} from "@/components/ui-bits";
import { clinicDateOf, formatClinicRange, toIsoZ } from "@/lib/clinic-time";
import { listBookingsForPatient } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Only the signed-in user's own bookings, soonest first. */
export default async function BookingsPage() {
  const user = (await sessionUser())!;
  const bookings = await listBookingsForPatient(user.id);

  return (
    <div>
      <PageHeader
        title="My bookings"
        subtitle="All times are clinic time."
        action={
          <LinkButton href="/bookings/new" testId="booking-new-button">
            New booking
          </LinkButton>
        }
      />
      {bookings.length === 0 ? (
        <EmptyState
          testId="bookings-empty"
          title="You have no bookings yet"
          hint="Pick a practitioner, a service and a time to get started."
        />
      ) : (
        <Card>
          <ul data-testid="bookings-list" className="divide-y divide-slate-100">
            {bookings.map((b) => (
              <li
                key={b.id}
                data-testid="booking-row"
                data-booking-id={b.id}
                data-start={toIsoZ(b.start_at)}
                data-end={toIsoZ(b.end_at)}
                data-status={b.status}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4"
              >
                <span
                  data-testid="booking-row-practitioner"
                  className="font-medium text-slate-900"
                >
                  {b.practitioner_name}
                </span>
                <span data-testid="booking-row-service" className="text-sm text-slate-600">
                  {b.service_name}
                </span>
                <span data-testid="booking-row-time" className="text-sm text-slate-700">
                  {clinicDateOf(new Date(b.start_at))} ·{" "}
                  {formatClinicRange(b.start_at, b.end_at)}
                </span>
                <span
                  data-testid="booking-row-status"
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    b.status === "booked"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {b.status}
                </span>
                <Link
                  href={`/bookings/${b.id}`}
                  data-testid="booking-row-link"
                  className="ml-auto text-sm font-medium text-slate-900 underline-offset-4 hover:underline"
                >
                  Details
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
