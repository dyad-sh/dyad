import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingCancelControl } from "@/components/booking-cancel-control";
import { Card, PageHeader, secondaryButtonClass } from "@/components/ui-bits";
import { loadActionableBooking } from "@/lib/booking-service";
import { sessionUser } from "@/lib/auth/server";
import { formatClinicDateTime, toIsoZ } from "@/lib/clinic-time";
import { CANCEL_WINDOW_NOTICE, patientMayChange } from "@/lib/policy";
import { roleOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = (await sessionUser())!;
  const role = await roleOf(user.id);
  // Scoped to the caller: another patient's booking is simply not found.
  const booking = await loadActionableBooking({ user, role }, id);
  if (!booking) notFound();

  // The same predicate the server enforces, so the control and the rule can
  // never disagree — and the server is still what decides.
  const mayChange = patientMayChange(booking, role);

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Booking"
        action={
          mayChange ? (
            <Link
              href={`/bookings/${booking.id}/reschedule`}
              data-testid="booking-reschedule-button"
              className={secondaryButtonClass}
            >
              Reschedule
            </Link>
          ) : undefined
        }
      />
      <Card className="space-y-6 p-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Practitioner
            </dt>
            <dd
              data-testid="booking-detail-practitioner"
              className="mt-1 text-base font-medium text-slate-900"
            >
              {booking.practitioner_name}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Service
            </dt>
            <dd data-testid="booking-detail-service" className="mt-1 text-base text-slate-700">
              {booking.service_name}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Starts
            </dt>
            <dd
              data-testid="booking-detail-start"
              data-start={toIsoZ(booking.start_at)}
              className="mt-1 text-base text-slate-700"
            >
              {formatClinicDateTime(booking.start_at)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Ends
            </dt>
            <dd
              data-testid="booking-detail-end"
              data-end={toIsoZ(booking.end_at)}
              className="mt-1 text-base text-slate-700"
            >
              {formatClinicDateTime(booking.end_at)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Status
            </dt>
            <dd data-testid="booking-detail-status" className="mt-1 text-base text-slate-700">
              {booking.status}
            </dd>
          </div>
        </dl>

        <p
          data-testid="cancel-window-notice"
          className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600"
        >
          {CANCEL_WINDOW_NOTICE}
        </p>

        {mayChange ? (
          <div className="border-t border-slate-200 pt-4">
            <BookingCancelControl bookingId={booking.id} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
